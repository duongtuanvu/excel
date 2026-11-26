// Fixed, non-sensitive error codes only. Never log provider response bodies,
// OAuth code/state/verifier, credentials, user identifiers, or session tokens.
export const GOOGLE_ERRORS = ['invalid_client','invalid_grant','redirect_uri_mismatch','invalid_request','unauthorized_client','access_denied','admin_policy_enforced','org_internal','deleted_client','invalid_scope','temporarily_unavailable','server_error'] as const;
export type GoogleError = typeof GOOGLE_ERRORS[number];
const allowed = new Set<string>(GOOGLE_ERRORS);
export function providerCode(value: unknown): GoogleError | 'unknown' {
  return typeof value === 'string' && allowed.has(value) ? value as GoogleError : 'unknown';
}
export function tokenFailure(value: unknown): string {
  const code = providerCode(value);
  return code === 'unknown' ? 'google_token_failed' : 'google_' + code;
}
export function credentials(clientId: unknown, clientSecret: unknown): { clientId: string; clientSecret: string } | null {
  if (typeof clientId !== 'string' || typeof clientSecret !== 'string') return null;
  const id = clientId.trim(), secret = clientSecret.trim();
  if (!/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(id) || id.length > 512 || !secret || secret.length > 512 || /[\s"'\u0000-\u001f\u007f]/.test(secret)) return null;
  return {clientId:id,clientSecret:secret};
}
