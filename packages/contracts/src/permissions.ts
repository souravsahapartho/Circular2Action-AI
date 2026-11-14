/** Role to permission map (plan SEC-04). Deny by default: a route without a declared permission fails the build (SEC-06). */
export const ROLES = [
  'user',
  'employer',
  'editor',
  'verifier',
  'moderator',
  'source_manager',
  'analyst',
  'admin',
  'super_admin',
] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'admin.view',
  'opportunity.read',
  'opportunity.write',
  'opportunity.publish',
  'opportunity.verify',
  'opportunity.merge',
  'opportunity.remove',
  'extraction.review',
  'extraction.approve',
  'source.read',
  'source.manage',
  'organization.manage',
  'organization.verify',
  'user.read',
  'user.moderate',
  'user.manage_roles',
  'report.handle',
  'ai.monitor',
  'ai.operate',
  'system.view',
  'system.operate',
  'settings.view',
  'settings.manage',
  'analytics.view',
  'audit.view',
  'application.read',
  'application.manage',
  'listing.manage',
  'employer.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const editor: Permission[] = [
  'admin.view',
  'opportunity.read',
  'opportunity.write',
  'organization.manage',
  'application.read',
  'application.manage',
];
const verifier: Permission[] = [
  'extraction.review',
  'extraction.approve',
  'opportunity.verify',
  'opportunity.publish',
  'opportunity.merge',
  'application.read',
  'application.manage',
];
const moderator: Permission[] = ['report.handle', 'user.read', 'user.moderate'];
const sourceManager: Permission[] = ['source.read', 'source.manage', 'organization.verify'];
const analyst: Permission[] = ['analytics.view'];
const adminExtra: Permission[] = [
  'ai.monitor',
  'ai.operate',
  'system.view',
  'system.operate',
  'settings.view',
  'audit.view',
  'listing.manage',
];

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  user: new Set(),
  employer: new Set<Permission>(['employer.manage']),
  editor: new Set(editor),
  verifier: new Set<Permission>(['admin.view', 'opportunity.read', ...verifier]),
  moderator: new Set<Permission>(['admin.view', ...moderator]),
  source_manager: new Set<Permission>(['admin.view', ...sourceManager]),
  analyst: new Set<Permission>(['admin.view', ...analyst]),
  admin: new Set<Permission>([
    'admin.view',
    ...editor,
    ...verifier,
    ...moderator,
    ...sourceManager,
    ...analyst,
    ...adminExtra,
  ]),
  super_admin: new Set<Permission>(PERMISSIONS),
};

/** Staff roles need the second factor and short sessions. A plain user and an employer are not staff. */
export function isStaffRole(role: Role): boolean {
  return role !== 'user' && role !== 'employer';
}

export function hasPermission(roles: readonly Role[], permission: Permission): boolean {
  return roles.some((r) => ROLE_PERMISSIONS[r].has(permission));
}
