"use client";

// S24 «Χρήστες» — R01, R02, R42 (ADR-0020)
//
// UsersScreen — the network-aware wrapper around `Users`. Owns the two
// queries (`GET /admin/users`, `GET /admin/roles`), the filter state and the
// create/update mutations (`POST /admin/users`, `PATCH /admin/users/:id`).
//
// The four rules an administrator can break — their own lockout, the last
// administrator, the auditor, a unit role with no unit — come back as 422
// with a sentence already in the caller's language (the API's exception
// filter reads Accept-Language), so `sheetApiError` is shown as it arrives
// rather than being re-translated from the key.
import { useEffect, useState, type ReactNode } from "react";
import type { AdminUser, OrgUnit } from "@ecapital/shared";
import { AdminUser as AdminUserSchema } from "@ecapital/shared";
import { ApiError, apiMutate } from "@/data/client";
import { useAdminUsers, useRoleCatalogue } from "@/data/queries";
import type { UserFormValues } from "./schema";
import { Users, type UsersFilters, type UsersScreenState } from "./Users";

export interface UsersScreenProps {
  orgUnits: OrgUnit[];
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

const NO_FILTERS: UsersFilters = { q: "", role: "", unit: "", active: "" };

export function UsersScreen({ orgUnits, noPermission }: UsersScreenProps) {
  const [filters, setFilters] = useState<UsersFilters>(NO_FILTERS);
  const { data, error, isLoading, refetch } = useAdminUsers(filters);
  const catalogue = useRoleCatalogue();
  const online = useOnlineStatus();
  const [selectedId, setSelectedId] = useState<string | "new" | null>(null);
  const [saving, setSaving] = useState(false);
  const [apiError, setApiError] = useState<string | undefined>(undefined);

  const failure = error ?? catalogue.error;
  let state: UsersScreenState;
  if (!online && data) {
    state = "offline";
  } else if (isLoading || catalogue.isLoading) {
    state = "loading";
  } else if (failure) {
    state =
      failure instanceof ApiError && (failure.status === 403 || failure.status === 404)
        ? "noPermission"
        : "error";
  } else if (data && data.items.length === 0) {
    state = "empty";
  } else {
    state = "default";
  }

  function selectRow(id: string | "new" | null) {
    setApiError(undefined);
    setSelectedId(id);
  }

  async function handleSave(values: UserFormValues): Promise<void> {
    setSaving(true);
    setApiError(undefined);
    try {
      if (selectedId === "new") {
        await apiMutate<AdminUser>(
          "/admin/users",
          "POST",
          {
            username: values.username,
            name: values.name || undefined,
            email: values.email || undefined,
            roles: values.roles,
            orgUnitIds: values.orgUnitIds,
          },
          AdminUserSchema,
        );
      } else if (selectedId) {
        await apiMutate<AdminUser>(
          `/admin/users/${encodeURIComponent(selectedId)}`,
          "PATCH",
          {
            name: values.name,
            roles: values.roles,
            orgUnitIds: values.orgUnitIds,
            active: values.active,
          },
          AdminUserSchema,
        );
      }
      setSelectedId(null);
      await refetch();
    } catch (submitError) {
      // The API's own sentence — «Δεν αφαιρείτε τον δικό σας ρόλο
      // διαχειριστή…» and the other three — shown inline in the sheet.
      setApiError(submitError instanceof ApiError ? submitError.message : String(submitError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Users
      data={data?.items}
      state={state}
      catalogue={catalogue.data ?? []}
      orgUnits={orgUnits}
      filters={filters}
      onFilters={(next) => {
        selectRow(null);
        setFilters(next);
      }}
      onRetry={() => void refetch()}
      noPermission={noPermission}
      selectedId={selectedId}
      onSelect={selectRow}
      sheetSaving={saving}
      sheetApiError={apiError}
      onSave={(values) => void handleSave(values)}
    />
  );
}
