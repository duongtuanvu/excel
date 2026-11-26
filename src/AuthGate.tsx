import { useEffect, useRef, useState } from 'react';
import App from './App';
import type { AccountSnapshot, AccountSettings } from './account-model';
import { AccountError, checkSession, endSession, loadSession, putSettings } from './account-api';

type Gate = { type: 'loading' } | { type: 'login'; message: string } | { type: 'error'; message: string } | { type: 'ready'; snapshot: AccountSnapshot };
const message = (error: unknown) => error instanceof Error ? error.message : 'Lỗi kết nối.';
const authMessages: Record<string,string> = {
  cancelled: 'Bạn đã hủy đăng nhập. Có thể thử lại.',
  invalid_state: 'Yêu cầu đăng nhập hết hạn hoặc không hợp lệ. Vui lòng thử lại.',
  login_failed: 'Không thể đăng nhập Google. Vui lòng thử lại.',
  not_configured: 'Google Login hoặc D1 chưa được cấu hình. [not_configured]',
  oauth_config_invalid: 'Client ID hoặc Client Secret sai định dạng. [oauth_config_invalid]',
  oauth_start_failed: 'Không thể khởi tạo đăng nhập. Kiểm tra D1 và bảng oauth_attempts. [oauth_start_failed]',
  oauth_state_storage_failed: 'Không thể xác minh yêu cầu đăng nhập trong D1. [oauth_state_storage_failed]',
  oauth_code_missing: 'Google không trả mã xác thực hợp lệ. Hãy đăng nhập lại. [oauth_code_missing]',
  google_invalid_client: 'Google từ chối OAuth Client. Kiểm tra Client ID và Client Secret cùng một OAuth client. [google_invalid_client]',
  google_deleted_client: 'OAuth client đã bị xóa hoặc vô hiệu hóa. [google_deleted_client]',
  google_invalid_grant: 'Mã xác thực hết hạn, đã sử dụng hoặc thông số OAuth không khớp. Hãy đăng nhập lại. [google_invalid_grant]',
  google_redirect_uri_mismatch: 'Callback không khớp với Authorized redirect URIs trong Google. [google_redirect_uri_mismatch]',
  google_invalid_request: 'Google từ chối định dạng yêu cầu OAuth. [google_invalid_request]',
  google_unauthorized_client: 'OAuth client không được phép dùng luồng đăng nhập này. [google_unauthorized_client]',
  google_access_denied: 'Google từ chối cấp quyền. [google_access_denied]',
  google_admin_policy_enforced: 'Quản trị viên Google Workspace đã hạn chế quyền đăng nhập. [google_admin_policy_enforced]',
  google_org_internal: 'Ứng dụng chỉ cho phép tài khoản thuộc tổ chức Google đã cấu hình. [google_org_internal]',
  google_invalid_scope: 'Phạm vi OAuth không hợp lệ. [google_invalid_scope]',
  google_temporarily_unavailable: 'Dịch vụ Google tạm thời không khả dụng. [google_temporarily_unavailable]',
  google_server_error: 'Google gặp lỗi máy chủ. [google_server_error]',
  google_authorization_failed: 'Google không hoàn tất cấp quyền. [google_authorization_failed]',
  google_token_failed: 'Google từ chối yêu cầu token hoặc phản hồi không hợp lệ. [google_token_failed]',
  google_token_network: 'Worker không kết nối được endpoint token Google. [google_token_network]',
  google_token_timeout: 'Google token endpoint quá thời gian phản hồi. [google_token_timeout]',
  google_token_redirect: 'Google token endpoint trả redirect không mong đợi. [google_token_redirect]',
  google_userinfo_network: 'Worker không kết nối được Google UserInfo. [google_userinfo_network]',
  google_userinfo_timeout: 'Google UserInfo quá thời gian phản hồi. [google_userinfo_timeout]',
  google_userinfo_redirect: 'Google UserInfo trả redirect không mong đợi. [google_userinfo_redirect]',
  google_token_invalid: 'Phản hồi token Google không hợp lệ. [google_token_invalid]',
  google_userinfo_failed: 'Không lấy được thông tin tài khoản từ Google. [google_userinfo_failed]',
  google_identity_invalid: 'Thông tin định danh hoặc email xác minh không hợp lệ. [google_identity_invalid]',
  account_storage_failed: 'Không thể tạo hoặc cập nhật tài khoản trong D1. [account_storage_failed]',
  session_storage_failed: 'Không thể lưu cấu hình mặc định hoặc phiên đăng nhập trong D1. [session_storage_failed]',
};
function initialMessage() {
  const params = new URLSearchParams(location.search);
  const key = params.get('auth'), status = params.get('http');
  if (!key || !Object.hasOwn(authMessages, key)) return '';
  return authMessages[key] + (status && /^[1-5][0-9]{2}$/.test(status) ? ' (HTTP ' + status + ')' : '');
}
function LoginScreen({ gate, retry }: { gate: Exclude<Gate, {type:'ready'}>; retry: () => void }) {
  return <main className="auth-layout">
    <section className="auth-intro">
      <div className="auth-brand"><img src="/favicon.svg" width="44" height="44" alt=""/><span>KySheet<small>REPORT AUTOMATION</small></span></div>
      <div className="auth-copy"><span className="auth-eyebrow">YOUR PRIVATE WORKSPACE</span><h1>Thiết kế một lần.<br/>Báo cáo mọi kỳ.</h1><p>Biến dữ liệu Excel thành báo cáo có thể tái sử dụng. Cấu hình theo tài khoản, dữ liệu phân tích ngay trên thiết bị.</p></div>
      <div className="auth-facts"><div><span>01</span><strong>Excel local-first</strong><small>Workbook không gửi lên máy chủ.</small></div><div><span>02</span><strong>Không gian riêng</strong><small>Hồ sơ và cấu hình của từng tài khoản.</small></div><div><span>03</span><strong>Dùng lại mọi kỳ</strong><small>Đăng nhập để khôi phục mẫu đã lưu.</small></div></div>
    </section>
    <section className="auth-main"><div className="auth-card">
      <span className="auth-pill">KYSHEET / ACCOUNT</span><h2>{gate.type==='loading'?'Đang kiểm tra phiên':'Chào mừng đến KySheet'}</h2>
      <p>{gate.type==='loading'?'Đang kết nối không gian cá nhân…':'Đăng nhập để bắt đầu làm việc và đồng bộ cấu hình báo cáo của bạn.'}</p>
      {gate.type==='loading'?<div role="status" className="auth-loading"><span className="spinner"/> Đang tải tài khoản</div>:<>
        {gate.message && <div className="notice error" role="alert">{gate.message}</div>}
        {gate.type==='error'?<button className="button primary auth-google" onClick={retry}>Thử kết nối lại</button>:<form method="POST" action="/api/auth/login"><button className="button auth-google" type="submit"><svg aria-hidden="true" width="20" height="20" viewBox="0 0 48 48"><path fill="#4285f4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.7c3.9-3.6 6-8.8 6-15z"/><path fill="#34a853" d="M24 44c5.5 0 10.1-1.8 13.5-4.9l-6.7-5.1c-1.8 1.2-4.1 1.9-6.8 1.9-5.3 0-9.8-3.6-11.4-8.4H5.7v5.2A20 20 0 0 0 24 44z"/><path fill="#fbbc05" d="M12.6 27.5a12 12 0 0 1 0-7.6v-5.2H5.7a20 20 0 0 0 0 18z"/><path fill="#ea4335" d="M24 12.1c3 0 5.7 1 7.8 3l5.8-5.7A19.2 19.2 0 0 0 24 4 20 20 0 0 0 5.7 14.7l6.9 5.2c1.6-4.8 6.1-7.8 11.4-7.8z"/></svg>Tiếp tục với Google</button></form>}
      </>}
      <p className="auth-privacy">KySheet lưu email, hồ sơ, mẫu và cấu hình đã lưu trong tài khoản. Tên cột và giá trị bộ lọc có thể chứa thông tin nhạy cảm. Không lưu mật khẩu Google hoặc workbook trên server.</p>
    </div><footer>KySheet · Private report workspace<nav className="public-links" aria-label="Thông tin KySheet"><a href="/about/" target="_blank" rel="noopener noreferrer">Giới thiệu</a><a href="/privacy/" target="_blank" rel="noopener noreferrer">Quyền riêng tư</a><a href="/terms/" target="_blank" rel="noopener noreferrer">Điều khoản</a></nav></footer></section>
  </main>;
}

