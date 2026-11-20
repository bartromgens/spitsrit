/**
 * Credentials of the smoke test account, from the SMOKE_USER environment variable
 * as "username:password". In production this comes from the secret named by
 * smoke_user in .gantry.yml; the e2e Compose stack creates a matching account.
 */
export function smokeUser(): { username: string; password: string } {
  const value = process.env['SMOKE_USER'] ?? 'smoke:smoke-password';
  const separator = value.indexOf(':');
  return { username: value.slice(0, separator), password: value.slice(separator + 1) };
}
