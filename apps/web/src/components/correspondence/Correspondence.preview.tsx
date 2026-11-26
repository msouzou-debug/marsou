import type { PreviewEntry } from "@/preview/types";
import { AttachmentField } from "./AttachmentField";
import { CorrespondenceSection, type CorrespondenceDocument } from "./CorrespondenceSection";
import { SaveButtons } from "./MailActions";

// Plain data, not a client module: the gallery's /preview/[id] reads this entry's
// id on the server (see the VatFields entry's history).

const documents: CorrespondenceDocument[] = [
  {
    id: "doc-sent",
    titleEl: "Επιστολή αιτήματος — RFI-2.msg",
    filename: "RFI-2.msg",
    mime: "application/vnd.ms-outlook",
    size: 48_200,
    protocolNumber: null,
    uploadedByName: "Ελένη Χριστοδούλου",
    createdAt: "2026-11-26T08:30:00.000Z",
  },
  {
    id: "doc-reply",
    titleEl: "Απάντηση αναδόχου — Επιστολή 26-11.pdf",
    filename: "Επιστολή 26-11.pdf",
    mime: "application/pdf",
    size: 182_400,
    protocolNumber: "ΤΥ/2026/00042",
    uploadedByName: "Ελένη Χριστοδούλου",
    createdAt: "2026-11-26T11:10:00.000Z",
  },
];

const upload = async () => true;
const hint = "Επισυνάψτε το μήνυμα που στείλατε (.msg, .eml ή .pdf) ή την απάντηση που λάβατε.";
// Made when the state renders, not when the entry is imported on the server.
const picked = () => [new File(["%PDF"], "Επιστολή προς ανάδοχο.pdf", { type: "application/pdf" })];

const entry: PreviewEntry = {
  id: "correspondence",
  title: "Correspondence",
  states: {
    default: () => (
      <div className="grid max-w-[640px] gap-s-4">
        <AttachmentField id="preview-attachments" label="Επιστολή ή e-mail αιτήματος (προαιρετικά)" files={picked()} onChange={() => {}} />
        <form onSubmit={(event) => event.preventDefault()}>
          <SaveButtons idPrefix="preview" saving={false} canSendMail hasRecipient onSaveAndSend={() => {}} />
        </form>
        <CorrespondenceSection idPrefix="preview" documents={documents} onUpload={upload} hint={hint} />
      </div>
    ),
    loading: () => <CorrespondenceSection idPrefix="preview" onUpload={upload} hint={hint} />,
    empty: () => (
      <div className="grid max-w-[640px] gap-s-4">
        <form onSubmit={(event) => event.preventDefault()}>
          <SaveButtons idPrefix="preview-empty" saving={false} canSendMail hasRecipient={false} onSaveAndSend={() => {}} />
        </form>
        <CorrespondenceSection idPrefix="preview" documents={[]} onUpload={upload} hint={hint} />
      </div>
    ),
    error: () => (
      <CorrespondenceSection
        idPrefix="preview"
        documents={documents.slice(0, 1)}
        onUpload={upload}
        hint={hint}
        failures={[{ filename: "scan.pdf", message: "Ο τύπος αρχείου δεν γίνεται δεκτός από το eArchive." }]}
      />
    ),
    offline: () => <CorrespondenceSection idPrefix="preview" documents={documents} hint={hint} />,
    noPermission: () => <CorrespondenceSection idPrefix="preview" documents={documents} hint={hint} />,
  },
  notes:
    "Owner request 26/11/2026, shared by the RFI and the site instruction. «error» is a save whose files did not all make it: " +
    "the section names them and opens its upload form. Offline and without write access there is no upload (onUpload omitted); reading stays. " +
    "«empty» also shows «Αποθήκευση και αποστολή e-mail» disabled with its reason written under it.",
};

export default entry;
