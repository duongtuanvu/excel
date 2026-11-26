import type { Env } from './db.ts';
import { finishLogin, session, startLogin } from './auth.ts';
import { ACCOUNT_MAX_BYTES, parseSettings, validRevision, validateSettings } from '../src/account-model.ts';
import type { AccountSettings } from '../src/account-model.ts';
import { cookie, json, now, readJson, redirect, sameOriginWrite, SESSION_COOKIE, trustedOrigin } from './security.ts';

const unauthorized = () => json({ code: 'AUTH_SESSION_REQUIRED', error: 'Phiên đăng nhập đã hết hạn.' }, 401);
async function api(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url), path = url.pathname, method = request.method;
  if (!trustedOrigin(request, env.APP_ORIGIN)) return json({ code: 'AUTH_ORIGIN', error: 'Origin không hợp lệ.' }, 403);
  if (method !== 'GET' && !sameOriginWrite(request, env.APP_ORIGIN)) return json({ code: 'AUTH_CSRF', error: 'Yêu cầu khác origin bị từ chối.' }, 403);
  if (path === '/api/auth/login' && method === 'POST') return startLogin(env);
  if (path === '/api/auth/callback' && method === 'GET') return finishLogin(request, env);
  const active = await session(request, env);
  if (!active) return unauthorized();
  const account = { id: active.id, email: active.email };
  if (path === '/api/session/check' && method === 'GET') return json({ account, expiresAt: active.expiresAt });
  if (path === '/api/session' && method === 'GET') {
    const row = await env.DB.prepare('SELECT payload,revision FROM user_settings WHERE user_id=?').bind(active.id).first<{ payload: string; revision: number }>();
    if (!row || !validRevision(row.revision)) throw new Error('Settings unavailable.');
    return json({ account, settings: parseSettings(row.payload), revision: row.revision, expiresAt: active.expiresAt });
  }
  // A stale tab must never save its state into another account after a cookie switch.
  if (method !== 'GET' && request.headers.get('X-KySheet-User') !== active.id) return json({ code: 'AUTH_ACCOUNT_CHANGED', error: 'Tài khoản đã thay đổi. Hãy đăng nhập lại.' }, 409);
  if (path === '/api/auth/logout' && method === 'POST') {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash=? AND user_id=?').bind(active.tokenHash, active.id).run();
    return json({ ok: true }, 200, [cookie(SESSION_COOKIE, '', 0)]);
  }
  if (path === '/api/settings' && method === 'PUT') {
    let settings: AccountSettings, revision: number, legacyWrite: boolean;
    try {
      const input = await readJson(request, ACCOUNT_MAX_BYTES + 1024) as Record<string, unknown>;
      if (!input || !validRevision(input.revision)) throw new Error('Revision không hợp lệ.');
      revision = input.revision;
      settings = validateSettings(input.settings);
      legacyWrite = !Object.hasOwn(input.settings as object, 'workspace');
    } catch { return json({ code: 'SETTINGS_INVALID', error: 'Cấu hình hoặc dung lượng dữ liệu không hợp lệ.' }, 400); }
    // Old clients strip schema rules on serialization. Reject their writes once rules exist.
    // Read by revision, then retain the existing CAS and session predicate for the update.
    if (request.headers.get('X-KySheet-Schema') !== '1') {
      const current = await env.DB.prepare('SELECT payload FROM user_settings WHERE user_id=? AND revision=?').bind(active.id,revision).first<{payload:string}>();
      if (current && parseSettings(current.payload).workspace?.slots.some(slot=>slot.schema?.length)) {
        return json({code:'SETTINGS_CLIENT_UPGRADE',error:'Ứng dụng đã được nâng cấp. Hãy tải lại trang trước khi lưu cấu hình.'},409);
      }
    }
    // Older clients do not know workspace. Keep the stored workspace on legacy writes.
    if (legacyWrite) {
      const current = await env.DB.prepare('SELECT payload FROM user_settings WHERE user_id=? AND revision=?').bind(active.id, revision).first<{payload:string}>();
      if (!current) return json({code:'SETTINGS_CONFLICT',error:'Cấu hình đã thay đổi. Hãy tải lại từ tài khoản.'},409);
      try { settings = validateSettings({...settings,workspace:parseSettings(current.payload).workspace}); }
      catch { return json({code:'SETTINGS_INVALID',error:'Cấu hình vượt giới hạn. Hãy tải lại ứng dụng.'},400); }
    }
    const payload = JSON.stringify(settings);
    // Compare-and-swap: reject concurrent saves. Recheck session within the write statement.
    const result = await env.DB.prepare('UPDATE user_settings SET payload=?,revision=revision+1,updated_at=? WHERE user_id=? AND revision=? AND EXISTS (SELECT 1 FROM sessions WHERE token_hash=? AND user_id=? AND expires_at>?) RETURNING revision').bind(payload, now(), active.id, revision, active.tokenHash, active.id, now()).first<{ revision: number }>();
    if (!result) {
      if (!await session(request, env)) return unauthorized();
      return json({ code: 'SETTINGS_CONFLICT', error: 'Cấu hình đã thay đổi ở thiết bị hoặc tab khác. Hãy tải lại từ tài khoản trước khi lưu.' }, 409);
    }
    return json({ revision: result.revision });
  }
  return json({ error: 'Không tìm thấy API.' }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      return await api(request, env);
    } catch {
      // Never log OAuth codes, cookies, workbook contents or user settings.
      if (url.pathname === '/api/auth/callback' || url.pathname === '/api/auth/login') {
        console.warn(JSON.stringify({event:'oauth_failed',stage:'route',reason:'login_failed'}));
        return redirect('/?auth=login_failed');
      }
      return json({ error: 'Dịch vụ tài khoản tạm thời không khả dụng.' }, 503);
    }
  },
};
