import { renderTable } from '../figure.js';
import { el, esc, fmtInt, n, niceTicks, tipPayload, truncateToWidth } from '../html.js';
import { barPath } from '../paths.js';

export interface RankedBar {
  readonly label: string;
  readonly value: number;
  /** Defaults to series-1; the folded "Other" row uses the de-emphasis role. */
  readonly role?: string;
}

export interface RankedBarsOptions {
  readonly bars: readonly RankedBar[];
  readonly rowHeader: string;
  readonly valueHeader: string;
}

const WIDTH = 880;
const ROW = 26;
const BAR = 14;
const LABEL_COL = 128;
const VALUE_SPACE = 64;
const TOP = 8;
const BOTTOM = 8;
const RADIUS = 4;
const LABEL_FONT = 12;

/** Horizontal single-series bars, ranked as given. One hue, no legend, value at the tip. */
export function renderRankedBars(opts: RankedBarsOptions): { svg: string; table: string } {
  const { bars } = opts;
  const plotWidth = WIDTH - LABEL_COL - VALUE_SPACE;
  const ticks = niceTicks(Math.max(...bars.map((b) => b.value), 0));
  const top = ticks[ticks.length - 1] ?? 1;
  const height = TOP + bars.length * ROW + BOTTOM;
  const xOf = (value: number): number => LABEL_COL + (value / top) * plotWidth;

  const grid = ticks
    .filter((t) => t > 0)
    .map((t) => el('line', { class: 'grid', x1: n(xOf(t)), x2: n(xOf(t)), y1: TOP, y2: height - BOTTOM }));

  const marks = bars.map((bar, i) => {
    const y = TOP + i * ROW;
    const barTop = y + (ROW - BAR) / 2;
    const width = xOf(bar.value) - LABEL_COL;
    const role = bar.role ?? 'series-1';
    return el(
      'g',
      {
        class: 'hit',
        tabindex: 0,
        'data-tip': tipPayload(bar.label, [{ name: opts.valueHeader, value: fmtInt(bar.value), role }]),
      },
      el('rect', { class: 'hit-area', x: 0, y, width: WIDTH, height: ROW }),
      el(
        'text',
        { class: 'row-label', x: LABEL_COL - 8, y: y + ROW / 2 + 4, 'text-anchor': 'end' },
        esc(truncateToWidth(bar.label, LABEL_FONT, LABEL_COL - 16)),
      ),
      width > 0
        ? el('path', {
            class: 'seg',
            'data-role': role,
            d: barPath(LABEL_COL, barTop, width, BAR, RADIUS),
            style: `fill:var(--${role})`,
          })
        : '',
      el('text', { class: 'value', x: n(LABEL_COL + width + 6), y: y + ROW / 2 + 4 }, fmtInt(bar.value)),
    );
  });

  const svg = el(
    'svg',
    { viewBox: `0 0 ${WIDTH} ${height}`, role: 'group', 'aria-label': `${opts.rowHeader}${opts.valueHeader}条形图` },
    ...grid,
    el('line', { class: 'baseline', x1: LABEL_COL, x2: LABEL_COL, y1: TOP, y2: height - BOTTOM }),
    ...marks,
  );
  const table = renderTable(
    [opts.rowHeader, opts.valueHeader],
    bars.map((b) => [b.label, fmtInt(b.value)]),
  );
  return { svg, table };
}
