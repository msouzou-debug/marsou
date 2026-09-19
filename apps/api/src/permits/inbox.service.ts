import { Injectable } from "@nestjs/common";
import {
  Inbox,
  InboxItem,
  type InboxItemType,
  type PaymentCertStatus,
} from "@ecapital/shared";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { callerUserId } from "../common/actor";
import { AppError } from "../common/errors";
import { I18nService, type Locale } from "../common/i18n.service";
import { currentTx } from "../db/client";
import * as schema from "../db/schema";
import { classAndSystemsFact, formatAreaList, formatPermitWindow, permitWhatEl } from "./inbox-facts";
import { approvalSlaState } from "./permit-sla";

/** R11's ladder, and who may take each step. Mirrors PaymentCertsService. */
const CERT_ORDER: PaymentCertStatus[] = ["DRAFT", "ENGINEER_APPROVED", "FINANCE_RECEIVED", "PAID"];
const CERT_ROLES: Record<PaymentCertStatus, string[]> = {
  DRAFT: [],
  ENGINEER_APPROVED: ["project_engineer", "estates_head", "admin"],
  FINANCE_RECEIVED: ["finance", "admin"],
  PAID: ["finance", "admin"],
};

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
  constructor(private readonly i18n: I18nService) {}

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

  private async permitItems(
    caller: string,
    now: Date,
    locale: Locale,
  ): Promise<Omit<InboxItem, "unread">[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();

    const rows = await tx.db
      .select({
        id: schema.permitApproval.id,
        permitId: schema.permitApproval.permitId,
        role: schema.permitApproval.role,
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
          eq(schema.permitApproval.approverId, caller),
          eq(schema.permitApproval.decision, "PENDING"),
          eq(schema.shutdownPermit.status, "CLINICAL_REVIEW"),
        ),
      )
      .orderBy(asc(schema.permitApproval.dueAt));
    if (!rows.length) return [];

    const areas = await tx.db
      .select({
        permitId: schema.shutdownPermitArea.permitId,
        nameEl: schema.area.nameEl,
      })
      .from(schema.shutdownPermitArea)
      .innerJoin(schema.area, eq(schema.area.id, schema.shutdownPermitArea.areaId))
      .where(
        inArray(
          schema.shutdownPermitArea.permitId,
          rows.map((row) => row.permitId),
        ),
      )
      .orderBy(asc(schema.area.code));

    return rows.map((row) => {
      const names = areas.filter((area) => area.permitId === row.permitId).map((a) => a.nameEl);
      return {
        id: row.id,
        type: "SHUTDOWN" as const,
        // RULE (review nit, 19/09/2026): the approval role is folded into
        // `whatEl` so that a permit with several lines waiting on the same
        // caller (a ward manager for one area, nursing for the unit) reads
        // as three distinguishable rows, not three copies of one line.
        whatEl: permitWhatEl(row.ref, row.titleEl, row.role, locale, this.i18n),
        whereEl: `${row.orgUnitNameEl} › ${names[0] ?? "—"}`,
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
            value: formatAreaList(names),
          },
        ],
        href: `/permits/${row.permitId}`,
        decidable: true,
      };
    });
  }

  private async variationItems(
    caller: string,
    roles: string[],
  ): Promise<Omit<InboxItem, "unread">[]> {
    // Who may decide a variation, per the route in ContractsController.
    if (!roles.includes("estates_head") && !roles.includes("admin")) return [];
    const tx = currentTx();
    if (!tx) throw AppError.internal();

    const rows = await tx.db
      .select({
        id: schema.variation.id,
        contractId: schema.variation.contractId,
        number: schema.variation.number,
        descriptionEl: schema.variation.descriptionEl,
        value: schema.variation.value,
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
        { label: "Αξία", value: `${row.value} EUR` },
        { label: "Επίπτωση χρόνου", value: `${row.timeImpactDays} ημέρες` },
        { label: "Αιτία", value: row.reason },
      ],
      // S08. A variation moves money, so it is decided on the screen that
      // shows the contract's figures, not from a three-fact card.
      href: `/contracts/${row.contractId}/variations`,
      decidable: false,
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
      return next !== undefined && CERT_ROLES[next].some((role) => roles.includes(role));
    });
    if (!waiting.length) return [];

    const rows = await tx.db
      .select({
        id: schema.paymentCert.id,
        number: schema.paymentCert.number,
        status: schema.paymentCert.status,
        netPayable: schema.paymentCert.netPayable,
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
          { label: "Καθαρό πληρωτέο", value: `${row.netPayable} EUR` },
          { label: "Περίοδος", value: `${row.periodFrom} – ${row.periodTo}` },
          { label: "Κατάσταση", value: row.status },
        ],
        href: `/certificates/${row.id}`,
        decidable: false,
      }));
  }
}
