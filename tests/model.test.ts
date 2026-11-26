import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHeaders, defaultConfig, validateTemplate, reconcileConfig, compileReport, safeCsvCell, sqlText } from '../src/model.ts';
import type { Column, Config } from '../src/model.ts';

const columns: Column[] = [{ id: 'c0', name: 'Khu vực', kind: 'text' }, { id: 'c1', name: 'Doanh thu', kind: 'number' }];
const config: Config = { ...defaultConfig(columns), title: 'Doanh thu' };

test('empty and duplicate headers become unique', () => {
  assert.deepEqual(normalizeHeaders(['', 'Tên', 'Tên', 'Tên (2)', null]), ['Cột 1','Tên','Tên (2)','Tên (2) (2)','Cột 5']);
});
test('aggregation is generated using internal column IDs only', () => {
  const q = compileReport(config, columns);
  assert.match(q.totals, /SUM\(TRY_CAST\("c1" AS DOUBLE\)\)/);
  assert.match(q.groups, /GROUP BY "c0"/);
  assert.match(q.preview(2), /LIMIT 50 OFFSET 100$/);
  assert.doesNotMatch(q.totals, /Doanh thu/);
});
test('SQL literals cannot break out of quoted filter values', () => {
  const value = "x'; DROP TABLE report_data; --";
  assert.equal(sqlText(value), "'x''; DROP TABLE report_data; --'");
  const q = compileReport({ ...config, filters: [{ column: 'Khu vực', operator: 'eq', value }] }, columns);
  assert.ok(q.totals.endsWith("WHERE \"c0\" = 'x''; DROP TABLE report_data; --'"));
});
test('invalid metrics, numeric filters and missing columns are rejected', () => {
  assert.throws(() => compileReport({...config, metric:'Khu vực'}, columns));
  assert.throws(() => compileReport({...config, filters:[{column:'Doanh thu', operator:'gt', value:'no'}]}, columns));
  assert.throws(() => compileReport({...config, groups:['missing']}, columns));
});
test('JSON templates validate and reconcile by column name, not position', () => {
  const template = validateTemplate(JSON.parse(JSON.stringify({version:1,config})));
  assert.deepEqual(template.config,config);
  assert.deepEqual(reconcileConfig(config,[{...columns[1],id:'c0'},{...columns[0],id:'c1'}]).missing,[]);
  assert.deepEqual(reconcileConfig(config,[columns[1]]).missing,['Khu vực']);
  assert.throws(() => validateTemplate({version:2,config}));
  assert.throws(() => validateTemplate({version:1,config:{...config,aggregate:'DROP TABLE'}}));
  assert.throws(() => validateTemplate({version:1,config:{...config,metric:''}}));
});
test('CSV text is escaped and formulas neutralized without changing negative numbers', () => {
  assert.equal(safeCsvCell('=SUM(A1:A3)'), '"\'=SUM(A1:A3)"');
  assert.equal(safeCsvCell('  @foo'), '"\'  @foo"');
  assert.equal(safeCsvCell('a"b'), '"a""b"');
  assert.equal(safeCsvCell(-42), '"-42"');
});
