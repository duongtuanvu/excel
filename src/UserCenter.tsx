import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Config } from './model';
import { addTemplate, initials, MAX_TEMPLATES, validateProfile } from './user-model';
import type { LocalUser, SavedTemplate } from './user-model';
import type { UserState } from './user-storage';

type Tab = 'profile' | 'templates' | 'privacy';
type Props = {
  state: UserState;
  config: Config | null;
  onSave: (user: LocalUser) => Promise<void>;
  onReset: () => Promise<void>;
  accountEmail: string;
  saving: boolean;
  onLogout: () => Promise<void>;
  onApply: (config: Config) => void;
  onDownload: (template: SavedTemplate) => void;
  onDismiss: () => void;
};
const formatDate = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' });

export default function UserCenter({ state, config, onSave, onReset, accountEmail, saving, onLogout, onApply, onDownload, onDismiss }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<Tab>('profile');
  const [draft, setDraft] = useState(state.data.profile);
  const [templateName, setTemplateName] = useState((config?.title || 'Mẫu báo cáo mới').slice(0,100));
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const data = state.data;

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    node.showModal();
    return () => { if (node.open) node.close(); };
  }, []);

  const working = useRef(false);
  const [pending, setPending] = useState(false);
  async function act(operation: () => void | Promise<void>, message: string) {
    if (working.current || saving) return;
    working.current = true; setPending(true);
    setError(''); setFeedback('');
    try { await operation(); setFeedback(message); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { working.current = false; setPending(false); }
  }
  function saveProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void act(async () => {
      const profile = validateProfile(draft);
      await onSave({ ...data, profile });
      setDraft(profile);
    }, 'Đã cập nhật hồ sơ.');
  }
  function saveTemplate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!config) return;
    void act(() => onSave(addTemplate(data, config, templateName, crypto.randomUUID(), new Date().toISOString())), 'Đã thêm mẫu vào thư viện.');
  }

  return <dialog className="user-dialog" ref={dialog} aria-labelledby="user-title" onCancel={e => { e.preventDefault(); onDismiss(); }}>
    <div className="user-shell">
      <header className="user-heading">
        <div className="user-heading-copy"><span className="user-kicker">KYSHEET / WORKSPACE</span><h2 id="user-title">Không gian cá nhân</h2><p>Hồ sơ, mẫu báo cáo và quyền riêng tư của tài khoản.</p></div>
        <button type="button" className="button icon-button user-close" aria-label="Đóng không gian cá nhân" onClick={onDismiss}>×</button>
      </header>
      <div className="user-body">
        <nav className="user-nav" aria-label="Mục không gian cá nhân">
          <div className="user-summary"><span className="user-avatar large">{initials(data.profile.displayName)}</span><strong>{data.profile.displayName}</strong><small>{data.profile.workspace}</small><span className="local-label">GOOGLE ACCOUNT</span></div>
          {([{ id: 'profile', label: 'Hồ sơ & giao diện' }, { id: 'templates', label: 'Mẫu của tôi' }, { id: 'privacy', label: 'Dữ liệu & riêng tư' }] as const).map(item => <button type="button" key={item.id} className={'user-nav-button ' + (tab === item.id ? 'active' : '')} aria-current={tab === item.id ? 'page' : undefined} onClick={() => { setTab(item.id); setError(''); setFeedback(''); setConfirmReset(false); setPendingDelete(null); }}>{item.label}{item.id === 'templates' && <span>{data.templates.length}</span>}</button>)}
        </nav>
        <section className="user-content" aria-label="Nội dung không gian cá nhân"><fieldset disabled={saving || pending} className="account-fields">
          {state.warning && <div role="alert" className="notice warning user-notice">{state.warning}</div>}
          {error && <div role="alert" className="notice error user-notice">{error}</div>}
          {feedback && <div role="status" className="notice user-notice">{feedback}</div>}
          {tab === 'profile' && <>
            <h3>Hồ sơ của bạn</h3><p className="user-description">Hồ sơ được lưu riêng theo tài khoản Google đã xác thực.</p>
            <p className="user-description">{accountEmail}</p><form className="user-form" onSubmit={saveProfile}>
              <label className="field"><span>Tên hiển thị</span><input required maxLength={64} value={draft.displayName} onChange={e => setDraft({ ...draft, displayName: e.target.value })}/></label>
              <label className="field"><span>Tên workspace</span><input required maxLength={80} value={draft.workspace} onChange={e => setDraft({ ...draft, workspace: e.target.value })}/></label>
              <label className="field"><span>Mật độ bảng dữ liệu</span><select value={draft.density} onChange={e => setDraft({ ...draft, density: e.target.value as LocalUser['profile']['density'] })}><option value="comfortable">Thoải mái</option><option value="compact">Gọn gàng</option></select></label>
              <div className="user-form-actions"><button type="submit" className="button primary">Lưu hồ sơ</button></div>
            </form>
          </>}
          {tab === 'templates' && <>
            <h3>Mẫu báo cáo của tôi</h3><p className="user-description">{data.templates.length}/{MAX_TEMPLATES} mẫu trong tài khoản này. Lưu cấu hình và bộ lọc, không lưu workbook hoặc kết quả báo cáo.</p>
            <form className="user-template-form" onSubmit={saveTemplate}>
              <label className="field"><span>Tên mẫu mới</span><input required maxLength={100} value={templateName} onChange={e => setTemplateName(e.target.value)} disabled={!config || data.templates.length >= MAX_TEMPLATES}/></label>
              <button type="submit" className="button primary" disabled={!config || data.templates.length >= MAX_TEMPLATES}>Lưu báo cáo hiện tại</button>
            </form>
            {!config && <p className="user-description">Nạp dữ liệu và chờ báo cáo tính xong trước khi lưu mẫu.</p>}
            <p className="user-hint">Giá trị bộ lọc và tên cột có thể nhạy cảm. Chỉ lưu hoặc chia sẻ mẫu khi phù hợp.</p>
            <div className="user-template-list">
              {!data.templates.length && <div className="user-empty"><strong>Chưa có mẫu báo cáo</strong><p>Lưu cấu hình hiện tại để tái sử dụng khi thay file Excel kỳ sau.</p></div>}
              {data.templates.map(item => <article className="user-template" key={item.id}>
                <div className="user-template-title"><strong title={item.name}>{item.name}</strong><small>{formatDate.format(new Date(item.createdAt))} · {item.config.aggregate.toUpperCase()} · {item.config.groups.length} nhóm</small></div>
                {pendingDelete === item.id ? <div className="user-template-actions"><span className="user-hint">Xóa mẫu này?</span><button type="button" className="button danger-button" onClick={() => void act(async () => { await onSave({ ...data, templates: data.templates.filter(t => t.id !== item.id) }); setPendingDelete(null); }, 'Đã xóa mẫu.')}>Xóa</button><button type="button" className="button" onClick={() => setPendingDelete(null)}>Hủy</button></div> :
                <div className="user-template-actions"><button type="button" className="button" disabled={!config} onClick={() => act(() => onApply(item.config), 'Đã áp dụng mẫu.')}>Áp dụng</button><button type="button" className="button" onClick={() => act(() => onDownload(item), 'Đã yêu cầu tải JSON.')}>JSON</button><button type="button" className="button" aria-label={'Xóa mẫu ' + item.name} onClick={() => setPendingDelete(item.id)}>Xóa</button></div>}
              </article>)}
            </div>
          </>}
          {tab === 'privacy' && <>
            <h3>Dữ liệu & quyền riêng tư</h3><p className="user-description">Bạn kiểm soát dữ liệu trên thiết bị của mình.</p>
            <div className="user-facts"><div><strong>Workbook và kết quả</strong><span>Chỉ tồn tại trong bộ nhớ phiên làm việc.</span></div><div><strong>Hồ sơ, mẫu và workspace đã lưu</strong><span>Lưu riêng trên Cloudflare D1 và đồng bộ khi đăng nhập.</span></div><div><strong>Đăng nhập và phân quyền</strong><span>Đăng nhập Google bắt buộc; API xác định quyền sở hữu từ session.</span></div></div>
            <div className="user-danger"><strong>Đặt lại không gian cá nhân</strong><p>Đặt lại thiết lập, mẫu, cấu hình gần nhất và workspace đã lưu của tài khoản. Không xóa file Excel gốc hoặc file đã tải về; báo cáo đang mở không bị xóa.</p>
              {confirmReset ? <div className="user-form-actions"><button type="button" className="button danger-button" onClick={() => void act(async () => { await onReset(); setDraft({ displayName: data.profile.displayName, workspace: 'Workspace cá nhân', density: 'comfortable' }); setConfirmReset(false); }, 'Đã đặt lại hồ sơ và mẫu.')}>Xác nhận xóa</button><button type="button" className="button" onClick={() => setConfirmReset(false)}>Hủy</button></div> :
              <button type="button" className="button danger-button" onClick={() => { setConfirmReset(true); setFeedback(''); }}>Đặt lại hồ sơ và mẫu</button>}
            </div>
          </>}
        </fieldset></section>
      </div>
      <footer className="user-footer"><span>Tài khoản riêng · Workbook không gửi lên máy chủ</span><div className="user-form-actions"><button type="button" className="button danger-button" disabled={saving || pending} onClick={() => void act(onLogout, 'Đã đăng xuất.')}>Đăng xuất</button><button type="button" className="button" onClick={onDismiss}>Đóng</button></div></footer>
    </div>
  </dialog>;
}
