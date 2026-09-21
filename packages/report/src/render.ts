import { el, esc } from './html.js';
import { SCRIPT } from './script.js';
import { attributionFigure, mentionsFigure, shareFigure, speakersFigure, statTiles } from './sections.js';
import { STYLES } from './styles.js';
import { renderTextureDefs } from './texture.js';
import type { ReportData } from './types.js';

/** Self-contained HTML report for one edition's structure-pass results. */
export function renderReport(data: ReportData): string {
  const parsed = data.chapters.filter((c) => c.parsed);
  const body = parsed.length === 0 ? emptyState() : charts(data);
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(data.bookTitle)} · 结构化报告</title>
<style>${STYLES}</style>
</head>
<body>
${renderTextureDefs()}
${header(data)}
${statTiles(data)}
${body}
<footer>NovelStruct 结构遍报告 · 版本 ${esc(data.editionId)} · 生成于 ${esc(formatTime(data.generatedAt))}</footer>
<div id="tip" hidden><p class="tip-title"></p><ul></ul></div>
<script>${SCRIPT}</script>
</body>
</html>
`;
}

function header(data: ReportData): string {
  const meta = [data.author, `版本 ${data.editionLabel}`].filter((v): v is string => v !== null).join(' · ');
  return el(
    'header',
    { class: 'head' },
    el('div', {}, el('h1', {}, esc(data.bookTitle)), el('p', { class: 'meta' }, esc(meta))),
    el(
      'div',
      { class: 'controls' },
      el(
        'label',
        {},
        '主题',
        el(
          'select',
          { id: 'theme' },
          el('option', { value: 'auto' }, '跟随系统'),
          el('option', { value: 'light' }, '浅色'),
          el('option', { value: 'dark' }, '深色'),
        ),
      ),
      el('label', {}, el('input', { type: 'checkbox', id: 'texture' }), '纹理（色弱与打印）'),
    ),
  );
}

function charts(data: ReportData): string {
  return el(
    'div',
    { class: 'grid2' },
    attributionFigure(data.chapters),
    shareFigure(data.chapters),
    speakersFigure(data.characters),
    mentionsFigure(data.chapters, data.characters),
  );
}

function emptyState(): string {
  return el('div', { class: 'card empty' }, '该版本还没有解析过的章节。先运行 parse，再生成报告。');
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('zh-CN', { hour12: false });
}
