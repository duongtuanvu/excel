import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { test, expect } from './account-fixture';
import { applicableDefinitions } from '../../src/tt99-forms';
import { TT99_SHEETS } from '../../src/tt99-import-schema';
import type { FormId } from '../../src/tt99-types';

const mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

test('retain the draft measure when checking the source or changing to TT99', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('filtered-count')).toHaveText('180');
  await page.getByRole('tab',{name:'Pivot',exact:true}).click();
  const panel = page.getByRole('region',{name:'Pivot nâng cao',exact:true});
  await panel.getByRole('button',{name:'Mở Pivot'}).click();
  const name = panel.getByLabel('Tên chỉ số 1',{exact:true});
  await name.fill('Doanh thu nháp');
  await page.getByRole('tab',{name:'Báo cáo & Bảng'}).click();
  await page.getByRole('tab',{name:'Pivot',exact:true}).click();
  await expect(name).toHaveValue('Doanh thu nháp');
  await page.getByRole('button',{name:'BCTC TT99',exact:true}).click();
  await page.getByRole('button',{name:'Báo cáo',exact:true}).click();
  await expect(name).toHaveValue('Doanh thu nháp');
});

test('TT99: use the template, trace 131/312, retain exact statements and restore the local dossier', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button',{name:'BCTC TT99',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Lập báo cáo tài chính'})).toBeVisible();
  const exportFinal = page.getByRole('button',{name:'Xuất BCTC Excel',exact:true});
  await expect(exportFinal).toBeDisabled();
  async function download(label: string, file: string) {
    const pending = page.waitForEvent('download');
    await page.getByRole('button',{name:label,exact:true}).click();
    const path = testInfo.outputPath(file);
    await (await pending).saveAs(path);
    return readFileSync(path);
  }
  const book = XLSX.read(await download('Tải mẫu nhập sổ','template.xlsx'),{type:'buffer'});
  const add = (key: keyof typeof TT99_SHEETS, rows: (string | number)[][]) =>
    XLSX.utils.sheet_add_aoa(book.Sheets[TT99_SHEETS[key].name],rows,{origin:'A2'});
  // Sales on credit, followed by a deposit from a different customer.
  add('trial',[
    ['111',0,0,30000000,0,30000000,0,'111','Nợ'],
    ['131',0,0,100000000,30000000,100000000,30000000],
    ['511',0,0,100000000,100000000,0,0], ['911',0,0,100000000,100000000,0,0],
    ['4212',0,0,0,100000000,0,100000000,'420b','Có'],
  ]);
  add('receivables',[
    ['Hiện tại','Khách A','Ngắn hạn',100000000,0],
    ['Hiện tại','Khách B','Ngắn hạn',0,30000000],
  ]);
  add('journal',[
    ['Hiện tại','2026-01-01','131','511',100000000,'01'],
    ['Hiện tại','2026-01-02','111','131',30000000,'','','01'],
    ['Hiện tại','2026-12-31','511','911',100000000],
    ['Hiện tại','2026-12-31','911','4212',100000000],
  ]);
  const currentFromBooks: Record<FormId,string[]> = { B01:['111','131','312','420b'], B02:['01'], B03:['01'] };
  const priorFromBooks: Record<FormId,string[]> = { B01:['111','420b'], B02:[], B03:[] };
  const zero: string[][] = [];
  for (const form of ['B01','B02','B03'] as FormId[]) {
    for (const line of applicableDefinitions(form,false).filter(row => !row.terms)) {
      if (!currentFromBooks[form].includes(line.code)) zero.push([form,line.code,'Hiện tại','0','Bảng đối chiếu cuối năm']);
      if (!priorFromBooks[form].includes(line.code)) zero.push([form,line.code,'So sánh','0','BCTC kỳ trước']);
    }
  }
  add('lines',zero);
  await page.getByLabel('Tên doanh nghiệp',{exact:true}).fill('Doanh nghiệp kiểm thử');
  await page.getByLabel('Địa chỉ doanh nghiệp').fill('Hà Nội');
  await page.getByLabel('Ngày bắt đầu năm tài chính').fill('2026-01-01');
  await page.getByLabel('Ngày kết thúc năm tài chính').fill('2026-12-31');
  const file = page.getByLabel('Nhập sổ kế toán');
  await file.setInputFiles({name:'so-da-chot.xlsx',mimeType,buffer:XLSX.write(book,{type:'buffer',bookType:'xlsx'})});
  const row = (code: string) => page.locator('tr[data-code="' + code + '"]');
  await expect(row('131')).toContainText('100.000.000');
  await expect(row('312')).toContainText('30.000.000');
  await expect(row('280')).toContainText('130.000.000');
  await row('131').getByRole('button').first().click();
  await expect(page.getByText(/Khách A.*so-da-chot\.xlsx/)).toBeVisible();
  const draft = XLSX.read(await download('Xuất bản nháp Excel','draft.xlsx'),{type:'buffer'});
  expect(draft.SheetNames).toContain('Nguồn số liệu');
  expect(draft.Sheets['B01-DN'].A8.v).toContain('NHÁP');
  await expect(exportFinal).toBeDisabled();
  await page.getByRole('button',{name:'B09-DN',exact:true}).click();
  const notes = page.locator('.tt-note');
  for (let i = 0; i < await notes.count(); i++) {
    const editor = notes.nth(i);
    await editor.locator('summary').click();
    await editor.getByRole('textbox').fill('Nội dung kiểm thử mục ' + (i + 1) + '\nKhoản mục\tCuối năm\tĐầu năm');
    await editor.getByRole('checkbox').check();
    await editor.locator('summary').click();
  }
  await expect(exportFinal).toBeEnabled();
  const out = XLSX.read(await download('Xuất BCTC Excel','final.xlsx'),{type:'buffer'});
  expect(out.SheetNames).toEqual(['B01-DN','B02-DN','B03-DN','B09-DN']);
  function amount(form: string, code: string) {
    return XLSX.utils.sheet_to_json<unknown[]>(out.Sheets[form],{header:1}).find(r => r[1] === code)?.[3];
  }
  expect(amount('B01-DN','131')).toBe(100000000);
  expect(amount('B01-DN','312')).toBe(30000000);
  expect(amount('B02-DN','60')).toBe(100000000);
  expect(amount('B03-DN','70')).toBe(30000000);
  const saved = await download('Lưu hồ sơ','dossier.json');
  await page.reload();
  await page.getByRole('button',{name:'BCTC TT99',exact:true}).click();
  await page.getByLabel('Tệp hồ sơ TT99').setInputFiles({name:'dossier.json',mimeType:'application/json',buffer:saved});
  await expect(row('131')).toContainText('100.000.000');
  await expect(exportFinal).toBeEnabled();
});
