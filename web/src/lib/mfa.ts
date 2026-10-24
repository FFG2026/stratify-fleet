// Two-factor sign-in helpers. The database is the real gate (see migration mfa_enforcement); these only steer people to the right page.
export const mfaRequiredForAdmins = () => process.env.REQUIRE_MFA_FOR_ADMINS === 'true';
export const adminRoles = ['platform_super_admin', 'insurer_admin', 'fleet_admin'];
export const codeProblem = (code: string) => (/^\d{6}$/.test(code) ? null : 'Enter the 6-digit code from your authenticator app.');
export const BAD_CODE = 'That code did not work. Check the clock on your phone and use the newest code.';
