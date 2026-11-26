export const LIMITS = {
  fileBytes: 25 * 1024 * 1024,
  rows: 100_000,
  columns: 100,
  cells: 1_000_000,
  textLength: 32_767,
  groups: 5_000,
  filters: 12,
  page: 50,
  templateBytes: 128 * 1024,
} as const;

export type Cell = string | number | boolean | null;
export type Kind = 'number' | 'text' | 'date' | 'boolean';
export type Column = { id: string; name: string; kind: Kind };
export type Source = { name: string; sheets: string[]; sheet: string; rows: number; columns: Column[] };
export const AGGREGATIONS = ['sum', 'count', 'avg', 'min', 'max', 'distinct'] as const;
export type Aggregate = typeof AGGREGATIONS[number];
export const OPERATORS = ['contains', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'empty', 'notEmpty'] as const;
export type Operator = typeof OPERATORS[number];
export type Filter = { column: string; operator: Operator; value: string };
export type Config = { title: string; groups: string[]; metric: string; aggregate: Aggregate; filters: Filter[]; chart: 'bar' | 'horizontal'; sort: 'desc' | 'asc' };
export type Group = { labels: (string | null)[]; value: number | null; count: number };
export type Report = { total: number | null; filtered: number; groups: Group[]; truncated: boolean; preview: Cell[][]; page: number };
export type Template = { version: 1; config: Config };

export function normalizeHeaders(values: unknown[]): string[] {
  const used = new Set<string>();
  return values.map((value, i) => {
    const original = String(value ?? '').trim().slice(0, 200) || 'Cột ' + (i + 1);
    let name = original;
    for (let n = 2; used.has(name); n++) name = original + ' (' + n + ')';
    used.add(name);
    return name;
  });
}

export function defaultConfig(columns: Column[]): Config {
  const metric = columns.find(c => c.kind === 'number');
  const group = columns.find(c => c.kind === 'text' && c !== metric);
  return { title: 'Báo cáo tổng hợp', groups: group ? [group.name] : [], metric: metric?.name ?? '', aggregate: metric ? 'sum' : 'count', filters: [], chart: 'horizontal', sort: 'desc' };
}

export function validateTemplate(input: unknown): Template {
  if (!input || typeof input !== 'object') throw new Error('Mẫu báo cáo không hợp lệ.');
  const root = input as Record<string, unknown>;
  if (root.version !== 1 || !root.config || typeof root.config !== 'object') throw new Error('Phiên bản mẫu không được hỗ trợ.');
  const c = root.config as Record<string, unknown>;
  const name = (v: unknown): v is string => typeof v === 'string' && v.length <= 240;
  if (!name(c.title) || !name(c.metric) || !Array.isArray(c.groups) || c.groups.length > 3 || !c.groups.every(name) || new Set(c.groups).size !== c.groups.length || !AGGREGATIONS.includes(c.aggregate as Aggregate) || (c.chart !== 'bar' && c.chart !== 'horizontal') || (c.sort !== 'asc' && c.sort !== 'desc') || !Array.isArray(c.filters) || c.filters.length > LIMITS.filters) throw new Error('Cấu hình báo cáo không hợp lệ.');
  if (c.aggregate !== 'count' && !c.metric) throw new Error('Mẫu chưa chọn cột giá trị.');
  if (c.groups.some(g => !g)) throw new Error('Nhóm dữ liệu không hợp lệ.');
  const filters: Filter[] = c.filters.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('Bộ lọc không hợp lệ.');
    const f = item as Record<string, unknown>;
    if (!name(f.column) || !f.column || !OPERATORS.includes(f.operator as Operator) || typeof f.value !== 'string' || f.value.length > 1000) throw new Error('Bộ lọc không hợp lệ.');
    return { column: f.column, operator: f.operator as Operator, value: f.value };
  });
  return { version: 1, config: { title: c.title, metric: c.metric, groups: [...c.groups], aggregate: c.aggregate as Aggregate, chart: c.chart, sort: c.sort, filters } };
}

