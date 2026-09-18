import { getTranslations } from "next-intl/server";

// Placeholder until S01 lands on this route. Screen id: S01.
export default async function Home() {
  const t = await getTranslations("app");
  return (
    <main className="p-s-8">
      <p className="eyebrow text-k-text-muted">{t("org")}</p>
      <h1 className="text-fs-24">{t("name")}</h1>
      <p className="text-fs-16">{t("tagline")}</p>
    </main>
  );
}
