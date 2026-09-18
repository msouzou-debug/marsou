import { getTranslations } from "next-intl/server";
import { PageTitle } from "@/components/app-shell";

// Placeholder until S01 lands on this route. Screen id: S01.
export default async function Home() {
  const [app, nav] = await Promise.all([getTranslations("app"), getTranslations("nav")]);
  return (
    <>
      <PageTitle eyebrow={app("org")} title={nav("portfolio")} />
      <p className="text-fs-16">{app("tagline")}</p>
    </>
  );
}
