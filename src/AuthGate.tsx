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
  not_configured: 'Quản trị viên chưa hoàn tất cấu hình Google Login.',
};
function initialMessage() {
  const key = new URLSearchParams(location.search).get('auth');
  return key && Object.hasOwn(authMessages, key) ? authMessages[key] : '';
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
    </div><footer>KySheet · Private report workspace</footer></section>
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
      if (mounted.current && generation.current===version) publish(data);
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
      if(version===generation.current && e instanceof AccountError && e.status===409) await verify();
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