export default function AuthGate() {
  const [gate,setGate] = useState<Gate>({type:'loading'});
  const [saving,setSaving] = useState(false);
  const current = useRef<AccountSnapshot|null>(null);
  const generation = useRef(0);
  const writing = useRef(false);
  const channel = useRef<BroadcastChannel|null>(null);
  const mounted = useRef(true);
  const checking = useRef(false);
  function publish(snapshot: AccountSnapshot) {
    current.current=snapshot;
    setGate({type:'ready',snapshot});
  }
  function clear(text: string) {
    generation.current++;
    current.current=null;
    setGate({type:'login',message:text});
  }
  async function boot() {
    const version=++generation.current;
    current.current=null;
    setGate({type:'loading'});
    try {
      const data=await loadSession();
      if (mounted.current && generation.current===version) { publish(data); announce(); }
    } catch (e) {
      if (!mounted.current || generation.current!==version) return;
      if (e instanceof AccountError && e.status===401) setGate({type:'login',message:initialMessage()});
      else setGate({type:'error',message:message(e)});
    }
  }
  async function verify() {
    const before=current.current;
    if (!before || checking.current) return;
    checking.current=true;
    const version=generation.current;
    try {
      const status=await checkSession();
      if (version!==generation.current || !current.current) return;
      if (status.account.id!==before.account.id) clear('Tài khoản đã thay đổi ở tab khác. Hãy tải lại trang.');
    } catch(e) {
      if (version===generation.current && e instanceof AccountError && (e.status===401||e.status===403)) clear('Phiên đăng nhập đã hết hạn.');
    } finally { checking.current=false; }
  }
  useEffect(()=>{
    mounted.current=true;
    void boot();
    const onFocus=()=>{ if (document.visibilityState==='visible') void verify(); };
    const onStorage=(event:StorageEvent)=>{ if(event.key==='kysheet.session.event') void verify(); };
    window.addEventListener('focus',onFocus);
    document.addEventListener('visibilitychange',onFocus);
    window.addEventListener('storage',onStorage);
    const interval=window.setInterval(()=>{
      const active=current.current;
      if(active && active.expiresAt*1000<=Date.now()) clear('Phiên đăng nhập đã hết hạn.');
      else if(document.visibilityState==='visible') void verify();
    },60_000);
    try { channel.current=new BroadcastChannel('kysheet-session'); channel.current.onmessage=()=>void verify(); } catch { /* optional */ }
    return ()=>{
      mounted.current=false; generation.current++; current.current=null;
      window.clearInterval(interval);
      window.removeEventListener('focus',onFocus);
      document.removeEventListener('visibilitychange',onFocus);
      window.removeEventListener('storage',onStorage);
      channel.current?.close(); channel.current=null;
    };
  },[]);
  function announce() {
    try { channel.current?.postMessage('changed'); } catch { /* optional */ }
    // Only a change marker, never a user ID, settings or credentials.
    try { localStorage.setItem('kysheet.session.event',String(Date.now())); } catch { /* optional */ }
  }
  async function runWrite(operation: (before:AccountSnapshot, version:number)=>Promise<void>) {
    const before=current.current;
    if(!before) throw new Error('Bạn chưa đăng nhập.');
    if(writing.current) throw new Error('Một thao tác tài khoản đang được thực hiện.');
    writing.current=true; setSaving(true);
    const version=generation.current;
    try { await operation(before,version); }
    catch(e) {
      if(version===generation.current && e instanceof AccountError && (e.status===401||e.status===403)) clear('Phiên đăng nhập đã hết hạn.');
      if(version===generation.current && e instanceof AccountError && e.code==='AUTH_ACCOUNT_CHANGED') clear('Tài khoản đã thay đổi ở tab khác. Hãy đăng nhập lại.');
      else if(version===generation.current && e instanceof AccountError && e.status===409) await verify();
      throw e;
    } finally { writing.current=false; if(mounted.current) setSaving(false); }
  }
  async function save(settings:AccountSettings) {
    await runWrite(async(before,version)=>{
      const revision=await putSettings(before,settings);
      if(version!==generation.current || current.current?.account.id!==before.account.id) throw new Error('Phiên đã thay đổi.');
      publish({...before,settings,revision});
    });
  }
  async function refresh() {
    await runWrite(async(before,version)=>{
      const next=await loadSession();
      if(version!==generation.current) throw new Error('Phiên đã thay đổi.');
      if(next.account.id!==before.account.id){clear('Tài khoản đã thay đổi.');throw new Error('Tài khoản đã thay đổi.');}
      publish(next);
    });
  }
  async function logout() {
    await runWrite(async(before,version)=>{
      await endSession(before);
      if(version===generation.current){clear('Bạn đã đăng xuất.');announce();}
    });
  }
  if(gate.type!=='ready') return <LoginScreen gate={gate} retry={()=>void boot()}/>;
  return <App key={gate.snapshot.account.id} session={gate.snapshot} saving={saving} saveSettings={save} refreshSettings={refresh} logout={logout}/>;
}
