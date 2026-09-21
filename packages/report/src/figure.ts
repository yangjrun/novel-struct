import { el, esc } from './html.js';

export interface LegendItem {
  readonly name: string;
  readonly role: string;
  /** Status series carry an icon so meaning never rides on color alone. */
  readonly icon?: string;
}

export function renderLegend(items: readonly LegendItem[]): string {
  return el(
    'ul',
    { class: 'legend' },
    ...items.map((item) =>
      el(
        'li',
        {},
        el('span', { class: 'swatch', 'data-role': item.role, style: `background:var(--${item.role})` }),
        item.icon === undefined ? '' : el('span', { class: 'icon' }, esc(item.icon)),
        esc(item.name),
      ),
    ),
  );
}

export interface FigureParts {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly legend?: string;
  readonly svg: string;
  readonly table: string;
}

/** Chart card: title, optional legend, the SVG, and its hidden table twin behind a toggle. */
export function renderFigure(f: FigureParts): string {
  return el(
    'figure',
    { class: 'card', id: f.id },
    el(
      'div',
      { class: 'fig-head' },
      el(
        'div',
        {},
        el('figcaption', { class: 'fig-title' }, esc(f.title)),
        f.subtitle === undefined ? '' : el('p', { class: 'fig-sub' }, esc(f.subtitle)),
      ),
      el('button', { type: 'button', class: 'toggle', 'data-toggle-table': true, 'aria-pressed': 'false' }, '表格视图'),
    ),
    f.legend ?? '',
    el('div', { class: 'chart' }, f.svg),
    el('div', { class: 'table-view', hidden: true }, f.table),
  );
}

export function renderTable(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  return el(
    'table',
    {},
    el(
      'thead',
      {},
      el('tr', {}, ...headers.map((h, i) => el('th', { scope: 'col', class: i === 0 ? '' : 'num' }, esc(h)))),
    ),
    el(
      'tbody',
      {},
      ...rows.map((row) =>
        el(
          'tr',
          {},
          ...row.map((cell, i) =>
            i === 0 ? el('th', { scope: 'row' }, esc(cell)) : el('td', { class: 'num' }, esc(cell)),
          ),
        ),
      ),
    ),
  );
}
