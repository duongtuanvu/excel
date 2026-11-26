import { validateTemplate } from './model.ts';
import type { Config } from './model.ts';

export const USER_KEY = 'kysheet.user.v1';
export const MAX_TEMPLATES = 20;
export const MAX_USER_CHARS = 512_000;
export type Profile = { displayName: string; workspace: string; density: 'comfortable' | 'compact' };
export type SavedTemplate = { id: string; name: string; createdAt: string; config: Config };
export type LocalUser = { version: 1; profile: Profile; templates: SavedTemplate[] };

export function defaultUser(): LocalUser {
  return { version: 1, profile: { displayName: 'Khách', workspace: 'Workspace cá nhân', density: 'comfortable' }, templates: [] };
}
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
function boundedText(value: unknown, max: number, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(field + ' không hợp lệ.');
  return value.trim();
}
export function validateProfile(input: unknown): Profile {
  if (!isRecord(input) || (input.density !== 'comfortable' && input.density !== 'compact')) throw new Error('Hồ sơ không hợp lệ.');
  return { displayName: boundedText(input.displayName, 64, 'Tên hiển thị'), workspace: boundedText(input.workspace, 80, 'Workspace'), density: input.density };
}
export function validateUser(input: unknown): LocalUser {
  if (!isRecord(input) || input.version !== 1 || !Array.isArray(input.templates) || input.templates.length > MAX_TEMPLATES) throw new Error('Dữ liệu người dùng không hợp lệ.');
  const ids = new Set<string>();
  const templates: SavedTemplate[] = input.templates.map((t: unknown) => {
    if (!isRecord(t)) throw new Error('Mẫu không hợp lệ.');
    const id = boundedText(t.id, 80, 'Mã mẫu');
    if (ids.has(id)) throw new Error('Mã mẫu bị trùng.');
    ids.add(id);
    if (typeof t.createdAt !== 'string' || t.createdAt.length > 40 || !Number.isFinite(Date.parse(t.createdAt))) throw new Error('Ngày lưu mẫu không hợp lệ.');
    return { id, name: boundedText(t.name, 100, 'Tên mẫu'), createdAt: t.createdAt, config: validateTemplate({ version: 1, config: t.config }).config };
  });
  const user: LocalUser = { version: 1, profile: validateProfile(input.profile), templates };
  if (JSON.stringify(user).length > MAX_USER_CHARS) throw new Error('Kho mẫu vượt giới hạn. Hãy xuất JSON và xóa bớt mẫu.');
  return user;
}
export function parseUser(raw: string | null): LocalUser {
  if (raw === null) return defaultUser();
  if (raw.length > MAX_USER_CHARS) throw new Error('Kho mẫu vượt giới hạn.');
  return validateUser(JSON.parse(raw));
}
export function addTemplate(user: LocalUser, config: Config, name: string, id: string, createdAt: string): LocalUser {
  if (user.templates.length >= MAX_TEMPLATES) throw new Error('Đã đạt giới hạn 20 mẫu. Hãy xóa hoặc xuất mẫu cũ trước.');
  return validateUser({ ...user, templates: [{ id, name, createdAt, config }, ...user.templates] });
}
export function initials(name: string): string {
  return name.trim().split(/\s+/u).filter(Boolean).slice(0, 2).map(part => Array.from(part)[0] ?? '').join('').toLocaleUpperCase('vi-VN') || 'K';
}
