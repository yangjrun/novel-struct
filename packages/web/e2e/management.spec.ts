import type { Page } from '@playwright/test';
import type { ApiSuccess, JobDto } from '@novelstruct/api/contracts';
import { expect, test } from './fixtures.js';

const NOVEL = [
  '第一章 相逢',
  '楚光走进院子，看见小柒坐在门口。',
  '“你好。”楚光说。',
  '“我们明天出发。”小柒说。',
  '',
  '第二章 出发',
  '第二天，楚光收起地图，向着远处的山峰走去。',
  '“出发吧。”楚光说。',
].join('\n\n');

async function importNovel(page: Page, title: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('TXT 或 EPUB 文件').setInputFiles({
    name: `${title}.txt`,
    mimeType: 'text/plain',
    buffer: Buffer.from(NOVEL),
  });
  await page.getByRole('button', { name: '导入', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
}

test('imports, finishes a fast offline job, reads chapters and saves a voice', async ({
  page,
  request,
  baseURL,
}, testInfo) => {
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  await importNovel(page, '离线流程回归');
  const editionPath = new URL(page.url()).pathname;
  // Make the very first jobs reload observe a terminal job, without replacing the real parser or database.
  await page.route('**/api/editions/*/parse', async (route) => {
    const accepted = await route.fetch();
    const envelope = (await accepted.json()) as ApiSuccess<JobDto>;
    await expect
      .poll(async () => {
        const result = await request.get(`${baseURL}/api/jobs/${envelope.data.id}`);
        return ((await result.json()) as ApiSuccess<JobDto>).data.status;
      })
      .toBe('succeeded');
    await route.fulfill({ response: accepted });
  });
  await expect(page.getByRole('combobox', { name: /归属器/ })).toHaveValue('heuristic');
  await page.getByRole('button', { name: '开始解析', exact: true }).click();
  const chapterRow = page.getByRole('row').filter({ has: page.getByRole('link', { name: '相逢', exact: true }) });
  await expect(chapterRow).toContainText('成功');
  await page.getByRole('link', { name: '相逢', exact: true }).click();
  await expect(page.getByRole('heading', { name: '第一章 相逢' })).toBeVisible();
  const chapterPath = new URL(page.url()).pathname;
  let chapterRequests = 0;
  page.on('request', (req) => {
    if (new URL(req.url()).pathname === `/api${chapterPath}`) chapterRequests += 1;
  });
  await page.locator('.speech').first().click();
  await expect(page).toHaveURL(/offset=\d+/);
  await expect(page.locator('#source-target')).toBeVisible();
  expect(chapterRequests).toBe(0);
  await page.getByRole('link', { name: '下一章 →' }).click();
  await expect(page.getByRole('heading', { name: '第二章 出发' })).toBeVisible();
  await page.getByRole('link', { name: '版本', exact: true }).click();

  const details: string[] = [];
  page.on('request', (req) => {
    if (new URL(req.url()).pathname === `/api${editionPath}`) details.push(req.url());
  });
  await page.getByRole('link', { name: '实体', exact: true }).click();
  const character = page.getByRole('row').filter({ has: page.getByText('楚光', { exact: true }) });
  await character.getByRole('button', { name: '配置声音' }).click();
  await character.getByLabel('声音服务').fill('offline-test');
  await character.getByLabel('voice ID').fill('narrator-1');
  await character.getByRole('button', { name: '保存', exact: true }).click();
  await expect(character.getByRole('button', { name: 'offline-test / narrator-1' })).toBeVisible();
  expect(details).toHaveLength(1);
  expect(browserErrors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('management.png'), fullPage: true });
});

test('clears the old chapter on slow or failed navigation', async ({ page }) => {
  await importNovel(page, '切章状态回归');
  await page.getByRole('link', { name: '相逢', exact: true }).click();
  await expect(page.getByRole('heading', { name: '第一章 相逢' })).toBeVisible();

  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/editions/*/chapters/1', async (route) => {
    await pending;
    await route.fulfill({ status: 503, json: { success: false, data: null, error: '模拟章节加载失败' } });
  });
  try {
    await page.getByRole('link', { name: '下一章 →' }).click();
    await expect(page).toHaveURL(/\/chapters\/1$/);
    await expect(page.getByRole('heading', { name: '第一章 相逢' })).toHaveCount(0);
  } finally {
    release();
  }
  await expect(page.getByText('模拟章节加载失败', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '第一章 相逢' })).toHaveCount(0);
});
