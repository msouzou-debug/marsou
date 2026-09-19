"use client";

// S14 — R22
//
/**
 * ApprovalsScreen — the network-aware wrapper around `Approvals`. Owns
 * `useInbox`, `POST /inbox/:id/read` (fired the moment a panel opens, deep
 * link included — item 6's "mark read on open") and the decide mutation.
 *
 * RULE (ASSUMPTION, flagged in the hand-back summary): the endpoint list has
 * no "decide from the inbox" route of its own — deciding is
 * `POST /permits/:id/approvals/:approvalId/decide`, which needs both the
 * permit id and the approval-line id, while `InboxItem` carries only one
 * `id`. Per the contract's own comment ("the approval line id (permit) …"),
 * this reads `item.id` as the approval-line id for a SHUTDOWN item and
 * recovers the permit id from `item.href` (`/permits/<id>`).
 */
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";
import type { InboxItem, ShutdownPermit } from "@ecapital/shared";
import { ShutdownPermit as ShutdownPermitSchema } from "@ecapital/shared";
import { ApiError, apiMutate } from "@/data/client";
import { useInbox } from "@/data/queries";
import { Approvals, type ApprovalsScreenState } from "./Approvals";
import type { ReactNode } from "react";

export interface ApprovalsScreenProps {
  noPermission: ReactNode;
}

function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);
  return online;
}

function permitIdFromHref(href: string): string | null {
  const match = /^\/permits\/([^/]+)/.exec(href);
  return match ? decodeURIComponent(match[1]) : null;
}

export function ApprovalsScreen({ noPermission }: ApprovalsScreenProps) {
  const { data, error, isLoading, refetch } = useInbox();
  const online = useOnlineStatus();
  const router = useRouter();
  const searchParams = useSearchParams();
  const openItemId = searchParams.get("item");
  // A plain ref, not state: this only deduplicates the `read` call across
  // renders and never drives anything visual, so tracking it in `useState`
  // would just be an extra render for nothing (and the deep-link effect
  // below would then be "calling setState directly in an effect" for a
  // value nothing ever reads back from render).
  const readIds = useRef<Set<string>>(new Set());

  let state: ApprovalsScreenState;
  if (!online && data) {
    state = "offline";
  } else if (isLoading) {
    state = "loading";
  } else if (error) {
    state = error instanceof ApiError && (error.status === 403 || error.status === 404) ? "noPermission" : "error";
  } else if (data && data.items.length === 0) {
    state = "empty";
  } else {
    state = "default";
  }

  function open(id: string) {
    router.push(`/approvals?item=${encodeURIComponent(id)}`);
    if (!readIds.current.has(id)) {
      readIds.current.add(id);
      void apiMutate(`/inbox/${encodeURIComponent(id)}/read`, "POST", undefined, z.unknown());
    }
  }

  function close() {
    router.push("/approvals");
  }

  async function decide(item: InboxItem, decision: "APPROVED" | "RETURNED" | "REJECTED", comment?: string): Promise<void> {
    if (item.type !== "SHUTDOWN") return; // RULE: only permit approvals decide inline; others open via `belowFooter`.
    const permitId = permitIdFromHref(item.href);
    if (!permitId) return;
    await apiMutate<ShutdownPermit>(
      `/permits/${encodeURIComponent(permitId)}/approvals/${encodeURIComponent(item.id)}/decide`,
      "POST",
      { decision, commentEl: comment ?? null },
      ShutdownPermitSchema,
    );
    close();
    await refetch();
  }

  // Deep link on first load: mark read without waiting for a click.
  useEffect(() => {
    if (openItemId && !readIds.current.has(openItemId)) {
      readIds.current.add(openItemId);
      void apiMutate(`/inbox/${encodeURIComponent(openItemId)}/read`, "POST", undefined, z.unknown());
    }
  }, [openItemId]);

  return (
    <Approvals
      items={data?.items}
      state={state}
      openItemId={openItemId}
      onOpen={open}
      onClose={close}
      onDecide={(item, decision, comment) => void decide(item, decision, comment)}
      onRetry={() => void refetch()}
      noPermission={noPermission}
    />
  );
}
