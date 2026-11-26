import type { AccountSnapshot, AccountSettings } from './account-model';
import { validateSettings, validRevision } from './account-model';

export class AccountError extends Error {
  constructor(message: string, readonly status: number, readonly code = 'ACCOUNT_REQUEST_FAILED') { super(message); this.name = 'AccountError'; }
}
async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, { ...init, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20_000) });
  let body: unknown;
  try { body = await response.json(); }
  catch { throw new AccountError('API tài khoản chưa được cấu hình hoặc phản hồi không hợp lệ.', response.status || 503); }
  if (!response.ok) {
    const error = body && typeof body === 'object' && 'error' in body ? String(body.error) : 'Không thể kết nối tài khoản.';
    const code = body && typeof body === 'object' && 'code' in body && typeof body.code === 'string' ? body.code : 'ACCOUNT_REQUEST_FAILED';
    throw new AccountError(error, response.status, code);
  }
  return body;
}
function identity(value: unknown) {
  if (!value || typeof value !== 'object') throw new Error('Phiên không hợp lệ.');
  const row = value as Record<string, unknown>;
  const account = row.account as Record<string, unknown> | undefined;
  if (!account || typeof account.id !== 'string' || !account.id || typeof account.email !== 'string' || typeof row.expiresAt !== 'number' || !Number.isFinite(row.expiresAt)) throw new Error('Phiên không hợp lệ.');
  return { account: { id: account.id, email: account.email }, expiresAt: row.expiresAt };
}
export async function loadSession(): Promise<AccountSnapshot> {
  const raw = await request('/api/session') as Record<string, unknown>;
  const info = identity(raw);
  if (!validRevision(raw.revision)) throw new Error('Phiên bản cấu hình không hợp lệ.');
  return { ...info, revision: raw.revision, settings: validateSettings(raw.settings) };
}
export async function checkSession() {
  return identity(await request('/api/session/check'));
}
export async function putSettings(session: AccountSnapshot, settings: AccountSettings): Promise<number> {
  const body = await request('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-KySheet-User': session.account.id, 'X-KySheet-Schema': '1', 'X-KySheet-Layout': '1', 'X-KySheet-Pipeline': '1' }, body: JSON.stringify({ revision: session.revision, settings: validateSettings(settings) }) }) as Record<string, unknown>;
  if (!validRevision(body.revision) || body.revision !== session.revision + 1) throw new Error('Phiên bản phản hồi không hợp lệ.');
  return body.revision;
}
export async function endSession(session: AccountSnapshot): Promise<void> {
  await request('/api/auth/logout', { method: 'POST', headers: { 'X-KySheet-User': session.account.id } });
}
