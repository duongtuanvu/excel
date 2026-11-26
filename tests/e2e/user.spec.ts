import { expect, test } from './account-fixture';

test('account profile and saved template survive reload and can be reset', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('filtered-count')).toHaveText('180');
  await page.getByRole('button', { name: 'Mở không gian cá nhân' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('Tên hiển thị').fill('Nguyễn Test');
  await page.getByLabel('Tên workspace').fill('Finance');
  await page.getByLabel('Mật độ bảng dữ liệu').selectOption('compact');
  await page.getByRole('button', { name: 'Lưu hồ sơ' }).click();
  await expect(page.getByText('Đã cập nhật hồ sơ.')).toBeVisible();
  await page.getByRole('button', { name: /Mẫu của tôi/ }).click();
  await page.getByLabel('Tên mẫu mới').fill('Báo cáo tháng');
  await page.getByRole('button', { name: 'Lưu báo cáo hiện tại' }).click();
  await expect(page.getByText('Báo cáo tháng', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Đóng', exact: true }).click();
  await page.reload();
  await expect(page.getByTestId('filtered-count')).toHaveText('180');
  await page.getByRole('button', { name: 'Mở không gian cá nhân' }).click();
  await expect(page.getByLabel('Tên hiển thị')).toHaveValue('Nguyễn Test');
  await page.getByRole('button', { name: /Mẫu của tôi/ }).click();
  await expect(page.getByText('Báo cáo tháng', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Áp dụng' }).click();
  await page.getByRole('button', { name: 'Đóng', exact: true }).click();
  await expect(page.getByTestId('filtered-count')).toHaveText('180');
  await page.getByRole('button', { name: 'Mở không gian cá nhân' }).click();
  await page.getByRole('button', { name: 'Dữ liệu & riêng tư' }).click();
  await page.getByRole('button', { name: 'Đặt lại hồ sơ và mẫu' }).click();
  await page.getByRole('button', { name: 'Xác nhận xóa' }).click();
  await expect(page.getByText('Đã đặt lại hồ sơ và mẫu.')).toBeVisible();
  await page.getByRole('button', { name: /Mẫu của tôi/ }).click();
  await expect(page.getByText('Chưa có mẫu báo cáo')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('logout returns to login and does not reopen workspace on reload', async ({page})=>{
  await page.goto('/');
  await expect(page.getByTestId('filtered-count')).toHaveText('180');
  await page.getByRole('button',{name:'Mở không gian cá nhân'}).click();
  await page.getByRole('button',{name:'Đăng xuất',exact:true}).click();
  await expect(page.getByRole('button',{name:'Tiếp tục với Google'})).toBeVisible();
  await expect(page.getByTestId('filtered-count')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button',{name:'Tiếp tục với Google'})).toBeVisible();
});
