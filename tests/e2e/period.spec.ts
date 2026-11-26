import {expect,test} from './account-fixture';
import {readFileSync} from 'node:fs';
import * as XLSX from 'xlsx';
import type {Config} from '../../src/model';
import type {SavedModel, SavedSource} from '../../src/workspace-model';

function excel(name:string,rows:(string|number)[][]){
  const book=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(rows),'Data');
  return {name,mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:XLSX.write(book,{type:'buffer',bookType:'xlsx'})};
}

test('a saved JOIN and filter replay after reload, validate new files, handle expansion, and export the new period',async({page,accountFixture},testInfo)=>{
  await page.goto('/');
  const metric=page.getByTestId('metric-total');
  await expect(page.getByTestId('filtered-count')).toHaveText('180');
  const upload=page.getByLabel('Chọn dữ liệu Excel',{exact:true});
  await upload.setInputFiles(excel('orders.xlsx',[['Region','Amount'],['N',10],['S',20]]));
  await expect(metric).toHaveText('30');
  await upload.setInputFiles(excel('teams.xlsx',[['Region','Team'],['N','Retail'],['S','Wholesale']]));
  await expect(metric).toHaveText('2');
  const model=page.getByRole('region',{name:'Mô hình dữ liệu',exact:true});
  await model.getByRole('button',{name:'Mở Data Model'}).click();
  await model.getByLabel('Tên bảng kết quả').fill('Orders with team');
  await model.getByRole('button',{name:'Kiểm tra mô hình'}).click();
  await model.getByRole('button',{name:'Tạo bảng kết quả'}).click();
  await expect(metric).toHaveText('30');
  const pipeline=page.getByRole('region',{name:'Pipeline biến đổi dữ liệu',exact:true});
  await pipeline.getByRole('button',{name:'Mở Pipeline'}).click();
  await pipeline.getByLabel('Nguồn pipeline',{exact:true}).selectOption({label:'Orders with team'});
  await pipeline.getByLabel('Tên bảng pipeline').fill('Retail orders');
  await pipeline.getByLabel('Loại bước 1').selectOption('filter');
  await pipeline.getByLabel('Cột bước 1').selectOption('Phải · Team');
  await pipeline.getByLabel('Điều kiện bước 1').selectOption('eq');
  await pipeline.getByLabel('Giá trị bước 1').fill('Retail');
  await pipeline.getByRole('button',{name:'Kiểm tra pipeline'}).click();
  await pipeline.getByRole('button',{name:'Tạo bảng pipeline'}).click();
  await expect(metric).toHaveText('10');
  await page.getByLabel('Tên báo cáo',{exact:true}).fill('Retail sales');
  await page.getByRole('button',{name:'Lưu workspace',exact:true}).click();
  await expect(page.getByText('Đã lưu workspace vào tài khoản.',{exact:true})).toBeVisible();
  expect(accountFixture.settings.workspace?.models?.map(m=>m.operation)).toEqual(['left','pipeline']);
  await page.reload();
  await expect(page.getByTestId('filtered-count')).toHaveText('180');
  const runner=page.getByRole('region',{name:'Báo cáo kỳ mới',exact:true});
  const feb=excel('feb.xlsx',[['Amount','Region','Extra'],[55,'N','x'],[25,'S','y']]);
  const teams=excel('feb-teams.xlsx',[['Team','Region'],['Retail','N'],['Wholesale','S']]);
  async function files(orders:ReturnType<typeof excel>,mapping:ReturnType<typeof excel>){
    await runner.getByLabel('File kỳ mới cho orders.xlsx · Data',{exact:true}).setInputFiles(orders);
    await runner.getByLabel('File kỳ mới cho teams.xlsx · Data',{exact:true}).setInputFiles(mapping);
    await runner.getByRole('button',{name:'Chạy báo cáo',exact:true}).click();
  }
  await runner.getByRole('button',{name:'Chạy kỳ mới'}).click();
  await files(feb,teams);
  await expect(metric).toHaveText('55');
  await expect(page.getByLabel('Tên báo cáo',{exact:true})).toHaveValue('Retail sales');
  await runner.getByRole('button',{name:'Chạy kỳ mới'}).click();
  const march=excel('march.xlsx',[['Region','Amount'],['N',70],['S',35]]);
  await files(march,excel('wrong.xlsx',[['Region','Wrong'],['N','Retail']]));
  await expect(runner.getByRole('alert')).toContainText('Team');
  await expect(metric).toHaveText('55');
  await files(march,excel('duplicate.xlsx',[['Region','Team'],['N','Retail'],['N','Retail'],['S','Wholesale']]));
  await expect(runner.getByRole('alert')).toContainText('khóa ghép trùng');
  await expect(metric).toHaveText('55');
  await runner.getByRole('button',{name:'Xác nhận ghép và tiếp tục'}).click();
  await expect(metric).toHaveText('140');
  await expect(page.getByTestId('filtered-count')).toHaveText('2');
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'Xuất Excel',exact:true}).click();
  const path=testInfo.outputPath('march.xlsx');await (await download).saveAs(path);
  const out=XLSX.read(readFileSync(path),{type:'buffer'});
  expect(XLSX.utils.sheet_to_json(out.Sheets['Tổng quan'],{header:1})).toContainEqual(['Giá trị',140]);
  expect(XLSX.utils.sheet_to_json(out.Sheets['Dữ liệu đã lọc'],{header:1})).toHaveLength(3);
});

