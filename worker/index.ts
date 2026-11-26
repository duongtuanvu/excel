import type { Env } from './db';
import { finishLogin, session, startLogin } from './auth';
import { ACCOUNT_MAX_BYTES, parseSettings, validRevision, validateSettings } from '../src/account-model';
import { cookie, json, now, readJson, redirect, sameOriginWrite, SESSION_COOKIE, trustedOrigin } from './security';

const unauthorized = () => json({ error: 'Phiên đăng nhập đã hết hạn.' }, 401);
async function api(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url), path = url.pathname, method = request.method;
  if (!trustedOrigin(request, env.APP_ORIGIN)) return json({ error: 'Origin không hợp lệ.' }, 403);
  if (method !== 'GET' && !sameOriginWrite(request, env.APP_ORIGIN)) return json({ error: 'Yêu cầu khác origin bị từ chối.' }, 403);
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
  if (method !== 'GET' && request.headers.get('X-KySheet-User') !== active.id) return json({ error: 'Tài khoản đã thay đổi. Hãy đăng nhập lại.' }, 409);
  if (path === '/api/auth/logout' && method === 'POST') {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash=? AND user_id=?').bind(active.tokenHash, active.id).run();
    return json({ ok: true }, 200, [cookie(SESSION_COOKIE, '', 0)]);
  }
  if (path === '/api/settings' && method === 'PUT') {
    let payload: string, revision: number;
    try {
      const input = await readJson(request, ACCOUNT_MAX_BYTES + 1024) as Record<string, unknown>;
      if (!input || !validRevision(input.revision)) throw new Error('Revision không hợp lệ.');
      revision = input.revision;
      payload = JSON.stringify(validateSettings(input.settings));
    } catch { return json({ error: 'Cấu hình hoặc dung lượng dữ liệu không hợp lệ.' }, 400); }
    // Compare-and-swap: reject concurrent saves. Recheck session within the write statement.
    const result = await env.DB.prepare('UPDATE user_settings SET payload=?,revision=revision+1,updated_at=? WHERE user_id=? AND revision=? AND EXISTS (SELECT 1 FROM sessions WHERE token_hash=? AND user_id=? AND expires_at>?) RETURNING revision').bind(payload, now(), active.id, revision, active.tokenHash, active.id, now()).first<{ revision: number }>();
    if (!result) return json({ error: 'Cấu hình đã thay đổi hoặc phiên đã hết hạn. Hãy tải lại từ tài khoản.' }, 409);
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
      if (url.pathname === '/api/auth/callback' || url.pathname === '/api/auth/login') return redirect('/?auth=login_failed');
      return json({ error: 'Dịch vụ tài khoản tạm thời không khả dụng.' }, 503);
    }
  },
};
