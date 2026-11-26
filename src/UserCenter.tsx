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
  onSave: (user: LocalUser) => void;
  onReset: () => void;
  onApply: (config: Config) => void;
  onDownload: (template: SavedTemplate) => void;
  onDismiss: () => void;
};
const formatDate = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' });

export default function UserCenter({ state, config, onSave, onReset, onApply, onDownload, onDismiss }: Props) {
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

  function act(operation: () => void, message: string) {
    setError(''); setFeedback('');
    try { operation(); setFeedback(message); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  function saveProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    act(() => {
      const profile = validateProfile(draft);
      onSave({ ...data, profile });
      setDraft(profile);
    }, 'Đã cập nhật hồ sơ.');
  }
  function saveTemplate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!config) return;
    act(() => onSave(addTemplate(data, config, templateName, crypto.randomUUID(), new Date().toISOString())), 'Đã thêm mẫu vào thư viện.');
  }

  return <dialog className="user-dialog" ref={dialog} aria-labelledby="user-title" onCancel={e => { e.preventDefault(); onDismiss(); }}>
    <div className="user-shell">
      <header className="user-heading">
        <div className="user-heading-copy"><span className="user-kicker">KYSHEET / WORKSPACE</span><h2 id="user-title">Không gian cá nhân</h2><p>Hồ sơ, mẫu báo cáo và quyền riêng tư trên thiết bị này.</p></div>
        <button type="button" className="button icon-button user-close" aria-label="Đóng không gian cá nhân" onClick={onDismiss}>×</button>
      </header>
      <div className="user-body">
        <nav className="user-nav" aria-label="Mục không gian cá nhân">
          <div className="user-summary"><span className="user-avatar large">{initials(data.profile.displayName)}</span><strong>{data.profile.displayName}</strong><small>{data.profile.workspace}</small><span className="local-label">LOCAL PROFILE</span></div>
          {([{ id: 'profile', label: 'Hồ sơ & giao diện' }, { id: 'templates', label: 'Mẫu của tôi' }, { id: 'privacy', label: 'Dữ liệu & riêng tư' }] as const).map(item => <button type="button" key={item.id} className={'user-nav-button ' + (tab === item.id ? 'active' : '')} aria-current={tab === item.id ? 'page' : undefined} onClick={() => { setTab(item.id); setError(''); setFeedback(''); setConfirmReset(false); setPendingDelete(null); }}>{item.label}{item.id === 'templates' && <span>{data.templates.length}</span>}</button>)}
        </nav>
        <section className="user-content" aria-label="Nội dung không gian cá nhân">
          {state.warning && <div role="alert" className="notice warning user-notice">{state.warning}</div>}
          {error && <div role="alert" className="notice error user-notice">{error}</div>}
          {feedback && <div role="status" className="notice user-notice">{feedback}</div>}
          {tab === 'profile' && <>
            <h3>Hồ sơ của bạn</h3><p className="user-description">Đây là hồ sơ local, không phải tài khoản đăng nhập. Không cần email hay mật khẩu.</p>
            <form className="user-form" onSubmit={saveProfile}>
              <label className="field"><span>Tên hiển thị</span><input required maxLength={64} value={draft.displayName} onChange={e => setDraft({ ...draft, displayName: e.target.value })}/></label>
              <label className="field"><span>Tên workspace</span><input required maxLength={80} value={draft.workspace} onChange={e => setDraft({ ...draft, workspace: e.target.value })}/></label>
              <label className="field"><span>Mật độ bảng dữ liệu</span><select value={draft.density} onChange={e => setDraft({ ...draft, density: e.target.value as LocalUser['profile']['density'] })}><option value="comfortable">Thoải mái</option><option value="compact">Gọn gàng</option></select></label>
              <div className="user-form-actions"><button type="submit" className="button primary">Lưu hồ sơ</button></div>
            </form>
          </>}
          {tab === 'templates' && <>
            <h3>Mẫu báo cáo của tôi</h3><p className="user-description">{data.templates.length}/{MAX_TEMPLATES} mẫu trên trình duyệt này. Lưu cấu hình và bộ lọc, không lưu workbook hoặc kết quả báo cáo.</p>
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
                {pendingDelete === item.id ? <div className="user-template-actions"><span className="user-hint">Xóa mẫu này?</span><button type="button" className="button danger-button" onClick={() => { act(() => onSave({ ...data, templates: data.templates.filter(t => t.id !== item.id) }), 'Đã xóa mẫu.'); setPendingDelete(null); }}>Xóa</button><button type="button" className="button" onClick={() => setPendingDelete(null)}>Hủy</button></div> :
                <div className="user-template-actions"><button type="button" className="button" disabled={!config} onClick={() => act(() => onApply(item.config), 'Đã áp dụng mẫu.')}>Áp dụng</button><button type="button" className="button" onClick={() => act(() => onDownload(item), 'Đã yêu cầu tải JSON.')}>JSON</button><button type="button" className="button" aria-label={'Xóa mẫu ' + item.name} onClick={() => setPendingDelete(item.id)}>Xóa</button></div>}
              </article>)}
            </div>
          </>}
          {tab === 'privacy' && <>
            <h3>Dữ liệu & quyền riêng tư</h3><p className="user-description">Bạn kiểm soát dữ liệu trên thiết bị của mình.</p>
            <div className="user-facts"><div><strong>Workbook và kết quả</strong><span>Chỉ tồn tại trong bộ nhớ phiên làm việc.</span></div><div><strong>Hồ sơ và mẫu đã lưu</strong><span>LocalStorage của trang này. Không đồng bộ giữa thiết bị.</span></div><div><strong>Đăng nhập và phân quyền</strong><span>Chưa có. Hồ sơ local không bảo vệ dữ liệu khỏi người dùng chung trình duyệt.</span></div></div>
            <div className="user-danger"><strong>Đặt lại không gian cá nhân</strong><p>Xóa tên hiển thị, thiết lập và toàn bộ mẫu lưu local. Không xóa file Excel gốc hoặc file đã tải về; báo cáo đang mở không bị xóa.</p>
              {confirmReset ? <div className="user-form-actions"><button type="button" className="button danger-button" onClick={() => { onReset(); setDraft({ displayName: 'Khách', workspace: 'Workspace cá nhân', density: 'comfortable' }); setConfirmReset(false); setFeedback('Đã yêu cầu đặt lại hồ sơ.'); }}>Xác nhận xóa</button><button type="button" className="button" onClick={() => setConfirmReset(false)}>Hủy</button></div> :
              <button type="button" className="button danger-button" onClick={() => { setConfirmReset(true); setFeedback(''); }}>Xóa hồ sơ và mẫu local</button>}
            </div>
          </>}
        </section>
      </div>
      <footer className="user-footer"><span>Không cần tài khoản · Không gửi dữ liệu báo cáo lên máy chủ</span><button type="button" className="button" onClick={onDismiss}>Đóng</button></footer>
    </div>
  </dialog>;
}
