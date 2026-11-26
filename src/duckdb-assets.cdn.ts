// Only the version-pinned static WASM binary is downloaded from the CDN.
// Workbook bytes, SQL and results stay inside workers on the user's device.
// Keep this version synchronized with package.json.
const root = 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.30.0/dist/';
export const mvpWasm = root + 'duckdb-mvp.wasm';
export const ehWasm = root + 'duckdb-eh.wasm';
export { default as mvpWorker } from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
export { default as ehWorker } from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
