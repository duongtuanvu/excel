import {expect,test} from './account-fixture';
import * as XLSX from 'xlsx';
function file(name:string,rows:(string|number)[][]){
 const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),'Sales');
 return {name,mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:XLSX.write(wb,{type:'buffer',bookType:'xlsx'})};
}
test('select header and exclude totals, map renamed columns and restore layout',async({page,accountFixture})=>{
 await page.goto('/');
 await expect(page.getByTestId('filtered-count')).toHaveText('180');
 await page.getByLabel('Chọn dữ liệu Excel',{exact:true}).setInputFiles(file('range.xlsx',[['Title',''],['Region','Amount'],['A',10],['B',20],['Total',30]]));
 await expect(page.getByTestId('filtered-count')).toHaveText('4');
 const panel=page.getByRole('region',{name:'Vùng dữ liệu và mapping',exact:true});
 await panel.getByRole('button',{name:'Chỉnh vùng / mapping'}).click();
 await panel.getByLabel('Tự nhận diện toàn sheet').uncheck();
 await panel.getByLabel('Dòng tiêu đề',{exact:true}).fill('2');
 await panel.getByLabel('Dòng cuối',{exact:true}).fill('4');
 await panel.getByRole('button',{name:'Kiểm tra vùng'}).click();
 await expect(panel.getByRole('status')).toContainText('2 dòng');
 await panel.getByRole('checkbox',{name:/Đồng ý đặt lại báo cáo/}).check();
 await panel.getByRole('button',{name:'Áp dụng vùng'}).click();
 await expect(page.getByTestId('metric-total')).toHaveText('30');
 await panel.getByRole('button',{name:'Chỉnh vùng / mapping'}).click();
 await panel.getByLabel('File mapping',{exact:true}).setInputFiles(file('mapped.xlsx',[['Title',''],['Region','Sales'],['A',40],['B',60],['Total',100]]));
 await panel.getByLabel('Ghép cột Amount',{exact:true}).selectOption('Sales');
 await panel.getByRole('button',{name:'Kiểm tra mapping'}).click();
 await expect(panel.getByRole('status')).toContainText('Mapping hợp lệ: 2 dòng.');
 await panel.getByRole('button',{name:'Áp dụng mapping'}).click();
 await expect(page.getByTestId('metric-total')).toHaveText('100');
 await page.getByRole('button',{name:'Lưu workspace',exact:true}).click();
 await expect(page.getByText('Đã lưu workspace vào tài khoản.',{exact:true})).toBeVisible();
 expect(accountFixture.settings.workspace?.slots[0].layout?.headerRow).toBe(2);
 expect(accountFixture.settings.workspace?.slots[0].schema).toEqual([{sourceName:'Sales',name:'Amount',mode:'auto'}]);
 await page.reload();
 await expect(page.getByTestId('filtered-count')).toHaveText('180');
 await page.getByLabel('File cho nguồn range.xlsx · Sales',{exact:true}).setInputFiles(file('next.xlsx',[['Title',''],['Region','Sales'],['A',70],['B',80],['Total',150]]));
 await expect(page.getByTestId('metric-total')).toHaveText('150');
});
