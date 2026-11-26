import type { Config, Report, Source } from './model';
export type Requests = {
  demo: { input: null; output: Source };
  import: { input: { name: string; bytes: ArrayBuffer }; output: Source };
  sheet: { input: { sheet: string }; output: Source };
  report: { input: { config: Config; page: number }; output: Report };
  export: { input: { config: Config; format: 'xlsx' | 'csv' }; output: { bytes: ArrayBuffer; name: string; mime: string } };
};
export type Request = { [K in keyof Requests]: { id: number; type: K; input: Requests[K]['input'] } }[keyof Requests];
export type Response = { id: number; ok: true; data: unknown } | { id: number; ok: false; error: string };
