import { defaultUser, parseUser, USER_KEY, validateUser } from './user-model';
import type { LocalUser } from './user-model';

export type UserState = { data: LocalUser; warning: string };
export function readLocalUser(): UserState {
  try { return { data: parseUser(window.localStorage.getItem(USER_KEY)), warning: '' }; }
  catch { return { data: defaultUser(), warning: 'Không đọc được hồ sơ đã lưu. Bạn vẫn có thể làm việc trong phiên hiện tại; hãy kiểm tra bộ nhớ trình duyệt.' }; }
}
export function writeLocalUser(data: LocalUser): UserState {
  const checked = validateUser(data);
  try {
    window.localStorage.setItem(USER_KEY, JSON.stringify(checked));
    return { data: checked, warning: '' };
  } catch {
    return { data: checked, warning: 'Trình duyệt không cho lưu hồ sơ. Thay đổi chỉ tồn tại trong phiên hiện tại; hãy xuất JSON để giữ mẫu.' };
  }
}
export function clearLocalUser(): UserState {
  try { window.localStorage.removeItem(USER_KEY); return { data: defaultUser(), warning: '' }; }
  catch { return { data: defaultUser(), warning: 'Đã đặt lại trong phiên, nhưng không thể xóa dữ liệu đã lưu. Hãy xóa dữ liệu trang trong cài đặt trình duyệt.' }; }
}
