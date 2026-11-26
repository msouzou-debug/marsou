"use client";

// S07c — R09 (ADR-0017)
//
// InstructionsScreen — the network-aware wrapper around `Instructions`, the
// same Screen/pure split as S07b's own pair. Reads the contract (eyebrow,
// tabs, the `instructionsWithoutVariation` warning and the variations array
// used to resolve a linked instruction's variation number) and the
// contract's own instruction list side by side.
//
// Owner request 26/11/2026 («site instructions need same facility to send
// e-mails as RFI»): it also reads the open instruction's correspondence
// (`useSiteInstructionDocuments`) and owns its upload, the one-click «sent
// today», and the new form's «Αποθήκευση και αποστολή e-mail» — the same
// order as the RFI's: the instruction first, then the Outlook draft, then
// each file; a file that fails never loses the instruction.
import { useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { AppRole, SiteInstruction, Variation } from "@ecapital/shared";
import {
  SiteInstruction as SiteInstructionSchema,
  SiteInstructionDocument,
  Variation as VariationSchema,
  nicosiaDateOf,
} from "@ecapital/shared";
import { useRouter } from "next/navigation";
import { ApiError, apiMutate, apiMutateMultipart } from "@/data/client";
import { useContract, useSiteInstructionDocuments, useSiteInstructions } from "@/data/queries";
import { contractFactsOf } from "@/lib/contract-recipient";
import { errorText, fileEach, filingTitle, type FilingReport } from "@/lib/file-each";
import { downloadBlob, emlBlob } from "@/lib/mail-draft";
import { Instructions, type InstructionsScreenState } from "./Instructions";
import type { InstructionSaveOptions } from "./InstructionSheet";
import { buildInstructionMail, instructionEmlFilename } from "./instruction-mail";
import type { InstructionFormValues } from "./schema";

export interface InstructionsScreenProps {
  contractId: string;
  roles: AppRole[];
  noPermission: ReactNode;
}

function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);
  return online;
}

