import { renderTable } from '../figure.js';
import { el, esc, estimateTextWidth, fmtInt, n, tipPayload, truncateToWidth } from '../html.js';

export interface HeatRow {
  readonly label: string;
  readonly values: readonly number[];
}

export interface HeatmapOptions {
  readonly rows: readonly HeatRow[];
  readonly columns: readonly { readonly label: string; readonly tipTitle: string }[];
  readonly rowHeader: string;
  readonly valueName: string;
}

const WIDTH = 880;
const LABEL_COL = 128;
const RIGHT = 8;
const CELL_H = 24;
const TOP = 8;
const AXIS_BAND = 26;
const INSET = 1;
const STEPS = 7;
const LABEL_FONT = 11;

/** Sequential single-hue heatmap; zero cells stay one step off the surface, every cell is a hit target. */
export function renderHeatmap(opts: HeatmapOptions): { svg: string; table: string; scale: string } {
  const { rows, columns } = opts;
  const cellW = (WIDTH - LABEL_COL - RIGHT) / Math.max(columns.length, 1);
  const max = Math.max(0, ...rows.flatMap((r) => r.values));
  const stepOf = (value: number): number => (value <= 0 ? 0 : Math.max(1, Math.ceil((value / max) * STEPS)));
  const height = TOP + rows.length * CELL_H + AXIS_BAND;

  const cells = rows.flatMap((row, r) =>
    columns.map((col, c) => {
      const value = row.values[c] ?? 0;
      const step = stepOf(value);
      return el('rect', {
        class: 'cell',
        tabindex: 0,
        x: n(LABEL_COL + c * cellW + INSET),
        y: TOP + r * CELL_H + INSET,
        width: n(cellW - 2 * INSET),
        height: CELL_H - 2 * INSET,
        rx: 2,
        style: step === 0 ? 'fill:var(--grid)' : `fill:var(--heat-${step})`,
        'data-tip': tipPayload(`${row.label} · ${col.tipTitle}`, [
          { name: opts.valueName, value: fmtInt(value), role: step === 0 ? 'grid' : `heat-${step}` },
        ]),
      });
    }),
  );

  const rowLabels = rows.map((row, r) =>
    el(
      'text',
      { class: 'row-label', x: LABEL_COL - 8, y: TOP + r * CELL_H + CELL_H / 2 + 4, 'text-anchor': 'end' },
      esc(truncateToWidth(row.label, 12, LABEL_COL - 16)),
    ),
  );

  const stride = Math.max(
    1,
    Math.ceil((Math.max(...columns.map((c) => estimateTextWidth(c.label, LABEL_FONT)), 0) + 8) / cellW),
  );
  const colLabels = columns.flatMap((col, c) =>
    c % stride === 0
      ? [
          el(
            'text',
            {
              class: 'tick',
              x: n(LABEL_COL + c * cellW + cellW / 2),
              y: TOP + rows.length * CELL_H + 18,
              'text-anchor': 'middle',
            },
            esc(col.label),
          ),
        ]
      : [],
  );

  const svg = el(
    'svg',
    { viewBox: `0 0 ${WIDTH} ${height}`, role: 'group', 'aria-label': `${opts.rowHeader}${opts.valueName}热力图` },
    ...cells,
    ...rowLabels,
    ...colLabels,
  );

  const scale = el(
    'div',
    { class: 'scale' },
    el('span', {}, '少'),
    ...Array.from({ length: STEPS }, (_, i) =>
      el('span', { class: 'swatch', style: `background:var(--heat-${i + 1})` }),
    ),
    el('span', {}, `多（最高 ${fmtInt(max)}）`),
  );

  const table = renderTable(
    [opts.rowHeader, ...columns.map((c) => c.label)],
    rows.map((row) => [row.label, ...columns.map((_, c) => fmtInt(row.values[c] ?? 0))]),
  );
  return { svg, table, scale };
}
