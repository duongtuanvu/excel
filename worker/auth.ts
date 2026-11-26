import type { Env } from './db';
import { defaultSettings } from '../src/account-model';
import { cookie, getCookie, hash, isToken, now, OAUTH_COOKIE, OAUTH_SECONDS, randomToken, redirect, SESSION_COOKIE, SESSION_SECONDS } from './security';

type Session = { id: string; email: string; expiresAt: number; tokenHash: string };
type GoogleIdentity = { sub: string; email: string; name?: string; email_verified: boolean };
const clearOAuth = () => cookie(OAUTH_COOKIE, '', 0);
const fail = (reason = 'login_failed') => redirect('/?auth=' + reason, [clearOAuth()]);
export async function session(request: Request, env: Env): Promise<Session | null> {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await hash(token);
  const row = await env.DB.prepare('SELECT u.id, u.email, s.expires_at AS expiresAt FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').bind(tokenHash, now()).first<Omit<Session, 'tokenHash'>>();
  return row ? { ...row, tokenHash } : null;
}
function configured(env: Env): boolean {
  return Boolean(env.DB && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.APP_ORIGIN);
}
export async function startLogin(env: Env): Promise<Response> {
  if (!configured(env)) return fail('not_configured');
  const state = randomToken(), browser = randomToken(), verifier = randomToken();
  const timestamp = now();
  // Bounded expiry cleanup. Production should also configure rate limiting for auth routes.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM oauth_attempts WHERE state_hash IN (SELECT state_hash FROM oauth_attempts WHERE expires_at<=? LIMIT 100)').bind(timestamp),
    env.DB.prepare('DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions WHERE expires_at<=? LIMIT 100)').bind(timestamp),
    env.DB.prepare('INSERT INTO oauth_attempts (state_hash,browser_hash,verifier,expires_at) VALUES (?,?,?,?)').bind(await hash(state), await hash(browser), verifier, timestamp + OAUTH_SECONDS)
  ]);
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.APP_ORIGIN + '/api/auth/callback',
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: await hash(verifier),
    code_challenge_method: 'S256',
    access_type: 'online',
    prompt: 'select_account',
  }).toString();
  return redirect(url.href, [cookie(OAUTH_COOKIE, browser, OAUTH_SECONDS)]);
}
function identity(value: unknown): GoogleIdentity {
  if (!value || typeof value !== 'object') throw new Error('Invalid provider response.');
  const v = value as Record<string, unknown>;
  if (typeof v.sub !== 'string' || !v.sub || v.sub.length > 255 || typeof v.email !== 'string' || !v.email || v.email.length > 320 || v.email_verified !== true) throw new Error('Unverified provider identity.');
  return { sub: v.sub, email: v.email, email_verified: true, name: typeof v.name === 'string' ? v.name : undefined };
}
export async function finishLogin(request: Request, env: Env): Promise<Response> {
  if (!configured(env)) return fail('not_configured');
  const url = new URL(request.url);
  const state = url.searchParams.get('state'), browser = getCookie(request, OAUTH_COOKIE);
  if (!isToken(state) || !browser || url.searchParams.getAll('state').length !== 1) return fail('invalid_state');
  // Consume the attempt atomically, before any provider network calls. No replay.
  const attempt = await env.DB.prepare('DELETE FROM oauth_attempts WHERE state_hash=? AND browser_hash=? AND expires_at>? RETURNING verifier').bind(await hash(state), await hash(browser), now()).first<{ verifier: string }>();
  if (!attempt) return fail('invalid_state');
  if (url.searchParams.has('error')) return fail('cancelled');
  const code = url.searchParams.get('code');
  if (!code || code.length > 4096 || url.searchParams.getAll('code').length !== 1) return fail();
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, code, code_verifier: attempt.verifier, grant_type: 'authorization_code', redirect_uri: env.APP_ORIGIN + '/api/auth/callback' }),
  });
  if (!tokenResponse.ok) return fail();
  const tokens = await tokenResponse.json() as { access_token?: unknown; token_type?: unknown };
  if (typeof tokens.access_token !== 'string' || !tokens.access_token || tokens.access_token.length > 8192 || String(tokens.token_type).toLowerCase() !== 'bearer') return fail();
  // Obtain verified OIDC identity directly from Google's HTTPS UserInfo endpoint.
  // Do not trust a client-supplied or merely decoded ID token; no Google tokens are persisted.
  const userResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    redirect: 'error', signal: AbortSignal.timeout(15_000),
    headers: { Authorization: 'Bearer ' + tokens.access_token },
  });
  if (!userResponse.ok) return fail();
  const google = identity(await userResponse.json());
  const timestamp = now();
  const user = await env.DB.prepare('INSERT INTO users(id,google_sub,email,created_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(google_sub) DO UPDATE SET email=excluded.email, updated_at=excluded.updated_at RETURNING id').bind(crypto.randomUUID(), google.sub, google.email, timestamp, timestamp).first<{ id: string }>();
  if (!user) throw new Error('User creation failed.');
  const token = randomToken(), previous = getCookie(request, SESSION_COOKIE);
  const statements = [
    env.DB.prepare('INSERT INTO user_settings(user_id,payload,revision,updated_at) VALUES (?,?,0,?) ON CONFLICT(user_id) DO NOTHING').bind(user.id, JSON.stringify(defaultSettings(google.name || 'Người dùng')), timestamp),
    env.DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)').bind(await hash(token), user.id, timestamp + SESSION_SECONDS, timestamp),
  ];
  if (previous) statements.push(env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hash(previous)));
  await env.DB.batch(statements);
  return redirect('/', [clearOAuth(), cookie(SESSION_COOKIE, token, SESSION_SECONDS)]);
}