/** Blank optional fields: left out of a new instruction, cleared (null) on an edit. */
function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function InstructionsScreen({ contractId, roles, noPermission }: InstructionsScreenProps) {
  const t = useTranslations();
  const contractQuery = useContract(contractId);
  const instructionsQuery = useSiteInstructions(contractId);
  const online = useOnlineStatus();
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | "new" | null>(null);
  const [sheetSaving, setSheetSaving] = useState(false);
  const [sheetApiError, setSheetApiError] = useState<string | undefined>(undefined);
  const [creatingVariationId, setCreatingVariationId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | undefined>(undefined);
  const [filingReport, setFilingReport] = useState<FilingReport | undefined>(undefined);
  const documentsQuery = useSiteInstructionDocuments(contractId, selectedId && selectedId !== "new" ? selectedId : null);
  const contract = contractQuery.data;

  let state: InstructionsScreenState;
  if (!online && (contractQuery.data || instructionsQuery.data)) {
    state = "offline";
  } else if (contractQuery.isLoading || instructionsQuery.isLoading) {
    state = "loading";
  } else if (contractQuery.error) {
    state = contractQuery.error instanceof ApiError && contractQuery.error.status === 404 ? "noPermission" : "error";
  } else if (instructionsQuery.error) {
    state = "error";
  } else if ((instructionsQuery.data?.length ?? 0) === 0) {
    state = "empty";
  } else {
    state = "default";
  }

  function selectRow(id: string | "new" | null) {
    setSheetApiError(undefined);
    setUploadError(undefined);
    setFilingReport(undefined);
    setSelectedId(id);
  }

  async function refetchAll(): Promise<void> {
    await Promise.all([contractQuery.refetch(), instructionsQuery.refetch()]);
  }

  const base = `/contracts/${encodeURIComponent(contractId)}/site-instructions`;

  /** One paper on one instruction; throws the API's refusal. */
  async function uploadTo(instructionId: string, file: File, titleEl: string): Promise<void> {
    const form = new FormData();
    form.append("file", file);
    if (titleEl) form.append("titleEl", titleEl);
    await apiMutateMultipart(`${base}/${encodeURIComponent(instructionId)}/documents`, form, SiteInstructionDocument);
  }

  /**
   * Owner request 26/11/2026, the RFI's order: the instruction (with today as
   * the sent day on «…και αποστολή e-mail»), then the Outlook draft
   * `SI-<number>.eml`, then each file as «Επιστολή οδηγίας — <name>». With
   * nothing to report the sheet closes; otherwise it opens on the saved
   * instruction and says what did not make it.
   */
  async function handleCreate(
    values: InstructionFormValues,
    options: InstructionSaveOptions = { files: [], sendMail: false },
  ): Promise<void> {
    setSheetSaving(true);
    setSheetApiError(undefined);
    setFilingReport(undefined);
    let created: SiteInstruction;
    try {
      const sentOn = options.sendMail ? nicosiaDateOf(new Date()) : blankToNull(values.sentOn);
      const body = {
        textEl: values.textEl.trim(),
        costImpactFlag: values.costImpactFlag,
        issuedOn: values.issuedOn,
        ...(blankToNull(values.recipientName) ? { recipientName: blankToNull(values.recipientName) } : {}),
        ...(blankToNull(values.recipientEmail) ? { recipientEmail: blankToNull(values.recipientEmail) } : {}),
        ...(sentOn ? { sentOn } : {}),
      };
      created = await apiMutate<SiteInstruction>(base, "POST", body, SiteInstructionSchema);
    } catch (submitError) {
      setSheetApiError(submitError instanceof ApiError ? submitError.message : String(submitError));
      setSheetSaving(false);
      return;
    }

    const report: FilingReport = { failures: [] };
    if (options.sendMail && created.recipientEmail && contract) {
      try {
        const mail = buildInstructionMail(
          {
            number: created.number,
            textEl: created.textEl,
            recipientEmail: created.recipientEmail,
            issuedAt: created.issuedAt,
            ...contractFactsOf(contract),
          },
          (key, vars) => t(`screens.s07c.email.${key}`, vars),
        );
        const filename = instructionEmlFilename(created.number);
        downloadBlob(await emlBlob(mail, options.files), filename);
        report.draftFile = filename;
      } catch (draftError) {
        report.draftError = errorText(draftError);
      }
    }
    report.failures = await fileEach(options.files, (file) =>
      uploadTo(created.id, file, filingTitle(t("screens.s07c.attachTitle"), file.name)),
    );

    await refetchAll();
    if (report.failures.length || report.draftFile || report.draftError) {
      setFilingReport(report);
      setSelectedId(created.id);
    } else {
      setSelectedId(null);
    }
    setSheetSaving(false);
  }

  /**
   * UAT 25/11/2026: correcting an instruction that has not become a variation.
   * The sheet goes back to its read view when this is true; a refusal
   * (errors.siteInstructionSettled, errors.dateInFuture) is shown verbatim.
   * Owner request 26/11/2026: and who it went to and when; blank clears.
   */
  async function handleUpdate(values: InstructionFormValues): Promise<boolean> {
    if (!selectedId || selectedId === "new") return false;
    setSheetSaving(true);
    setSheetApiError(undefined);
    try {
      await apiMutate<SiteInstruction>(
        `${base}/${encodeURIComponent(selectedId)}`,
        "PATCH",
        {
          textEl: values.textEl.trim(),
          costImpactFlag: values.costImpactFlag,
          issuedOn: values.issuedOn,
          recipientName: blankToNull(values.recipientName),
          recipientEmail: blankToNull(values.recipientEmail),
          sentOn: blankToNull(values.sentOn),
        },
        SiteInstructionSchema,
      );
      await refetchAll();
      return true;
    } catch (submitError) {
      setSheetApiError(submitError instanceof ApiError ? submitError.message : String(submitError));
      return false;
    } finally {
      setSheetSaving(false);
    }
  }

  /** Owner request 26/11/2026: «sent today» in one click, after «Αποστολή με e-mail». */
  async function handleMarkSent(sentOn: string): Promise<boolean> {
    if (!selectedId || selectedId === "new") return false;
    setSheetSaving(true);
    setSheetApiError(undefined);
    try {
      await apiMutate<SiteInstruction>(`${base}/${encodeURIComponent(selectedId)}`, "PATCH", { sentOn }, SiteInstructionSchema);
      await refetchAll();
      return true;
    } catch (submitError) {
      setSheetApiError(submitError instanceof ApiError ? submitError.message : String(submitError));
      return false;
    } finally {
      setSheetSaving(false);
    }
  }

  /** Owner request 26/11/2026: the sent e-mail or the letter, filed against the instruction. */
  async function handleUpload(file: File, titleEl: string): Promise<boolean> {
    if (!selectedId || selectedId === "new") return false;
    setUploading(true);
    setUploadError(undefined);
    try {
      await uploadTo(selectedId, file, titleEl);
      setFilingReport((report) =>
        report ? { ...report, failures: report.failures.filter((f) => f.filename !== file.name) } : report,
      );
      await documentsQuery.refetch();
      return true;
    } catch (submitError) {
      setUploadError(submitError instanceof ApiError ? submitError.message : String(submitError));
      return false;
    } finally {
      setUploading(false);
    }
  }

  // RULE (ADR-0017): only with cost impact, and only once — the API refuses
  // errors.noCostImpact / errors.alreadyLinked and this renders that
  // sentence verbatim (`ApiError.message` is already in the caller's
  // language) rather than a client-side guess at the wording.
  async function handleCreateVariation(instruction: SiteInstruction): Promise<void> {
    setCreatingVariationId(instruction.id);
    setSheetApiError(undefined);
    try {
      await apiMutate<Variation>(
        `${base}/${encodeURIComponent(instruction.id)}/variation`,
        "POST",
        undefined,
        VariationSchema,
      );
      setSelectedId(null);
      router.push(`/contracts/${encodeURIComponent(contractId)}/variations`);
    } catch (submitError) {
      setSheetApiError(submitError instanceof ApiError ? submitError.message : String(submitError));
    } finally {
      setCreatingVariationId(null);
    }
  }

  return (
    <Instructions
      contract={contract}
      instructions={instructionsQuery.data}
      state={state}
      onRetry={() => void refetchAll()}
      noPermission={noPermission}
      roles={roles}
      selectedId={selectedId}
      onSelect={selectRow}
      sheetSaving={sheetSaving}
      sheetApiError={sheetApiError}
      creatingVariationId={creatingVariationId}
      onCreate={(values, options) => void handleCreate(values, options)}
      onCreateVariation={(instruction) => void handleCreateVariation(instruction)}
      onUpdate={handleUpdate}
      onMarkSent={handleMarkSent}
      documents={documentsQuery.data}
      onUpload={handleUpload}
      uploading={uploading}
      uploadError={uploadError}
      filingReport={filingReport}
    />
  );
}
