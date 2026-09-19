// S26 (R50) — the help centre's list of the sixteen per-persona PDF guides.
//
// Pure: it takes the parsed index.json and renders it, so the page owns the
// "not generated yet" empty state (see load-guides-index.ts).
//
// | Prop         | Type          | Notes                                              |
// |--------------|---------------|-----------------------------------------------------|
// | guides       | GuideEntry[]  | From index.json, in build order (persona, then lang) |
// | generatedAt  | string        | ISO timestamp; same for every row in one build        |
//
// A plain semantic `<table>`, not the shared `Table` component
// (`@/components/table`): that component is built for sortable, exportable
// business-data grids (R03, R13); this is a short, static list of files with
// nothing to sort, filter or export, closer to the rest of S26's prose
// content than to a data screen. `<th scope="col">` still applies (UI
// instructions §7).
import { useTranslations } from "next-intl";
import type { GuideEntry } from "@/help/load-guides-index";
import { formatDate, formatFileSize } from "@/lib/format";

export interface GuideIndexTableProps {
  guides: GuideEntry[];
  generatedAt: string;
}

export function GuideIndexTable({ guides, generatedAt }: GuideIndexTableProps) {
  const t = useTranslations("screens.s26");
  const roles = useTranslations("roles");
  const updated = formatDate(generatedAt);

  if (guides.length === 0) {
    return <p className="max-w-[500px] text-fs-16 text-k-text">{t("empty")}</p>;
  }

  return (
    <table className="w-full border-collapse text-fs-14">
      <caption className="sr-only">{t("tableCaption")}</caption>
      <thead>
        <tr className="border-b border-k-grey text-left">
          <th scope="col" className="py-s-2 pr-s-4 font-bold text-k-text">
            {t("columns.persona")}
          </th>
          <th scope="col" className="py-s-2 pr-s-4 font-bold text-k-text">
            {t("columns.language")}
          </th>
          <th scope="col" className="num py-s-2 pr-s-4 text-right font-bold text-k-text">
            {t("columns.size")}
          </th>
          <th scope="col" className="py-s-2 pr-s-4 font-bold text-k-text">
            {t("columns.updated")}
          </th>
          <th scope="col" className="py-s-2 font-bold text-k-text">
            <span className="sr-only">{t("columns.download")}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {guides.map((guide) => (
          <tr key={`${guide.persona}.${guide.lang}`} className="border-b border-k-grey">
            <td className="py-s-2 pr-s-4">{roles(guide.persona)}</td>
            <td className="py-s-2 pr-s-4 uppercase">{guide.lang}</td>
            <td className="num py-s-2 pr-s-4 text-right">{formatFileSize(guide.sizeBytes)}</td>
            <td className="py-s-2 pr-s-4">{updated}</td>
            <td className="py-s-2">
              <a
                href={`/guides/${guide.file}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-k-blue underline-offset-2 hover:underline"
              >
                {t("columns.download")}
              </a>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
