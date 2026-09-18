import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getPreviewEntry, getPreviewEntries } from "@/preview/registry";
import { previewStates } from "@/preview/types";
import { LocaleSwitch } from "../locale-switch";

export function generateStaticParams() {
  return getPreviewEntries().map((e) => ({ id: e.id }));
}

export default async function PreviewComponent({ params }: PageProps<"/preview/[id]">) {
  const { id } = await params;
  const entry = getPreviewEntry(id);
  if (!entry) notFound();
  const t = await getTranslations("preview");
  return (
    <main className="p-s-8 bg-k-surface min-h-screen">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/preview" className="text-fs-14 text-k-blue">← {t("title")}</Link>
          <h1 className="text-fs-24">{entry.title}</h1>
        </div>
        <LocaleSwitch />
      </div>
      {entry.notes && <p className="mt-s-2 text-fs-14 max-w-[680px]">{entry.notes}</p>}
      <div className="mt-s-6 grid gap-s-6">
        {previewStates.filter((s) => entry.states[s]).map((s) => (
          <section key={s} data-preview-state={s} className="bg-k-white rounded-k shadow-k p-s-6">
            <p className="eyebrow text-k-text mb-s-4">{t(`state.${s}`)}</p>
            {entry.states[s]!()}
          </section>
        ))}
      </div>
    </main>
  );
}