test('a three-file UNION restores from saved definitions, preserves other work and allows rerunning just one source',async({page,accountFixture})=>{
  const config:Config={title:'Quantity',groups:['Item'],metric:'Qty',aggregate:'sum',filters:[],chart:'bar',sort:'desc'};
  function slot(alias:string):SavedSource{
    return {id:crypto.randomUUID(),alias,sheet:'Data',columns:[{name:'Item',kind:'text'},{name:'Qty',kind:'number'}],config};
  }
  function union(left:{id:string},right:{id:string},alias:string,operation:'union-all'|'union'):SavedModel{
    return {id:crypto.randomUUID(),alias,config,leftSlotId:left.id,rightSlotId:right.id,operation,leftColumns:['Item','Qty'],rightColumns:['Item','Qty'],
      pairs:[{left:'Item',right:'Item'},{left:'Qty',right:'Qty'}]};
  }
  const [a,b,c,unused]=['North','South','West','Other report'].map(slot);
  const ab=union(a,b,'First two','union-all'),abc=union(ab,c,'All branches','union');
  accountFixture.settings.workspace={version:1,slots:[a,b,c,unused],models:[ab,abc],outputId:abc.id};
  await page.goto('/');
  await expect(page.getByTestId('filtered-count')).toHaveText('180');
  await page.getByLabel('Chọn dữ liệu Excel',{exact:true}).setInputFiles(excel('unrelated.xlsx',[['Item','Qty'],['U',900]]));
  const metric=page.getByTestId('metric-total');
  await expect(metric).toHaveText('900');
  const runner=page.getByRole('region',{name:'Báo cáo kỳ mới',exact:true});
  await runner.getByRole('button',{name:'Chạy kỳ mới'}).click();
  await expect(runner.locator('input[type=file]')).toHaveCount(3);
  await runner.getByLabel('File kỳ mới cho North').setInputFiles(excel('n.xlsx',[['Item','Qty'],['A',1]]));
  await runner.getByLabel('File kỳ mới cho South').setInputFiles(excel('s.xlsx',[['Qty','Note','Item'],[2,'extra','B']]));
  await runner.getByLabel('File kỳ mới cho West').setInputFiles(excel('w.xlsx',[['Qty','Item'],[1,'A'],[3,'C']]));
  await runner.getByRole('button',{name:'Chạy báo cáo',exact:true}).click();
  await expect(metric).toHaveText('6');
  await expect(page.getByTestId('filtered-count')).toHaveText('3');
  await page.getByRole('button',{name:'Lưu workspace',exact:true}).click();
  await expect(page.getByText('Đã lưu workspace vào tài khoản.',{exact:true})).toBeVisible();
  expect(accountFixture.settings.workspace?.models).toHaveLength(2);
  await runner.getByRole('button',{name:'Chạy kỳ mới'}).click();
  await runner.getByLabel('Báo cáo cần chạy').selectOption(a.id);
  await expect(runner.locator('input[type=file]')).toHaveCount(1);
  await runner.getByLabel('File kỳ mới cho North').setInputFiles(excel('next.xlsx',[['Item','Qty'],['A',7]]));
  await runner.getByRole('button',{name:'Chạy báo cáo',exact:true}).click();
  await expect(metric).toHaveText('7');
  await expect(page.getByRole('button',{name:'Mở nguồn All branches',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Mở nguồn unrelated.xlsx · Data',exact:true}).click();
  await expect(metric).toHaveText('900');
});
