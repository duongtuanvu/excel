export const SESSION_COOKIE = '__Host-kysheet_session';
export const OAUTH_COOKIE = '__Host-kysheet_oauth';
export const SESSION_SECONDS = 7 * 24 * 60 * 60;
export const OAUTH_SECONDS = 10 * 60;
export const now = () => Math.floor(Date.now() / 1000);
export const isToken = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v);

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
export function randomToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}
export async function hash(value: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}
export function cookie(name: string, value: string, seconds: number): string {
  return name + '=' + value + '; Path=/; Max-Age=' + seconds + '; HttpOnly; Secure; SameSite=Lax';
}
export function getCookie(request: Request, name: string): string | null {
  const matches = (request.headers.get('Cookie') || '').split(';').map(v => v.trim()).filter(v => v.startsWith(name + '='));
  if (matches.length !== 1) return null;
  const value = matches[0].slice(name.length + 1);
  return isToken(value) ? value : null;
}
export function trustedOrigin(request: Request, origin: string): boolean {
  try {
    const configured = new URL(origin);
    return configured.protocol === 'https:' && configured.origin === origin && new URL(request.url).origin === origin;
  } catch { return false; }
}
export function sameOriginWrite(request: Request, origin: string): boolean {
  return trustedOrigin(request, origin) && request.headers.get('Origin') === origin;
}
export function secureHeaders(): Headers {
  return new Headers({
    'Cache-Control': 'no-store, private',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
  });
}
export function json(body: unknown, status = 200, cookies: string[] = []): Response {
  const headers = secureHeaders();
  headers.set('Content-Type', 'application/json; charset=utf-8');
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(JSON.stringify(body), { status, headers });
}
export function redirect(location: string, cookies: string[] = []): Response {
  const headers = secureHeaders();
  headers.set('Location', location);
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(null, { status: 303, headers });
}
export async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) throw new Error('JSON required.');
  const declared = request.headers.get('Content-Length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) throw new Error('Payload too large.');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Body required.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) { await reader.cancel(); throw new Error('Payload too large.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
