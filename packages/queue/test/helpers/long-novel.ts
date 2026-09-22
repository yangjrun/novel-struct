/**
 * A synthetic TXT with enough chapters that a heuristic parse takes noticeably longer than the
 * polling interval in the tests, so cancellation and shutdown can be observed mid-run.
 */
const CHINESE_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'] as const;

export function longNovel(chapterCount: number): Uint8Array {
  const chapters = Array.from({ length: chapterCount }, (_, i) => chapterText(i + 1));
  return new TextEncoder().encode(`楔子\n\n　　云来镇的雨下了整整七天。\n\n${chapters.join('\n\n')}\n`);
}

function chapterText(number: number): string {
  return [
    `第${chineseNumber(number)}章 第${number}天`,
    '',
    '　　沈青崖推开铁匠铺的门，雨水顺着斗笠边沿滴成一条线。',
    '　　“铁老，剑修好了吗？”他问。',
    '　　铁老没有抬头，慢悠悠地说道：“修是修好了，可这剑再断就真的没救了。”',
    '　　“青崖哥！”顾小满喘着气，“镇北的石桥塌了！”',
    '　　沈青崖抓起断水剑，转身就走。',
  ].join('\n');
}

function chineseNumber(n: number): string {
  if (n < 10) return CHINESE_DIGITS[n] ?? String(n);
  if (n < 20) return `十${n % 10 === 0 ? '' : CHINESE_DIGITS[n % 10]}`;
  if (n < 100) {
    const tens = CHINESE_DIGITS[Math.floor(n / 10)];
    const ones = n % 10 === 0 ? '' : CHINESE_DIGITS[n % 10];
    return `${tens}十${ones}`;
  }
  return String(n);
}