export function reconcileConfig(config: Config, columns: Column[]): { config: Config; missing: string[] } {
  const names = new Set(columns.map(c => c.name));
  const missing = [...new Set([...config.groups, ...config.filters.map(f => f.column), ...(config.metric ? [config.metric] : [])])].filter(n => !names.has(n));
  const groups = config.groups.filter(n => names.has(n));
  const filters = config.filters.filter(f => names.has(f.column));
  let metric = names.has(config.metric) ? config.metric : '';
  let aggregate = config.aggregate;
  if (aggregate !== 'count' && aggregate !== 'distinct' && !columns.some(c => c.name === metric && c.kind === 'number')) {
    if (metric) missing.push(metric + ' (không phải số)');
    metric = '';
    aggregate = 'count';
  }
  if (!metric && aggregate === 'distinct') aggregate = 'count';
  return { config: { ...config, groups, filters, metric, aggregate }, missing };
}

export function sqlText(value: string): string {
  if (value.includes('\0')) throw new Error('Giá trị chứa ký tự không hợp lệ.');
  return "'" + value.replaceAll("'", "''") + "'";
}

export function compileReport(config: Config, columns: Column[]) {
  const checked = validateTemplate({ version: 1, config }).config;
  const column = (name: string) => {
    const c = columns.find(item => item.name === name);
    if (!c || !/^c[0-9]+$/.test(c.id)) throw new Error('Không tìm thấy cột: ' + name);
    return '"' + c.id + '"';
  };
  const numeric = (name: string) => 'TRY_CAST(' + column(name) + ' AS DOUBLE)';
  const groups = checked.groups.map(column);
  let aggregate: string;
  if (checked.aggregate === 'count') aggregate = 'COUNT(*)';
  else if (checked.aggregate === 'distinct') aggregate = 'COUNT(DISTINCT ' + column(checked.metric) + ')';
  else {
    if (!columns.some(c => c.name === checked.metric && c.kind === 'number')) throw new Error('Hãy chọn cột số.');
    aggregate = checked.aggregate.toUpperCase() + '(' + numeric(checked.metric) + ')';
  }
  const conditions = checked.filters.map(f => {
    const c = column(f.column);
    if (f.operator === 'empty') return '(' + c + ' IS NULL OR trim(' + c + ") = '')";
    if (f.operator === 'notEmpty') return '(' + c + ' IS NOT NULL AND trim(' + c + ") <> '')";
    if (f.operator === 'contains') return 'contains(lower(coalesce(' + c + ", '')), lower(" + sqlText(f.value) + '))';
    if (f.operator === 'eq' || f.operator === 'neq') return c + (f.operator === 'eq' ? ' = ' : ' <> ') + sqlText(f.value);
    const n = Number(f.value);
    if (!f.value.trim() || !Number.isFinite(n)) throw new Error('Bộ lọc số cần giá trị hợp lệ.');
    const op = { gt: '>', gte: '>=', lt: '<', lte: '<=' }[f.operator];
    return numeric(f.column) + ' ' + op + ' ' + String(n);
  });
  const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
  const source = ' FROM report_data' + where;
  const grouping = groups.length ? ' GROUP BY ' + groups.join(', ') : '';
  const projection = groups.map((g, i) => g + ' AS g' + i).concat([aggregate + ' AS value', 'COUNT(*) AS n']).join(', ');
  return {
    totals: 'SELECT ' + aggregate + ' AS value, COUNT(*) AS n' + source,
    groups: 'SELECT ' + projection + source + grouping + ' ORDER BY value ' + checked.sort.toUpperCase() + ' NULLS LAST' + (groups.length ? ', ' + groups.map((_,i) => 'g' + i + ' ASC NULLS LAST').join(', ') : '') + ' LIMIT ' + (LIMITS.groups + 1),
    preview: (page: number) => 'SELECT *' + source + ' ORDER BY rowid LIMIT ' + LIMITS.page + ' OFFSET ' + Math.max(0, Math.trunc(page)) * LIMITS.page,
    raw: 'SELECT *' + source + ' ORDER BY rowid',
  };
}

export function safeCsvCell(value: Cell): string {
  if (value === null) return '""';
  let text = String(value);
  if (typeof value === 'string' && /^[\s\u0000-\u001f]*[=+\-@]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
