// Per-page half of the contextual help drawer (R48; UI instructions §5
// S25). A Server Component so it can read the locale (`getLocale`) and the
// manual's Markdown off disk (`loadHelpSection`) without shipping either to
// the client. See `HelpProvider.tsx` for why the result crosses into
// `RegisterHelpSection` as pre-rendered `children` rather than through a
// portal or prop drilling.
//
// Usage: `<HelpSection route="/" />` once per `page.tsx`. A screen with no
// `<HelpSection>` (e.g. /preview) never registers anything, so the drawer
// falls back to HelpDrawer's own unwritten-section empty state.
import { getLocale } from "next-intl/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Locale } from "@/i18n/config";
import { loadHelpSection } from "./load-section";
import { helpMarkdownComponents } from "./markdown-components";
import { RegisterHelpSection } from "./RegisterHelpSection";

export interface HelpSectionProps {
  /** The route as it appears in help/map.json, e.g. "/" or "/projects". */
  route: string;
}

export async function HelpSection({ route }: HelpSectionProps) {
  const locale = (await getLocale()) as Locale;
  const { markdown, personas } = loadHelpSection(route, locale);

  if (!markdown) return null;

  return (
    <RegisterHelpSection personas={personas}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={helpMarkdownComponents}>
        {markdown}
      </ReactMarkdown>
    </RegisterHelpSection>
  );
}
