// S07e — R08
//
// ADR-0019. This route is eCapital's half of the link eFinance already has to
// eMAP: an invoice carries a `contract_ref`, eFinance routes it by prefix —
// `CON-` opens eMAP's `/contracts?q=`, `CAP-` opens this — and neither system
// needs to know anything about the other's ids.
//
// With a `q` it resolves the reference on the server and redirects, so nobody
// sees a list flash past on the way to the contract they asked for. Without
// one it lists the caller's own contracts, which is also where somebody lands
// when the reference matches nothing.

import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ContractLookup } from "@ecapital/shared";
import { NoPermission } from "@/components/app-shell";
import { PageTitle } from "@/components/app-shell";
import { serverApi } from "@/data/server";
import { HelpSection } from "@/help/HelpSection";
import { ContractsScreen } from "@/screens/s07e-contracts/ContractsScreen";

export default async function ContractsPage({ searchParams }: PageProps<"/contracts">) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim() : "";

  if (q) {
    const found = await resolve(q);
    // RULE: `redirect()` throws to unwind the render, so it is called outside
    // the try that swallows the 404 — otherwise the redirect would be caught
    // and read as "no such contract".
    if (found) redirect(`/contracts/${encodeURIComponent(found)}`);

    const t = await getTranslations("screens.s07e");
    return (
      <>
        <PageTitle eyebrow={t("eyebrow")} title={t("notFoundTitle")} />
        <div className="rounded-k border border-k-grey bg-k-white p-s-8">
          {/* RULE (UI instructions §6): say what happened and what to do
              next — never a code, and never a dead end. */}
          <p className="text-fs-16 text-k-ink">{t("notFound", { q })}</p>
          <p className="mt-s-4 text-fs-14 text-k-text">{t("notFoundHint")}</p>
          <div className="mt-s-5 flex flex-wrap gap-s-4">
            <Link
              href="/contracts"
              className="text-fs-14 font-bold text-k-blue-deep underline-offset-2 hover:underline"
            >
              {t("allContracts")}
            </Link>
            <Link
              href="/projects"
              className="text-fs-14 font-bold text-k-blue-deep underline-offset-2 hover:underline"
            >
              {t("allProjects")}
            </Link>
          </div>
        </div>
        <HelpSection route="/contracts" />
      </>
    );
  }

  return (
    <>
      <ContractsScreen noPermission={<NoPermission />} />
      <HelpSection route="/contracts" />
    </>
  );
}

/** The id the reference names, or null — a 404 and an unreachable API alike. */
async function resolve(q: string): Promise<string | null> {
  const api = await serverApi();
  if (!api) return null;
  try {
    const { id } = await api.get(`/contracts/lookup?q=${encodeURIComponent(q)}`, ContractLookup);
    return id;
  } catch {
    // ADR-0010: 404 covers both "no such reference" and "not one of yours",
    // and the sentence is the same either way — on purpose.
    return null;
  }
}
