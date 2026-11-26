import { Injectable } from "@nestjs/common";
import {
  Inbox,
  InboxItem,
  type ApprovalRole,
  type InboxItemType,
  type PaymentCertStatus,
} from "@ecapital/shared";
import { and, asc, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { callerUserId } from "../common/actor";
import { AppError } from "../common/errors";
import { I18nService, type Locale } from "../common/i18n.service";
import { currentTx } from "../db/client";
import * as schema from "../db/schema";
import { classAndSystemsFact, formatAreaList, formatPermitWindow, permitWhatEl } from "./inbox-facts";
import { PermissionsService } from "../permissions/permissions.service";
import { CERT_STEP_NEEDS } from "../permissions/steps";
import { mayDecideLine } from "./line-needs";
import { approvalSlaState } from "./permit-sla";

/** R11's ladder. Who may take each step is `CERT_STEP_NEEDS`, as in PaymentCertsService. */
const CERT_ORDER: PaymentCertStatus[] = ["DRAFT", "ENGINEER_APPROVED", "FINANCE_RECEIVED", "PAID"];

/**
 * S14 — Εγκρίσεις, the approvals inbox.
 *
 * CAPEX-01 §2 wants «the inbox triage people already know»: one list of the
 * things waiting on *you*, newest first, with enough on each row to decide
 * without opening it. UI §5 S14 fixes that «enough» at exactly three facts,
 * and the contract types it: `facts` has length 3 and nothing else is
 * allowed on the card.
 *
 * Three kinds of thing land here today:
 *
 *   SHUTDOWN      a permit approval line assigned to the caller and still
 *                 PENDING. Decidable here — `a` approves it from the list.
 *   VARIATION     a SUBMITTED variation the caller could decide (R10's
 *                 segregation included: not one they raised themselves).
 *   PAYMENT_CERT  a certificate whose next step is one the caller may take
 *                 (R11, with the same segregation on the engineer's signature).
 *
 * Two more SHUTDOWN kinds come from the handback in two steps (OWNER
 * 26/11/2026): a handback waiting for the caller's clinical acceptance, and
 * a handback the clinical owner returned to the caller who submitted it.
 * Both are `decidable: false`: accepting signs the §6.6 acceptance and is
 * done on the permit's own page, where the checklist is.
 *
 * The last two are `decidable: false` and carry an href, because their
 * decisions have screens of their own with figures on them that a three-fact
 * card cannot carry honestly. That is the contract's word, not a shortcut.
 *
 * Nothing in this file checks a unit. Everything it reads is read under the
 * caller's own policies, so an inbox is what the row policies already say the
 * caller may see, narrowed to what is waiting on them (ADR-0010).
 */
@Injectable()
export class InboxService {
  constructor(
    private readonly i18n: I18nService,
    private readonly permissions: PermissionsService,
  ) {}

  async forCaller(now: Date, locale: Locale): Promise<Inbox> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const caller = await callerUserId();
    const roles = tx.context.roles;

    const read = await tx.db
      .select({ itemId: schema.inboxRead.itemId })
      .from(schema.inboxRead)
      .where(eq(schema.inboxRead.userId, caller));
    const readIds = new Set(read.map((row) => row.itemId));

    const items = [
      ...(await this.permitItems(caller, now, locale)),
      ...(await this.returnedItems(caller, locale)),
      ...(await this.handbackItems(caller, locale)),
      ...(await this.handbackReturnedItems(caller, locale)),
      ...(await this.variationItems(caller, roles)),
      ...(await this.certificateItems(caller, roles)),
    ]
      .map((item) => ({ ...item, unread: !readIds.has(item.id) }))
      // Newest request first, which is how S14 groups inside each type.
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));

    const counts: Record<string, number> = { SHUTDOWN: 0, VARIATION: 0, PAYMENT_CERT: 0, OTHER: 0 };
    for (const item of items) counts[item.type] += 1;

    return Inbox.parse({ items, counts: counts as Record<InboxItemType, number> });
  }

  /** Marking something read is per person and changes nothing about the item. */
  async markRead(itemId: string, now: Date): Promise<void> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const caller = await callerUserId();
    await tx.db
      .insert(schema.inboxRead)
      .values({ userId: caller, itemId, readAt: now })
      .onConflictDoUpdate({
        target: [schema.inboxRead.userId, schema.inboxRead.itemId],
        set: { readAt: now },
      });
  }

  // ------------------------------------------------------------ the three --

  /**
   * The approval lines waiting on the caller, and — for an administrator —
   * the lines waiting on nobody.
   *
   * OWNER UAT 25/11/2026: a unit with no approver appointed for a role left
   * that line unassigned and PENDING, which the service intends (an
   * administrator stands in, ADR-0026 Errata), but no screen ever showed the
   * line to the administrator, so the permit simply sat there. The
   * administrator now sees every unassigned line of a permit they did not
   * request themselves, with a sentence saying why it is theirs.
   *
   * `decidable` says what the decide route will say (`LINE_NEEDS`): a line
   * assigned to somebody whose role may not decide it is shown with the
   * reason instead of two buttons the API would refuse.
   */
  private async permitItems(
    caller: string,
    now: Date,
    locale: Locale,
  ): Promise<Omit<InboxItem, "unread">[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const roles = tx.context.roles;
    const isAdmin = roles.includes("admin");
    const mayDecide = (role: ApprovalRole) =>
      isAdmin || mayDecideLine(role, (area, level) => this.permissions.allowed({ roles }, area, level));

    const waitingOn = isAdmin
      ? or(
          eq(schema.permitApproval.approverId, caller),
          and(
            isNull(schema.permitApproval.approverId),
            ne(schema.shutdownPermit.requestedBy, caller),
          ),
        )
      : eq(schema.permitApproval.approverId, caller);

    const rows = await tx.db
      .select({
        id: schema.permitApproval.id,
        permitId: schema.permitApproval.permitId,
        role: schema.permitApproval.role,
        approverId: schema.permitApproval.approverId,
        // A WARD_MANAGER line is about one room: name that room, so three
        // of them on one permit read as three rows, not three copies.
        lineAreaNameEl: sql<string | null>`(select a.name_el from ecapital.area a where a.id = ${schema.permitApproval.areaId})`,
        dueAt: schema.permitApproval.dueAt,
        slaHours: schema.permitApproval.slaHours,
        ref: schema.shutdownPermit.ref,
        titleEl: schema.shutdownPermit.titleEl,
        systems: schema.shutdownPermit.systems,
        icraClass: schema.shutdownPermit.icraClass,
        plannedStart: schema.shutdownPermit.plannedStart,
        plannedEnd: schema.shutdownPermit.plannedEnd,
        submittedAt: schema.shutdownPermit.submittedAt,
        requestedAt: schema.shutdownPermit.requestedAt,
        requestedByName: sql<string | null>`ecapital.user_display_name(${schema.shutdownPermit.requestedBy})`,
        orgUnitNameEl: schema.orgUnit.nameEl,
      })
      .from(schema.permitApproval)
      .innerJoin(
        schema.shutdownPermit,
        eq(schema.shutdownPermit.id, schema.permitApproval.permitId),
      )
      .innerJoin(schema.orgUnit, eq(schema.orgUnit.id, schema.shutdownPermit.orgUnitId))
      .where(
        and(
          waitingOn,
          eq(schema.permitApproval.decision, "PENDING"),
          eq(schema.shutdownPermit.status, "CLINICAL_REVIEW"),
        ),
      )
      .orderBy(asc(schema.permitApproval.dueAt));
    if (!rows.length) return [];

    const names = await this.areaNames(rows.map((row) => row.permitId));

    return rows.map((row) => {
      const unassigned = row.approverId === null;
      const decidable = mayDecide(row.role);
      const note = unassigned
        ? this.i18n.translate("inbox.notes.unassigned", locale)
        : decidable
          ? null
          : this.i18n.translate("inbox.notes.roleMissing", locale);
      return {
        id: row.id,
        type: "SHUTDOWN" as const,
        // RULE (review nit, 19/09/2026): the approval role is folded into
        // `whatEl` so that a permit with several lines waiting on the same
        // caller (a ward manager for one area, nursing for the unit) reads
        // as three distinguishable rows, not three copies of one line.
        whatEl: permitWhatEl(row.ref, row.titleEl, row.role, locale, this.i18n),
        whereEl: `${row.orgUnitNameEl} › ${row.lineAreaNameEl ?? names.get(row.permitId)?.[0] ?? "—"}`,
        requestedByName: row.requestedByName ?? "",
        requestedAt: (row.submittedAt ?? row.requestedAt).toISOString(),
        dueAt: row.dueAt.toISOString(),
        slaState: approvalSlaState(row.dueAt, row.slaHours, null, now),
        // RULE (UI §5 S14, DecisionPanel): exactly three facts. Class and
        // system, the window, the rooms — the three things an approver needs
        // before they decide, and nothing they would have to scroll for, said
        // in the caller's own language from the API's own catalogues rather
        // than the raw enum values and ISO timestamps the row carries.
        facts: [
          {
            label: this.i18n.translate("inbox.facts.precautionCategory", locale),
            value: classAndSystemsFact(row.icraClass, row.systems, locale, this.i18n),
          },
          {
            label: this.i18n.translate("inbox.facts.period", locale),
            value: formatPermitWindow(row.plannedStart, row.plannedEnd),
          },
          {
            label: this.i18n.translate("inbox.facts.rooms", locale),
            value: formatAreaList(names.get(row.permitId) ?? []),
          },
        ],
        href: `/permits/${row.permitId}`,
        decidable,
        note,
      };
    });
  }

  /**
   * OWNER UAT 25/11/2026 («Επιστροφή με σχόλια» must send the item back to
   * the requester): a permit an approver returned is DRAFT again, and the
   * requester had nothing telling them so. Each of their own permits that
   * came back waits here — not decidable, a sentence naming who returned it,
   * the comment as the first fact — until they correct it and submit it
   * again, which rebuilds the route and so takes the RETURNED line away.
   */
  private async returnedItems(caller: string, locale: Locale): Promise<Omit<InboxItem, "unread">[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();

    const rows = await tx.db
      .select({
        id: schema.permitApproval.id,
        permitId: schema.permitApproval.permitId,
        role: schema.permitApproval.role,
        commentEl: schema.permitApproval.commentEl,
        decidedAt: schema.permitApproval.decidedAt,
        returnedByName: sql<string | null>`ecapital.user_display_name(${schema.permitApproval.approverId})`,
        ref: schema.shutdownPermit.ref,
        titleEl: schema.shutdownPermit.titleEl,
        plannedStart: schema.shutdownPermit.plannedStart,
        plannedEnd: schema.shutdownPermit.plannedEnd,
        requestedAt: schema.shutdownPermit.requestedAt,
        requestedByName: sql<string | null>`ecapital.user_display_name(${schema.shutdownPermit.requestedBy})`,
        orgUnitNameEl: schema.orgUnit.nameEl,
      })
      .from(schema.permitApproval)
      .innerJoin(
        schema.shutdownPermit,
        eq(schema.shutdownPermit.id, schema.permitApproval.permitId),
      )
      .innerJoin(schema.orgUnit, eq(schema.orgUnit.id, schema.shutdownPermit.orgUnitId))
      .where(
        and(
          eq(schema.shutdownPermit.requestedBy, caller),
          eq(schema.shutdownPermit.status, "DRAFT"),
          eq(schema.permitApproval.decision, "RETURNED"),
        ),
      )
      .orderBy(asc(schema.permitApproval.decidedAt));
    if (!rows.length) return [];

    const names = await this.areaNames(rows.map((row) => row.permitId));

    return rows.map((row) => ({
      id: row.id,
      type: "SHUTDOWN" as const,
      whatEl: this.i18n.translate("inbox.returnedWhat", locale, {
        ref: row.ref ?? "—",
        title: row.titleEl,
      }),
      whereEl: `${row.orgUnitNameEl} › ${names.get(row.permitId)?.[0] ?? "—"}`,
      requestedByName: row.requestedByName ?? "",
      requestedAt: (row.decidedAt ?? row.requestedAt).toISOString(),
      dueAt: null,
      slaState: null,
      facts: [
        {
          label: this.i18n.translate("inbox.facts.comment", locale),
          value: row.commentEl ?? "—",
        },
        {
          label: this.i18n.translate("inbox.facts.period", locale),
          value: formatPermitWindow(row.plannedStart, row.plannedEnd),
        },
        {
          label: this.i18n.translate("inbox.facts.rooms", locale),
          value: formatAreaList(names.get(row.permitId) ?? []),
        },
      ],
      href: `/permits/${row.permitId}`,
      decidable: false,
      note: this.i18n.translate("inbox.notes.returned", locale, {
        name: row.returnedByName ?? this.i18n.translate(`approvalRole.${row.role}`, locale),
      }),
    }));
  }

  /**
   * OWNER 26/11/2026, step 2 of the handback: a permit whose works side has
   * submitted the area and is waiting for the caller's acceptance. The same
   * rule as `PermitsService.holdsAcceptanceRole` (§6.6): a clinical owner of
   * one of the permit's areas as WARD_MANAGER, NURSING or INFECTION_CONTROL,
   * or the unit's NURSING or INFECTION_CONTROL — and never the person who
   * submitted it. An administrator is not one of them by being one.
   *
   * The id carries the moment of the submission, so a handback returned and
   * submitted again reads as unread again.
   */
  private async handbackItems(caller: string, locale: Locale): Promise<Omit<InboxItem, "unread">[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();

    const rows = await tx.db
      .select({
        permitId: schema.shutdownPermit.id,
        ref: schema.shutdownPermit.ref,
        titleEl: schema.shutdownPermit.titleEl,
        plannedStart: schema.shutdownPermit.plannedStart,
        plannedEnd: schema.shutdownPermit.plannedEnd,
        submittedAt: schema.shutdownPermit.closeoutSubmittedAt,
        submittedByName: sql<string | null>`ecapital.user_display_name(${schema.shutdownPermit.closeoutSubmittedBy})`,
        closeout: schema.shutdownPermit.closeout,
        orgUnitNameEl: schema.orgUnit.nameEl,
      })
      .from(schema.shutdownPermit)
      .innerJoin(schema.orgUnit, eq(schema.orgUnit.id, schema.shutdownPermit.orgUnitId))
      .where(
        and(
          inArray(schema.shutdownPermit.status, ["ACTIVE", "BREACH"]),
          isNotNull(schema.shutdownPermit.closeoutSubmittedAt),
          ne(schema.shutdownPermit.closeoutSubmittedBy, caller),
          sql`(exists (select 1 from ecapital.shutdown_permit_area spa
                         join ecapital.area_clinical_owner aco on aco.area_id = spa.area_id
                        where spa.permit_id = ${schema.shutdownPermit.id}
                          and aco.user_id = ${caller}::uuid
                          and aco.approval_role in ('WARD_MANAGER', 'NURSING', 'INFECTION_CONTROL'))
               or exists (select 1 from ecapital.unit_approver ua
                           where ua.org_unit_id = ${schema.shutdownPermit.orgUnitId}
                             and ua.user_id = ${caller}::uuid
                             and ua.approval_role in ('NURSING', 'INFECTION_CONTROL')))`,
        ),
      )
      .orderBy(asc(schema.shutdownPermit.closeoutSubmittedAt));
    if (!rows.length) return [];

    const names = await this.areaNames(rows.map((row) => row.permitId));

    return rows.map((row) => {
      const submittedAt = row.submittedAt as Date;
      const note = (row.closeout as { noteEl?: string | null } | null)?.noteEl;
      return {
        id: `handback:${row.permitId}:${submittedAt.getTime()}`,
        type: "SHUTDOWN" as const,
        whatEl: this.i18n.translate("inbox.handbackWhat", locale, {
          ref: row.ref ?? "—",
          title: row.titleEl,
        }),
        whereEl: `${row.orgUnitNameEl} › ${names.get(row.permitId)?.[0] ?? "—"}`,
        requestedByName: row.submittedByName ?? "",
        requestedAt: submittedAt.toISOString(),
        dueAt: null,
        slaState: null,
        facts: [
          {
            label: this.i18n.translate("inbox.facts.period", locale),
            value: formatPermitWindow(row.plannedStart, row.plannedEnd),
          },
          {
            label: this.i18n.translate("inbox.facts.rooms", locale),
            value: formatAreaList(names.get(row.permitId) ?? []),
          },
          {
            label: this.i18n.translate("inbox.facts.handbackNote", locale),
            value: note?.trim() ? note : "—",
          },
        ],
        href: `/permits/${row.permitId}`,
        decidable: false,
        note: this.i18n.translate("inbox.notes.handback", locale, {
          name: row.submittedByName ?? "—",
        }),
      };
    });
  }

  /**
   * OWNER 26/11/2026: a handback the clinical owner returned waits in the
   * inbox of whoever submitted it, with the comment as the first fact, until
   * they submit it again (which clears the return from view) or the permit
   * is settled.
   */
  private async handbackReturnedItems(
    caller: string,
    locale: Locale,
  ): Promise<Omit<InboxItem, "unread">[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();

    const rows = await tx.db
      .select({
        permitId: schema.shutdownPermit.id,
        ref: schema.shutdownPermit.ref,
        titleEl: schema.shutdownPermit.titleEl,
        plannedStart: schema.shutdownPermit.plannedStart,
        plannedEnd: schema.shutdownPermit.plannedEnd,
        returnedAt: schema.shutdownPermit.closeoutReturnedAt,
        returnedByName: sql<string | null>`ecapital.user_display_name(${schema.shutdownPermit.closeoutReturnedBy})`,
        commentEl: schema.shutdownPermit.closeoutReturnCommentEl,
        orgUnitNameEl: schema.orgUnit.nameEl,
      })
      .from(schema.shutdownPermit)
      .innerJoin(schema.orgUnit, eq(schema.orgUnit.id, schema.shutdownPermit.orgUnitId))
      .where(
        and(
          inArray(schema.shutdownPermit.status, ["ACTIVE", "BREACH"]),
          isNull(schema.shutdownPermit.closeoutSubmittedAt),
          isNotNull(schema.shutdownPermit.closeoutReturnedAt),
          eq(schema.shutdownPermit.closeoutSubmittedBy, caller),
        ),
      )
      .orderBy(asc(schema.shutdownPermit.closeoutReturnedAt));
    if (!rows.length) return [];

    const names = await this.areaNames(rows.map((row) => row.permitId));

    return rows.map((row) => {
      const returnedAt = row.returnedAt as Date;
      return {
        id: `handback-returned:${row.permitId}:${returnedAt.getTime()}`,
        type: "SHUTDOWN" as const,
        whatEl: this.i18n.translate("inbox.handbackReturnedWhat", locale, {
          ref: row.ref ?? "—",
          title: row.titleEl,
        }),
        whereEl: `${row.orgUnitNameEl} › ${names.get(row.permitId)?.[0] ?? "—"}`,
        requestedByName: row.returnedByName ?? "",
        requestedAt: returnedAt.toISOString(),
        dueAt: null,
        slaState: null,
        facts: [
          {
            label: this.i18n.translate("inbox.facts.handbackComment", locale),
            value: row.commentEl ?? "—",
          },
          {
            label: this.i18n.translate("inbox.facts.period", locale),
            value: formatPermitWindow(row.plannedStart, row.plannedEnd),
          },
          {
            label: this.i18n.translate("inbox.facts.rooms", locale),
            value: formatAreaList(names.get(row.permitId) ?? []),
          },
        ],
        href: `/permits/${row.permitId}`,
        decidable: false,
        note: this.i18n.translate("inbox.notes.handbackReturned", locale, {
          name: row.returnedByName ?? "—",
        }),
      };
    });
  }

  /** The names of each permit's areas, in code order — S14's «Χώροι» fact. */
  private async areaNames(permitIds: string[]): Promise<Map<string, string[]>> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const areas = await tx.db
      .select({
        permitId: schema.shutdownPermitArea.permitId,
        nameEl: schema.area.nameEl,
      })
      .from(schema.shutdownPermitArea)
      .innerJoin(schema.area, eq(schema.area.id, schema.shutdownPermitArea.areaId))
      .where(inArray(schema.shutdownPermitArea.permitId, permitIds))
      .orderBy(asc(schema.area.code));
    const byPermit = new Map<string, string[]>();
    for (const area of areas) {
      byPermit.set(area.permitId, [...(byPermit.get(area.permitId) ?? []), area.nameEl]);
    }
    return byPermit;
  }

  private async variationItems(
    caller: string,
    roles: string[],
  ): Promise<Omit<InboxItem, "unread">[]> {
    // Who may decide a variation, per the route in ContractsController:
    // APPROVE on the decision row of the role matrix (ADR-0033).
    if (!this.permissions.allowed({ roles }, "variationDecide", "APPROVE")) return [];
    const tx = currentTx();
    if (!tx) throw AppError.internal();

    const rows = await tx.db
      .select({
        id: schema.variation.id,
        contractId: schema.variation.contractId,
        number: schema.variation.number,
        descriptionEl: schema.variation.descriptionEl,
        value: schema.variation.value,
        grossValue: schema.variation.grossValue,
        timeImpactDays: schema.variation.timeImpactDays,
        reason: schema.variation.reason,
        raisedAt: schema.variation.raisedAt,
        raisedByName: sql<string | null>`ecapital.user_display_name(${schema.variation.raisedBy})`,
        contractNo: schema.contract.contractNo,
        orgUnitNameEl: schema.orgUnit.nameEl,
      })
      .from(schema.variation)
      .innerJoin(schema.contract, eq(schema.contract.id, schema.variation.contractId))
      .innerJoin(schema.orgUnit, eq(schema.orgUnit.id, schema.variation.orgUnitId))
      .where(
        and(
          eq(schema.variation.status, "SUBMITTED"),
          // R10, ADR-0015: whoever approves a variation cannot be the person
          // who raised it, so their own never appears in their inbox.
          ne(schema.variation.raisedBy, caller),
        ),
      )
      .orderBy(asc(schema.variation.raisedAt));

    return rows.map((row) => ({
      id: row.id,
      type: "VARIATION" as const,
      whatEl: `Τροποποίηση σύμβασης ${row.contractNo} #${row.number}`,
      whereEl: `${row.orgUnitNameEl} › ${row.contractNo}`,
      requestedByName: row.raisedByName ?? "",
      requestedAt: row.raisedAt.toISOString(),
      dueAt: null,
      slaState: null,
      facts: [
        // ADR-0038: the gross it commits, with the net as raised. Still
        // three facts (the DecisionPanel's rule).
        { label: "Σύνολο με ΦΠΑ", value: `${row.grossValue ?? row.value} EUR (καθαρό ${row.value} EUR)` },
        { label: "Επίπτωση χρόνου", value: `${row.timeImpactDays} ημέρες` },
        { label: "Αιτία", value: row.reason },
      ],
      // S08. A variation moves money, so it is decided on the screen that
      // shows the contract's figures, not from a three-fact card.
      href: `/contracts/${row.contractId}/variations`,
      decidable: false,
      note: null,
    }));
  }

  private async certificateItems(
    caller: string,
    roles: string[],
  ): Promise<Omit<InboxItem, "unread">[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();

    const waiting = CERT_ORDER.filter((_status, index) => {
      const next = CERT_ORDER[index + 1];
      const need = next === undefined ? null : CERT_STEP_NEEDS[next];
      return need !== null && this.permissions.allowed({ roles }, need[0], need[1]);
    });
    if (!waiting.length) return [];

    const rows = await tx.db
      .select({
        id: schema.paymentCert.id,
        number: schema.paymentCert.number,
        status: schema.paymentCert.status,
        netPayable: schema.paymentCert.netPayable,
        grossPayable: schema.paymentCert.grossPayable,
        periodFrom: schema.paymentCert.periodFrom,
        periodTo: schema.paymentCert.periodTo,
        createdBy: schema.paymentCert.createdBy,
        createdAt: schema.paymentCert.createdAt,
        createdByName: sql<string | null>`ecapital.user_display_name(${schema.paymentCert.createdBy})`,
        contractNo: schema.contract.contractNo,
        orgUnitNameEl: schema.orgUnit.nameEl,
      })
      .from(schema.paymentCert)
      .innerJoin(schema.contract, eq(schema.contract.id, schema.paymentCert.contractId))
      .innerJoin(schema.orgUnit, eq(schema.orgUnit.id, schema.paymentCert.orgUnitId))
      .where(inArray(schema.paymentCert.status, waiting))
      .orderBy(asc(schema.paymentCert.createdAt));

    return rows
      .filter((row) => {
        // R11's segregation: the engineer's signature has to come from
        // somebody other than the person who wrote the certificate, so their
        // own never waits on them.
        const next = CERT_ORDER[CERT_ORDER.indexOf(row.status) + 1];
        if (next === "ENGINEER_APPROVED" && row.createdBy === caller) return false;
        return true;
      })
      .map((row) => ({
        id: row.id,
        type: "PAYMENT_CERT" as const,
        whatEl: `Πιστοποίηση πληρωμής ${row.contractNo} #${row.number}`,
        whereEl: `${row.orgUnitNameEl} › ${row.contractNo}`,
        requestedByName: row.createdByName ?? "",
        requestedAt: row.createdAt.toISOString(),
        dueAt: null,
        slaState: null,
        facts: [
          // ADR-0038: what finance pays, with the net payable beside it.
          {
            label: "Πληρωτέο με ΦΠΑ",
            value: `${row.grossPayable ?? row.netPayable} EUR (καθαρό ${row.netPayable} EUR)`,
          },
          { label: "Περίοδος", value: `${row.periodFrom} – ${row.periodTo}` },
          { label: "Κατάσταση", value: row.status },
        ],
        href: `/certificates/${row.id}`,
        decidable: false,
        note: null,
      }));
  }
}
