import { defaultUser, validateUser } from './user-model.ts';
import type { LocalUser } from './user-model.ts';
import { validateTemplate } from './model.ts';
import type { Config } from './model.ts';
import { validateWorkspace } from './workspace-model.ts';
import type { SavedWorkspace } from './workspace-model.ts';
import { validateRecipes } from './pipeline-model.ts';
import type { PipelineRecipe } from './pipeline-model.ts';

export const ACCOUNT_MAX_BYTES = 512_000;
export type Account = { id: string; email: string };
export type AccountSettings = LocalUser & { lastConfig: Config | null; workspace: SavedWorkspace | null; pipelines?: PipelineRecipe[] };
export type AccountSnapshot = { account: Account; settings: AccountSettings; revision: number; expiresAt: number };
export function defaultSettings(name = 'Người dùng'): AccountSettings {
  const user = defaultUser();
  return { ...user, profile: { ...user.profile, displayName: name.trim().slice(0, 64) || 'Người dùng' }, lastConfig: null, workspace: null };
}
export function validateSettings(input: unknown): AccountSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Cấu hình tài khoản không hợp lệ.');
  const obj = input as Record<string, unknown>;
  const user = validateUser(obj);
  const lastConfig = obj.lastConfig == null ? null : validateTemplate({ version: 1, config: obj.lastConfig }).config;
  const pipelines=validateRecipes(obj.pipelines);
  const settings = { ...user, lastConfig, workspace: validateWorkspace(obj.workspace), ...(pipelines.length?{pipelines}:{}) };
  if (new TextEncoder().encode(JSON.stringify(settings)).byteLength > ACCOUNT_MAX_BYTES) throw new Error('Cấu hình vượt 512 KB.');
  return settings;
}
export function parseSettings(raw: string): AccountSettings {
  if (raw.length > ACCOUNT_MAX_BYTES) throw new Error('Cấu hình vượt giới hạn.');
  return validateSettings(JSON.parse(raw));
}
export function validRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER;
}
