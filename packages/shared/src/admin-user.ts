import { z } from "zod";
import { AppRole, AuthMode } from "./auth";

/**
 * S24 «Χρήστες» and the API's `admin-users` module — per-user role
 * administration (ADR-0020, R01, R02, R42).
 *
 * Roles are assigned to a person by an administrator inside eCapital, the way
 * eFinance does it. Active Directory says who somebody is and nothing more.
 * `role_mapping` survives as an optional group→role layer and is empty by
 * default; a sign-in unions the two and never deletes what an administrator
 * assigned by hand.
 */

// One row of Διαχείριση › Χρήστες.
export const AdminUser = z.object({
  id: z.string().uuid(),
  /** `app_user.subject`: the AD objectGUID, `ad:<sAMAccountName>` before the
   *  first sign-in adopts one, or the seeded `dev-*` subject. */
  subject: z.string(),
  /** The sAMAccountName the person types, or the seeded account's address. */
  username: z.string(),
  name: z.string(),
  email: z.string(),
  authSource: AuthMode,
  active: z.boolean(),
  roles: z.array(AppRole),
  orgUnitIds: z.array(z.string()),
  /** Null until the account has signed in once. */
  lastSignInAt: z.string().nullable(),
  createdAt: z.string(),
});
export type AdminUser = z.infer<typeof AdminUser>;

export const AdminUserList = z.object({
  items: z.array(AdminUser),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type AdminUserList = z.infer<typeof AdminUserList>;

// Paged and filtered like `GET /projects`. `active` is tri-state: left out
// it means "everybody", which is what an administrator looking for a
// deactivated account wants.
export const AdminUserListQuery = z.object({
  q: z.string().default(""),
  role: z.array(AppRole).default([]),
  unit: z.array(z.string()).default([]),
  active: z.boolean().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(200).default(50),
});
export type AdminUserListQuery = z.infer<typeof AdminUserListQuery>;

/**
 * Pre-registering an AD account before its first sign-in. The subject is
 * `ad:<username>` until the first LDAP bind replaces it with the objectGUID,
 * so the roles set here are the roles that account has the moment it arrives.
 *
 * In `dev` mode the same route creates a seeded-style account, and `username`
 * is the address it signs in with.
 */
export const AdminUserCreate = z.object({
  username: z.string().trim().min(1).max(128),
  name: z.string().trim().min(1).max(200).optional(),
  email: z.string().trim().email().optional(),
  roles: z.array(AppRole).default([]),
  orgUnitIds: z.array(z.string()).default([]),
});
export type AdminUserCreate = z.infer<typeof AdminUserCreate>;

export const AdminUserUpdate = z.object({
  roles: z.array(AppRole).optional(),
  orgUnitIds: z.array(z.string()).optional(),
  active: z.boolean().optional(),
  name: z.string().trim().min(1).max(200).optional(),
});
export type AdminUserUpdate = z.infer<typeof AdminUserUpdate>;
