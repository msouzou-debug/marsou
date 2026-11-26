import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "@/test/render";
import { formatFileSize } from "@/lib/format";
import { AttachmentField } from "./AttachmentField";
import { CorrespondenceSection } from "./CorrespondenceSection";
import { SaveButtons } from "./MailActions";

// Owner request 26/11/2026: the pieces the RFI and the site instruction share.

function Field({ maxBytes, onChange = vi.fn() }: { maxBytes?: number; onChange?: (files: File[]) => void }) {
  const [files, setFiles] = useState<File[]>([]);
  return (
    <AttachmentField
      id="att"
      label="Επιστολή ή e-mail"
      files={files}
      maxBytes={maxBytes}
      onChange={(next) => {
        setFiles(next);
        onChange(next);
      }}
    />
  );
}

describe("AttachmentField", () => {
  it("adds one or more files, lists each with its size, and removes one", async () => {
    const user = userEvent.setup();
    renderWithIntl(<Field />);
    const a = new File(["%PDF"], "Επιστολή.pdf", { type: "application/pdf" });
    const b = new File(["x"], "sent.msg", { type: "" });
    await user.upload(screen.getByLabelText("Επιστολή ή e-mail"), [a, b]);
    const list = within(screen.getByRole("list", { name: "Αρχεία προς επισύναψη" }));
    expect(list.getAllByRole("listitem")).toHaveLength(2);
    await user.click(list.getByRole("button", { name: "Αφαίρεση Επιστολή.pdf" }));
    expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("list")).toHaveTextContent("sent.msg");
  });

  it("lists a file picked twice once", async () => {
    const user = userEvent.setup();
    renderWithIntl(<Field />);
    const a = new File(["%PDF"], "a.pdf", { type: "application/pdf", lastModified: 1 });
    await user.upload(screen.getByLabelText("Επιστολή ή e-mail"), a);
    await user.upload(screen.getByLabelText("Επιστολή ή e-mail"), a);
    expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(1);
  });

  it("refuses an empty file and one over the limit, and says which and why", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithIntl(<Field maxBytes={3} onChange={onChange} />);
    await user.upload(screen.getByLabelText("Επιστολή ή e-mail"), [
      new File([], "empty.pdf", { type: "application/pdf" }),
      new File(["1234"], "big.pdf", { type: "application/pdf" }),
    ]);
    const alerts = screen.getAllByRole("alert").map((a) => a.textContent);
    expect(alerts).toEqual([
      "Το αρχείο «empty.pdf» είναι κενό και δεν προστέθηκε.",
      `Το αρχείο «big.pdf» είναι μεγαλύτερο από ${formatFileSize(3)} και δεν προστέθηκε.`,
    ]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("accepts what the RFI correspondence upload accepts, and says the limit", () => {
    renderWithIntl(<Field />);
    const input = screen.getByLabelText("Επιστολή ή e-mail");
    expect(input).toHaveAttribute("accept", ".msg,.eml,.pdf,application/pdf,message/rfc822,application/vnd.ms-outlook");
    expect(input).toHaveAttribute("multiple");
    expect(input).toHaveAccessibleDescription(`Ένα ή περισσότερα αρχεία .msg, .eml ή .pdf, έως ${formatFileSize(50 * 1024 * 1024)} το καθένα.`);
  });
});

describe("SaveButtons", () => {
  it("disables «Αποθήκευση και αποστολή e-mail» without a recipient e-mail and says why in text", () => {
    renderWithIntl(<SaveButtons idPrefix="x" saving={false} canSendMail hasRecipient={false} onSaveAndSend={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Αποθήκευση και αποστολή e-mail" })).toBeDisabled();
    expect(screen.getByText("Για αποστολή με e-mail συμπληρώστε πρώτα το e-mail του παραλήπτη.")).toBeVisible();
  });

  it("sends when there is a recipient, and explains what happens in Outlook", async () => {
    const user = userEvent.setup();
    const onSaveAndSend = vi.fn();
    renderWithIntl(<SaveButtons idPrefix="x" saving={false} canSendMail hasRecipient onSaveAndSend={onSaveAndSend} />);
    await user.click(screen.getByRole("button", { name: "Αποθήκευση και αποστολή e-mail" }));
    expect(onSaveAndSend).toHaveBeenCalledOnce();
    expect(screen.getByText(/Ελέγξτε το και πατήστε «Αποστολή» στο Outlook\./)).toBeInTheDocument();
  });

  it("offers only «Αποθήκευση» when no message can be written", () => {
    renderWithIntl(<SaveButtons idPrefix="x" saving={false} canSendMail={false} hasRecipient onSaveAndSend={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Αποθήκευση" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Αποθήκευση και αποστολή e-mail" })).not.toBeInTheDocument();
  });
});

describe("CorrespondenceSection", () => {
  it("says which files a save could not file and why, and opens the upload form for the retry", () => {
    renderWithIntl(
      <CorrespondenceSection
        idPrefix="x"
        documents={[]}
        onUpload={vi.fn()}
        hint="Επισυνάψτε το μήνυμα."
        failures={[{ filename: "scan.pdf", message: "Το αρχείο είναι πολύ μεγάλο." }]}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("«scan.pdf»: Το αρχείο είναι πολύ μεγάλο.");
    expect(screen.getByLabelText("Αρχείο")).toBeInTheDocument();
  });

  it("lists nothing to upload without `onUpload` (no permission, or offline), and says when it is loading", () => {
    renderWithIntl(<CorrespondenceSection idPrefix="x" hint="" />);
    expect(screen.getByText("Φόρτωση")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Επισύναψη αρχείου" })).not.toBeInTheDocument();
  });
});
