import { expect, test } from '@playwright/test';
for (const [path, heading] of [['/privacy/', 'Chính sách quyền riêng tư'], ['/terms/', 'Điều khoản sử dụng'], ['/about/', 'Thiết kế một lần, báo cáo mọi kỳ.']]) {
  test('public page '+path+' is readable without login or JS', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4173', javaScriptEnabled: false, viewport: { width: 375, height: 812 } });
    try {
      const page = await context.newPage();
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Vào KySheet' })).toBeVisible();
    } finally { await context.close(); }
  });
}
