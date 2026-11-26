import type { Env } from './db';
import { credentials, providerCode, tokenFailure } from './auth-diagnostics';
import { googleFetch, isRedirectStatus, networkFailure } from './google-fetch';
import { defaultSettings } from '../src/account-model';
import { cookie, getCookie, hash, isToken, now, OAUTH_COOKIE, OAUTH_SECONDS, randomToken, redirect, SESSION_COOKIE, SESSION_SECONDS } from './security';

type Session = { id: string; email: string; expiresAt: number; tokenHash: string };
type GoogleIdentity = { sub: string; email: string; name?: string; email_verified: boolean };
const clearOAuth = () => cookie(OAUTH_COOKIE, '', 0);
type Stage = 'start' | 'callback' | 'state' | 'token' | 'userinfo' | 'account' | 'session';
function fail(reason: string, stage: Stage, status?: number) {
  // Only controlled reason values and numeric status. No exception text or PII.
  console.warn(JSON.stringify({event:'oauth_failed',stage,reason,...(status === undefined ? {} : {status})}));
  const params = new URLSearchParams({auth:reason});
  if (Number.isInteger(status) && status! >= 100 && status! <= 599) params.set('http', String(status));
  return redirect('/?' + params.toString(), [clearOAuth()]);
}
function config(env: Env) {
  if (!env.DB || !env.APP_ORIGIN || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
  return credentials(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
}
export async function session(request: Request, env: Env): Promise<Session | null> {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await hash(token);
  const row = await env.DB.prepare('SELECT u.id, u.email, s.expires_at AS expiresAt FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').bind(tokenHash, now()).first<Omit<Session, 'tokenHash'>>();
  return row ? { ...row, tokenHash } : null;
}
export async function startLogin(env: Env): Promise<Response> {
  const cfg = config(env);
  if (!cfg) return fail(env.DB && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? 'oauth_config_invalid' : 'not_configured', 'start');
  try {
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
    client_id: cfg.clientId,
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
  } catch { return fail('oauth_start_failed', 'start'); }
}
function identity(value: unknown): GoogleIdentity {
  if (!value || typeof value !== 'object') throw new Error('Invalid provider response.');
  const v = value as Record<string, unknown>;
  if (typeof v.sub !== 'string' || !v.sub || v.sub.length > 255 || typeof v.email !== 'string' || !v.email || v.email.length > 320 || v.email_verified !== true) throw new Error('Unverified provider identity.');
  return { sub: v.sub, email: v.email, email_verified: true, name: typeof v.name === 'string' ? v.name : undefined };
}
export async function finishLogin(request: Request, env: Env): Promise<Response> {
  const cfg = config(env);
  if (!cfg) return fail(env.DB && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? 'oauth_config_invalid' : 'not_configured', 'callback');
  let stage: Stage = 'callback';
  try {
  const url = new URL(request.url);
  const state = url.searchParams.get('state'), browser = getCookie(request, OAUTH_COOKIE);
  if (!isToken(state) || !browser || url.searchParams.getAll('state').length !== 1) return fail('invalid_state', 'state');
  stage = 'state';
  // Consume the attempt atomically, before any provider network calls. No replay.
  const attempt = await env.DB.prepare('DELETE FROM oauth_attempts WHERE state_hash=? AND browser_hash=? AND expires_at>? RETURNING verifier').bind(await hash(state), await hash(browser), now()).first<{ verifier: string }>();
  if (!attempt) return fail('invalid_state', 'state');
  if (url.searchParams.has('error')) {
    const reason = providerCode(url.searchParams.get('error'));
    return fail(reason === 'access_denied' ? 'cancelled' : reason === 'unknown' ? 'google_authorization_failed' : 'google_' + reason, 'callback');
  }
  const code = url.searchParams.get('code');
  if (!code || code.length > 4096 || url.searchParams.getAll('code').length !== 1) return fail('oauth_code_missing', 'callback');
  stage = 'token';
  let tokenResponse: Response;
  try {
    tokenResponse = await googleFetch('token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code, code_verifier: attempt.verifier, grant_type: 'authorization_code', redirect_uri: env.APP_ORIGIN + '/api/auth/callback' }).toString(),
    });
  } catch (error) { return fail('google_token_' + networkFailure(error), 'token'); }
  if (isRedirectStatus(tokenResponse.status)) return fail('google_token_redirect', 'token', tokenResponse.status);
  if (!tokenResponse.ok) {
    let reason = 'google_token_failed';
    try { const error = await tokenResponse.json() as {error?:unknown}; reason = tokenFailure(error?.error); } catch { /* response may not be JSON */ }
    return fail(reason, 'token', tokenResponse.status);
  }
  let tokens: { access_token?: unknown; token_type?: unknown };
  try { tokens = await tokenResponse.json() as typeof tokens; } catch { return fail('google_token_invalid', 'token', tokenResponse.status); }
  if (!tokens || typeof tokens.access_token !== 'string' || !tokens.access_token || tokens.access_token.length > 8192 || String(tokens.token_type).toLowerCase() !== 'bearer') return fail('google_token_invalid', 'token');
  stage = 'userinfo';
  // Obtain verified OIDC identity directly from Google's HTTPS UserInfo endpoint.
  // Do not trust a client-supplied or merely decoded ID token; no Google tokens are persisted.
  let userResponse: Response;
  try {
    userResponse = await googleFetch('userinfo', { headers: { Authorization: 'Bearer ' + tokens.access_token, Accept: 'application/json' } });
  } catch (error) { return fail('google_userinfo_' + networkFailure(error), 'userinfo'); }
  if (isRedirectStatus(userResponse.status)) return fail('google_userinfo_redirect', 'userinfo', userResponse.status);
  if (!userResponse.ok) return fail('google_userinfo_failed', 'userinfo', userResponse.status);
  let google: GoogleIdentity;
  try { google = identity(await userResponse.json()); } catch { return fail('google_identity_invalid', 'userinfo'); }
  stage = 'account';
  const timestamp = now();
  const user = await env.DB.prepare('INSERT INTO users(id,google_sub,email,created_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(google_sub) DO UPDATE SET email=excluded.email, updated_at=excluded.updated_at RETURNING id').bind(crypto.randomUUID(), google.sub, google.email, timestamp, timestamp).first<{ id: string }>();
  if (!user) throw new Error('User creation failed.');
  stage = 'session';
  const token = randomToken(), previous = getCookie(request, SESSION_COOKIE);
  const statements = [
    env.DB.prepare('INSERT INTO user_settings(user_id,payload,revision,updated_at) VALUES (?,?,0,?) ON CONFLICT(user_id) DO NOTHING').bind(user.id, JSON.stringify(defaultSettings(google.name || 'Người dùng')), timestamp),
    env.DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)').bind(await hash(token), user.id, timestamp + SESSION_SECONDS, timestamp),
  ];
  if (previous) statements.push(env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hash(previous)));
  await env.DB.batch(statements);
  return redirect('/', [clearOAuth(), cookie(SESSION_COOKIE, token, SESSION_SECONDS)]);
  } catch {
    const reason = stage === 'state' ? 'oauth_state_storage_failed' :
      stage === 'token' ? 'google_token_failed' :
      stage === 'userinfo' ? 'google_userinfo_failed' :
      stage === 'account' ? 'account_storage_failed' :
      stage === 'session' ? 'session_storage_failed' : 'login_failed';
    return fail(reason, stage);
  }
}
