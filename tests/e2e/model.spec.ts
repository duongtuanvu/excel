import {expect,test} from './account-fixture';
import * as XLSX from 'xlsx';
import type {Page,Locator} from '@playwright/test';
async function uniquePanels(page:Page){
 await expect(page.getByRole('region',{name:'Mô hình dữ liệu',exact:true})).toHaveCount(1);
 await expect(page.getByRole('region',{name:'Cập nhật hàng loạt',exact:true})).toHaveCount(1);
}
async function previewModel(panel:Locator,expected:string){
 await panel.getByRole('button',{name:'Kiểm tra mô hình',exact:true}).click();
 const output=panel.getByText(expected,{exact:true}),alert=panel.getByRole('alert');
 await expect(output.or(alert)).toBeVisible({timeout:30000});
 if(await alert.count())throw Error('MODEL_PREVIEW_ERROR: '+await alert.innerText());
 await expect(output).toBeVisible();
}
function file(name:string,rows:(string|number|null)[][]){
 const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),'Sales');
 return {name,mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:XLSX.write(wb,{type:'buffer',bookType:'xlsx'})};
}
test('join detects expansion, materializes correct results, invalidates on replacement',async({page})=>{
 await page.goto('/');await expect(page.getByTestId('filtered-count')).toHaveText('180');
 const upload=page.getByLabel('Chọn dữ liệu Excel',{exact:true});
 await upload.setInputFiles(file('a.xlsx',[['Key','Amount'],['A',10],['A',20],['B',30],[null,40]]));
 await expect(page.getByTestId('metric-total')).toHaveText('100');
 await upload.setInputFiles(file('b.xlsx',[['Key','Amount'],['A',1],['A',2],['C',3],[null,4]]));
 await expect(page.getByTestId('metric-total')).toHaveText('10');
 await uniquePanels(page);
 const panel=page.getByRole('region',{name:'Mô hình dữ liệu',exact:true});
 await panel.getByRole('button',{name:'Mở Data Model'}).click();
 await panel.getByLabel('Tên bảng kết quả').fill('Joined');
 await previewModel(panel,'6 dòng · 4 cột kết quả');
 await expect(panel.getByText('N:N',{exact:true})).toBeVisible();
 await expect(panel.getByRole('button',{name:'Tạo bảng kết quả'})).toBeDisabled();
 await panel.getByRole('checkbox',{name:/Tôi hiểu JOIN/}).check();
 await panel.getByRole('button',{name:'Tạo bảng kết quả'}).click();
 await expect(page.getByTestId('filtered-count')).toHaveText('6');
 await expect(page.getByTestId('metric-total')).toHaveText('130');
 await uniquePanels(page);
 await page.getByRole('button',{name:'Mở nguồn a.xlsx · Sales',exact:true}).click();
 await expect(page.getByTestId('metric-total')).toHaveText('100');
 await page.getByLabel('Chọn file thay thế',{exact:true}).setInputFiles(file('new.xlsx',[['Key','Amount'],['A',99]]));
 await expect(page.getByTestId('metric-total')).toHaveText('99');
 await expect(page.getByRole('button',{name:'Mở nguồn Joined',exact:true})).toBeDisabled();
 await uniquePanels(page);
});
test('union distinct uses mapping and removes identical rows',async({page})=>{
 await page.goto('/');await expect(page.getByTestId('filtered-count')).toHaveText('180');
 const upload=page.getByLabel('Chọn dữ liệu Excel',{exact:true});
 await upload.setInputFiles(file('a.xlsx',[['Key','Amount'],['A',10]]));await expect(page.getByTestId('metric-total')).toHaveText('10');
 await upload.setInputFiles(file('b.xlsx',[['Amount','Key'],[10,'A'],[20,'B']]));await expect(page.getByTestId('metric-total')).toHaveText('30');
 await uniquePanels(page);
 const panel=page.getByRole('region',{name:'Mô hình dữ liệu',exact:true});
 await panel.getByRole('button',{name:'Mở Data Model'}).click();
 await panel.getByLabel('Phép ghép').selectOption('union');
 await previewModel(panel,'2 dòng · 2 cột kết quả');
 await panel.getByRole('button',{name:'Tạo bảng kết quả'}).click();
 await expect(page.getByTestId('filtered-count')).toHaveText('2');
 await expect(page.getByTestId('metric-total')).toHaveText('30');
});
