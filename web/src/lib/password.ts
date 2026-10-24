// One set of rules for choosing a password, shared by first sign-in and password reset.
export function passwordProblem(password: string, again: string, email?: string | null): string | null {
  if (password.length < 8) return 'Use at least 8 characters.';
  if (password.length > 72) return 'Use 72 characters or fewer.';
  if (password !== again) return 'The two passwords do not match.';
  if (email && password.toLowerCase().includes(email.split('@')[0].toLowerCase())) return 'The password must not contain your email name.';
  return null;
}
