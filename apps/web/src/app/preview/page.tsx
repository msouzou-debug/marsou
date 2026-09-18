import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getPreviewEntries } from "@/preview/registry";
import { LocaleSwitch } from "./locale-switch";

// Dev-only component gallery (ADR-0004). Not a product screen; excluded from
// the help-mapping check.
export default async function PreviewIndex() {
  const t = await getTranslations("preview");
  const entries = getPreviewEntries();
  return (
    <main className="p-s-8 max-w-[800px]">
      <div className="flex items-center justify-between">
        <h1 className="text-fs-24">{t("title")}</h1>
        <LocaleSwitch />
      </div>
      {entries.length === 0 ? (
        <p className="mt-s-6 text-fs-16">No components registered yet.</p>
      ) : (
        <ul className="mt-s-6 grid gap-s-2">
          {entries.map((e) => (
            <li key={e.id}>
              <Link href={`/preview/${e.id}`} className="text-k-blue underline-offset-2 hover:underline">
                {e.title}
              </Link>
              <span className="ml-s-2 text-fs-12 text-k-text">{Object.keys(e.states).join(" · ")}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
