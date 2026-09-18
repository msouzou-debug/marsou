"use client";

// S16 (lite) — R01

/**
 * The offline state (UI instructions §6): the tree the browser already has
 * stays on screen and says so. Read-only is the whole of it on this screen —
 * M0 has no write action here to queue or to disable.
 *
 * Not `OfflineChip`: that component reports a write queue draining, and S16
 * has no queue. The sentence here is `states.offline.readOnly`, which is the
 * one the brief writes for cached, read-only data.
 */

import { WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

export function OfflineNote() {
  const t = useTranslations("states.offline");
  // Starts "online" so the server-rendered markup matches the first client
  // render; the effect corrects it before paint if the browser disagrees.
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (online) return null;
  return (
    <p className="mb-s-4 inline-flex items-center gap-s-2 rounded-k-chip bg-k-amber-bg px-s-3 py-s-2 text-fs-14 text-k-ink">
      <WifiOff size={20} strokeWidth={1.5} aria-hidden="true" className="text-k-amber" />
      {t("readOnly")}
    </p>
  );
}
