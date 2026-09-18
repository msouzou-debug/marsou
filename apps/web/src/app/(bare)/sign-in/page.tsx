// S00 — R01, R43

import Image from "next/image";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSession } from "@/auth/session";
import { HelpSection } from "@/help/HelpSection";
import { SignInForm } from "@/screens/s00-sign-in/SignInForm";

// The one screen outside the shell (see src/app/(bare)/layout.tsx): a centred
// card, 400px at most, on the page background. No nav rail and no top bar,
// because nothing in either is reachable before signing in.
export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;

  // Already signed in: nothing to do here. Takes the visitor where they were
  // going instead of showing a form that would immediately bounce them.
  if (await getSession()) redirect(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");

  const t = await getTranslations("app");
  return (
    <main className="flex flex-1 items-center justify-center p-s-4">
      <div className="w-full max-w-[400px] rounded-k bg-k-white p-s-8 shadow-k">
        <Image
          src="/brand/okypy_icon.png"
          alt=""
          width={56}
          height={59}
          priority
          className="h-14 w-auto"
        />
        {/* RULE (UI instructions §3): the product name is Latin in both
            languages — «eCapital», never transliterated. */}
        <h1 className="mt-s-4 text-fs-24 font-bold text-k-blue-deep">eCapital</h1>
        <p className="mt-s-1 text-fs-16 text-k-text">{t("tagline")}</p>

        <SignInForm next={next} showDevAccounts={process.env.NEXT_PUBLIC_DEV_AUTH === "1"} />
      </div>
      <HelpSection route="/sign-in" />
    </main>
  );
}
