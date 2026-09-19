"use client";

// HelpProvider — the client-side home of the S25 help drawer (R48). It is
// mounted once, in the root layout, above `AppShell` and every page, so it
// survives client-side navigation between routes while `page.tsx` remounts
// underneath it.
//
// Server -> client handoff for the per-route section (see
// `apps/web/src/help/HelpSection.tsx` for the full picture): the route
// cannot be known inside this client provider without a router hook and a
// second render pass, and the manual's Markdown must be read on the server.
// Instead each page renders `<HelpSection route="..." />`, a Server
// Component that loads the Markdown, renders it with `react-markdown` (also
// server-side — it is a synchronous, hook-free component), and passes the
// resulting React tree as `children` into `RegisterHelpSection`, a small
// Client Component. `RegisterHelpSection` pushes that pre-rendered node (and
// the section's persona list) into this context on mount via
// `registerSection`, and clears it on unmount. `HelpDrawer` itself always
// renders here, reading whatever is currently registered — no portal, no
// DOM node to render into, since the drawer already needs to sit outside
// the page tree (it must survive the page unmounting while the drawer is
// open). This is the "React context set by the provider, plus a client
// RegisterHelpSection" option named in the build task, chosen over a portal
// because there is no stable DOM node inside `page.tsx` to portal from.
import { useCallback, useMemo, useRef, useState, createContext, useContext, useEffect, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { AppRole } from "@ecapital/shared";
import { HelpDrawer } from "@/components/help-drawer";
import type { Locale } from "@/i18n/config";

interface RegisteredSection {
  node: ReactNode;
  personas: string[];
}

export interface HelpContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  /** Registers the current page's rendered section. Returns an unregister
   *  function to call from the caller's cleanup (unmount). */
  registerSection: (node: ReactNode, personas: string[]) => () => void;
}

const HelpContext = createContext<HelpContextValue | null>(null);

// R02's eight personas (build brief §1) — display labels for the footer's
// «Οδηγός PDF για [ρόλος]» link. Persona ids come from help/map.json.
const ROLE_LABEL_KEYS: Record<string, string> = {
  project_engineer: "help.roles.projectEngineer",
  estates_head: "help.roles.estatesHead",
  technician: "help.roles.technician",
  finance: "help.roles.finance",
  clinical_approver: "help.roles.clinicalApprover",
  executive_readonly: "help.roles.executiveReadonly",
  admin: "help.roles.admin",
  auditor_readonly: "help.roles.auditorReadonly",
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export interface HelpProviderProps {
  children: ReactNode;
  /** The signed-in user's first role (`Me.roles[0]`, apps/web/src/auth/session.ts),
   *  passed down from `src/app/(app)/layout.tsx`. Drives the footer's
   *  «Οδηγός PDF για {role}» link (R50): the guide is the reader's own
   *  persona guide, not the guide for whatever screen they happen to be on.
   *  Undefined when there is no session (or the user has no role yet) —
   *  the link then falls back to the help centre, which lists all sixteen. */
  userRole?: AppRole;
}

export function HelpProvider({ children, userRole }: HelpProviderProps) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const [isOpen, setIsOpen] = useState(false);
  const [section, setSection] = useState<RegisteredSection | null>(null);
  const nextIdRef = useRef(0);
  const activeIdRef = useRef<number | null>(null);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((value) => !value), []);

  const registerSection = useCallback((node: ReactNode, personas: string[]) => {
    const id = ++nextIdRef.current;
    activeIdRef.current = id;
    setSection({ node, personas });
    return () => {
      // Guards against an old page's cleanup clearing a newer page's
      // registration when navigation mounts the next page before the
      // previous one unmounts.
      if (activeIdRef.current === id) {
        activeIdRef.current = null;
        setSection(null);
      }
    };
  }, []);

  // RULE (UI instructions §5, §7): "?" (Shift+/) toggles the drawer, Esc
  // closes it (Esc itself is handled by HelpDrawer). Ignored while focus is
  // in a form control or contenteditable, so it never fights normal typing.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "?" || isTypingTarget(event.target)) return;
      event.preventDefault();
      setIsOpen((value) => !value);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const value = useMemo<HelpContextValue>(
    () => ({ isOpen, open, close, toggle, registerSection }),
    [isOpen, open, close, toggle, registerSection],
  );

  // The footer PDF link is the signed-in user's own persona guide (R50),
  // not a guide for whichever screen's section happens to be registered —
  // those are two different personas whenever an admin looks at a
  // technician's screen, say. Falls back to the help centre (which lists
  // all sixteen guides) when there is no session role to build a link from.
  const roleLabel = userRole ? t(ROLE_LABEL_KEYS[userRole] ?? "common.user") : t("common.user");
  const pdfHref = userRole ? `/guides/${userRole}.${locale}.pdf` : "/help";

  return (
    <HelpContext.Provider value={value}>
      {children}
      <HelpDrawer open={isOpen} onClose={close} role={roleLabel} pdfHref={pdfHref} helpCentreHref="/help">
        {section?.node}
      </HelpDrawer>
    </HelpContext.Provider>
  );
}

export function useHelp(): HelpContextValue {
  const ctx = useContext(HelpContext);
  if (!ctx) throw new Error("useHelp must be used within a HelpProvider");
  return ctx;
}
