import { el, esc } from '../html.js';

export interface StatTile {
  readonly label: string;
  readonly value: string;
  readonly sub?: string;
  /** 0..1 ratio rendered as a same-ramp meter under the value. */
  readonly meter?: number;
}

export function renderStatTiles(tiles: readonly StatTile[]): string {
  return el(
    'section',
    { class: 'kpis', 'aria-label': '概览' },
    ...tiles.map((t) =>
      el(
        'div',
        { class: 'card tile' },
        el('p', { class: 'tile-label' }, esc(t.label)),
        el('p', { class: 'tile-value' }, esc(t.value)),
        t.meter === undefined ? '' : meter(t.meter),
        t.sub === undefined ? '' : el('p', { class: 'tile-sub' }, esc(t.sub)),
      ),
    ),
  );
}

function meter(ratio: number): string {
  const pct = Math.round(Math.min(1, Math.max(0, ratio)) * 100);
  return el(
    'div',
    { class: 'meter', role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct },
    el('span', { style: `width:${pct}%` }),
  );
}
