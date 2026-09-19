// S08 — R10 (ADR-0015)

import { getSession } from "@/auth/session";
import { NoPermission } from "@/components/app-shell";
import { HelpSection } from "@/help/HelpSection";
import { VariationsScreen } from "@/screens/s08-variations/VariationsScreen";

// NOTE (flagged, not guessed): the raiser comparison this screen needs
// (`variation.raisedById === ?`) has no matching field in `Me` — `Me.sub`
// is the token's own subject string (`user.subject` in `auth.service.ts`,
// e.g. "dev-engineer-larnaca"), while `Variation.raisedById` is the
// `app_user` row's UUID (`ContractsService.callerId()`). The two are never
// equal, and `packages/shared`/`apps/api` are out of scope for this build,
// so there is no shared identifier the client can compare exactly. This
// passes `me.name` instead, compared against `variation.raisedByName` — a
// real but weaker check (two colleagues could share a display name) that
// only ever adjusts the UI; the API's own `errors.sameUserApproval` (by the
// real id) is what actually stops a self-approval either way.
export default async function ContractVariationsPage({ params }: PageProps<"/contracts/[id]/variations">) {
  const { id } = await params;
  const session = await getSession();
  return (
    <>
      <VariationsScreen
        contractId={id}
        roles={session?.me.roles ?? []}
        meName={session?.me.name ?? ""}
        noPermission={<NoPermission />}
      />
      <HelpSection route="/contracts/[id]/variations" />
    </>
  );
}
