import { invalid } from './ids';
export const memberRoles = ['platform_super_admin', 'insurer_admin', 'insurer_claims', 'insurer_accounts', 'fleet_admin', 'fleet_manager', 'fleet_accounts', 'driver'] as const;
export type MemberRole = (typeof memberRoles)[number];
export function memberRole(value: unknown): MemberRole {
  if (!memberRoles.includes(value as MemberRole)) throw invalid('Choose a valid role.');
  return value as MemberRole;
}
export function memberEmail(value: unknown): string {
  const email = String(value ?? '').trim().toLowerCase();
  if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw invalid('Enter a valid email address.');
  return email;
}
export const roleLabels: Record<MemberRole, string> = {
  platform_super_admin: 'Platform administrator', insurer_admin: 'Insurer administrator', insurer_claims: 'Insurer claims',
  insurer_accounts: 'Insurer accounts', fleet_admin: 'Fleet administrator', fleet_manager: 'Fleet manager', fleet_accounts: 'Fleet accounts', driver: 'Driver'
};
export const rolesForKind = (kind: string): MemberRole[] =>
  kind === 'platform' ? ['platform_super_admin'] : kind === 'insurer' ? ['insurer_admin', 'insurer_claims', 'insurer_accounts'] : ['fleet_admin', 'fleet_manager', 'fleet_accounts', 'driver'];
