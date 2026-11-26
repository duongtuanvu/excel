import {expect,test} from './account-fixture';
import * as XLSX from 'xlsx';
function file(name:string,rows:(string|number)[][]){
 const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),'Sales');
 return {name,mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:XLSX.write(wb,{type:'buffer',bookType:'xlsx'})};
}
test('batch preflight prevents partial refresh and valid batch preserves all reports',async({page})=>{
 await page.goto('/');
 await expect(page.getByTestId('filtered-count')).toHaveText('180');
 const upload=page.getByLabel('Chọn dữ liệu Excel',{exact:true});
 await upload.setInputFiles(file('a.xlsx',[['Region','Amount'],['A',10]]));
 await expect(page.getByTestId('metric-total')).toHaveText('10');
 await page.getByLabel('Tên báo cáo').fill('Report A');
 await upload.setInputFiles(file('b.xlsx',[['Region','Amount'],['B',20]]));
 await expect(page.getByTestId('metric-total')).toHaveText('20');
 await page.getByLabel('Tên báo cáo').fill('Report B');
 const panel=page.getByRole('region',{name:'Cập nhật hàng loạt',exact:true});
 await panel.getByRole('button',{name:'Mở Batch Refresh'}).click();
 await panel.getByLabel('File batch a.xlsx · Sales',{exact:true}).setInputFiles(file('a-new.xlsx',[['Amount','Region'],[100,'A']]));
 await panel.getByLabel('File batch b.xlsx · Sales',{exact:true}).setInputFiles(file('bad.xlsx',[['Wrong'],['X']]));
 await panel.getByRole('button',{name:'Kiểm tra hàng loạt'}).click();
 await expect(panel.getByText(/SOURCE_SCHEMA_MISMATCH/)).toBeVisible();
 await expect(panel.getByRole('button',{name:'Áp dụng hàng loạt'})).toBeDisabled();
 await expect(page.getByTestId('metric-total')).toHaveText('20');
 await page.getByRole('button',{name:'Mở nguồn a.xlsx · Sales',exact:true}).click();
 await expect(page.getByTestId('metric-total')).toHaveText('10');
 await panel.getByLabel('File batch b.xlsx · Sales',{exact:true}).setInputFiles(file('b-new.xlsx',[['Region','Amount'],['B',200]]));
 await panel.getByRole('button',{name:'Kiểm tra hàng loạt'}).click();
 await expect(panel.getByText('Tất cả 2 nguồn hợp lệ. Chưa thay đổi dữ liệu.',{exact:true})).toBeVisible();
 await expect(page.getByTestId('metric-total')).toHaveText('10');
 await panel.getByRole('button',{name:'Áp dụng hàng loạt'}).click();
 await expect(page.getByText('Đã cập nhật đồng thời 2 nguồn.',{exact:true})).toBeVisible();
 await expect(page.getByTestId('metric-total')).toHaveText('100');
 await expect(page.getByLabel('Tên báo cáo')).toHaveValue('Report A');
 await page.getByRole('button',{name:'Mở nguồn b.xlsx · Sales',exact:true}).click();
 await expect(page.getByTestId('metric-total')).toHaveText('200');
 await expect(page.getByLabel('Tên báo cáo')).toHaveValue('Report B');
});
