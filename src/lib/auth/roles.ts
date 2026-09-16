/**
 * Role vocabulary, per ARCHITECTURE.md §15.
 *
 * Deliberately free of server-only imports so client components can use it:
 * anything that touches `next/headers` belongs in session.ts instead.
 */

export type Role =
  'consultant' | 'manager' | 'leader' | 'head_of_department' | 'admin' | 'super_admin';

export const ROLE_LABELS: Record<Role, string> = {
  consultant: 'Consultant',
  manager: 'Manager',
  leader: 'Leader',
  head_of_department: 'Head of Department',
  admin: 'Admin',
  super_admin: 'Super Admin',
};

/** The roles §15 permits to approve access requests. */
export const APPROVER_ROLES: Role[] = ['admin', 'super_admin'];

/**
 * Roles whose deal visibility is defined by position in the hierarchy, so a
 * manager must be assigned when granting them (§15).
 */
export const ROLES_REQUIRING_MANAGER: Role[] = ['consultant', 'manager'];

export function isApprover(role: Role | null): boolean {
  return role !== null && APPROVER_ROLES.includes(role);
}
