import {expect,test} from './account-fixture';
import * as XLSX from 'xlsx';
function file(name:string,rows:(string|number)[][]){
 const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),'Sales');
 return {name,mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:XLSX.write(wb,{type:'buffer',bookType:'xlsx'})};
}
test('schema previews errors, applies rename and locale conversion, restores saved rules',async({page,accountFixture})=>{
 await page.goto('/');
 await expect(page.getByTestId('filtered-count')).toHaveText('180');
 await page.getByLabel('Chọn dữ liệu Excel',{exact:true}).setInputFiles(file('schema.xlsx',[['Code','Amount'],['001','1.234,50'],['002','2.000,50']]));
 await expect(page.getByTestId('filtered-count')).toHaveText('2');
 const panel=page.getByRole('region',{name:'Cấu trúc cột',exact:true});
 await panel.getByRole('button',{name:'Chỉnh cấu trúc'}).click();
 await panel.getByLabel('Kiểu cột Code',{exact:true}).selectOption('date');
 await panel.getByRole('button',{name:'Kiểm tra chuyển đổi'}).click();
 await expect(panel.getByRole('status')).toContainText('Có 2 ô');
 await expect(panel.getByRole('button',{name:'Áp dụng cấu trúc'})).toBeDisabled();
 await panel.getByLabel('Kiểu cột Code',{exact:true}).selectOption('text');
 await panel.getByLabel('Tên cột Amount',{exact:true}).fill('Revenue');
 await panel.getByLabel('Kiểu cột Amount',{exact:true}).selectOption('number-vi');
 await panel.getByRole('button',{name:'Kiểm tra chuyển đổi'}).click();
 await expect(panel.getByRole('status')).toContainText('không có lỗi chuyển đổi');
 await panel.getByRole('button',{name:'Áp dụng cấu trúc'}).click();
 await expect(page.getByText('Đã áp dụng cấu trúc cột.',{exact:true})).toBeVisible();
 await expect(panel.getByRole('button',{name:'Chỉnh cấu trúc'})).toBeVisible();
 await page.getByRole('button',{name:'Lưu workspace',exact:true}).click();
 await expect(page.getByText('Đã lưu workspace vào tài khoản.',{exact:true})).toBeVisible();
 expect(accountFixture.settings.workspace?.slots[0].schema).toEqual([{sourceName:'Code',name:'Code',mode:'text'},{sourceName:'Amount',name:'Revenue',mode:'number-vi'}]);
 await page.reload();
 await expect(page.getByText('0/1 nguồn đã nạp',{exact:true})).toBeVisible();
 // A visible KPI can still show the startup placeholder. Wait for the engine and
 // use the actual enabled file-picker button, as a user would.
 await expect(page.getByTestId('filtered-count')).toHaveText('180');
 const savedSlot=page.getByRole('listitem').filter({has:page.getByText('schema.xlsx · Sales',{exact:true})});
 const choose=savedSlot.getByRole('button',{name:'Chọn file',exact:true});
 const pick=async(payload:ReturnType<typeof file>)=>{
   await expect(choose).toBeEnabled();
   const pending=page.waitForEvent('filechooser');
   await choose.click();
   await (await pending).setFiles(payload);
 };
 // A bad locale value must be rejected without replacing the current source.
 await pick(file('bad.xlsx',[['Amount','Code'],['3,000.00','003']]));
 await expect(page.getByRole('alert')).toContainText('SCHEMA_CONVERSION_FAILED');
 await expect(page.getByText('0/1 nguồn đã nạp',{exact:true})).toBeVisible();
 await expect(page.getByTestId('filtered-count')).toHaveText('180');
 await pick(file('next.xlsx',[['Amount','Code'],['3.000,00','003']]));
 await expect(page.getByText('1/1 nguồn đã nạp',{exact:true})).toBeVisible();
 await expect(page.getByTestId('filtered-count')).toHaveText('1');
 await panel.getByRole('button',{name:'Chỉnh cấu trúc'}).click();
 await expect(panel.getByLabel('Tên cột Amount',{exact:true})).toHaveValue('Revenue');
 await expect(panel.getByLabel('Kiểu cột Amount',{exact:true})).toHaveValue('number-vi');
 const profile=page.getByRole('region',{name:'Chất lượng dữ liệu',exact:true});
 await profile.getByRole('button',{name:'Phân tích chất lượng'}).click();
 const row=profile.getByRole('row').filter({has:page.getByRole('rowheader',{name:/^Revenue/})});
 await expect(row.getByRole('cell').nth(5)).toHaveText('3.000');
});
