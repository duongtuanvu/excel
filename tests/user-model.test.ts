import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addTemplate, defaultUser, initials, MAX_TEMPLATES, parseUser, validateProfile, validateUser } from '../src/user-model.ts';
import { defaultConfig } from '../src/model.ts';

const config = defaultConfig([{ id: 'c0', name: 'Amount', kind: 'number' }]);
const createdAt = '2026-11-26T00:00:00.000Z';

test('defaults to a local profile without accounts', () => {
  assert.deepEqual(parseUser(null), defaultUser());
  assert.equal(initials('Nguyễn Văn'), 'NV');
});
test('validates and trims profile fields; rejects invalid density and lengths', () => {
  assert.equal(validateProfile({ displayName: '  Test  ', workspace: 'Team', density: 'compact' }).displayName, 'Test');
  assert.throws(() => validateProfile({ displayName: ' ', workspace: 'Team', density: 'compact' }));
  assert.throws(() => validateProfile({ displayName: 'Test', workspace: 'Team', density: 'unknown' }));
  assert.throws(() => validateProfile({ displayName: 'a'.repeat(65), workspace: 'Team', density: 'compact' }));
});
test('saved templates are validated and round-trip without workbook bytes', () => {
  const user = addTemplate(defaultUser(), config, 'Monthly', 'sample-1', createdAt);
  assert.deepEqual(parseUser(JSON.stringify(user)), user);
  assert.deepEqual(Object.keys(user.templates[0]).sort(), ['config','createdAt','id','name']);
  assert.throws(() => addTemplate(user, config, 'Duplicate', 'sample-1', createdAt));
  assert.throws(() => validateUser({ ...user, version: 2 }));
  assert.throws(() => parseUser('{invalid'));
});
test('limits saved templates and rejects oversized local payloads', () => {
  let user = defaultUser();
  for (let i = 0; i < MAX_TEMPLATES; i++) user = addTemplate(user, config, 'Sample', 'id-' + i, createdAt);
  assert.throws(() => addTemplate(user, config, 'Extra', 'extra', createdAt));
  assert.throws(() => parseUser(' '.repeat(512_001)));
});
