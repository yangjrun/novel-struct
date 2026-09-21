/** Tiny HTML/SVG string builders. Every user-derived string goes through `esc`. */

export type AttrValue = string | number | boolean | undefined;
export type Attrs = Readonly<Record<string, AttrValue>>;

export function esc(value: string | number): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function attrs(a: Attrs): string {
  return Object.entries(a)
    .flatMap(([key, value]) => {
      if (value === undefined || value === false) return [];
      if (value === true) return [` ${key}`];
      return [` ${key}="${esc(value)}"`];
    })
    .join('');
}

const VOID_ELEMENTS: ReadonlySet<string> = new Set(['input', 'br', 'hr', 'img', 'meta', 'link']);

export function el(name: string, a: Attrs = {}, ...children: readonly string[]): string {
  if (VOID_ELEMENTS.has(name)) return `<${name}${attrs(a)}>`;
  return `<${name}${attrs(a)}>${children.join('')}</${name}>`;
}

/** Round to 2 decimals so generated SVG stays small and deterministic. */
export function n(value: number): number {
  return Math.round(value * 100) / 100;
}

export function fmtInt(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

export function fmtCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs < 10_000) return fmtInt(value);
  if (abs < 1_000_000) return `${(value / 1_000).toFixed(1)}K`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

export function fmtPct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

/** Clean axis ticks from 0 up to the first tick at or above `max`. */
export function niceTicks(max: number, target = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / target;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  const step = factor * magnitude;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(n(v));
  return ticks;
}

const CJK = /[　-鿿豈-﫿＀-￯]/;

/** Conservative width estimate for label fitting: CJK glyphs one em, everything else 0.6 em. */
export function estimateTextWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const ch of text) width += CJK.test(ch) ? fontSize : fontSize * 0.6;
  return width;
}

export function truncateToWidth(text: string, fontSize: number, maxWidth: number): string {
  if (estimateTextWidth(text, fontSize) <= maxWidth) return text;
  const chars = [...text];
  let out = '';
  for (const ch of chars) {
    if (estimateTextWidth(`${out}${ch}…`, fontSize) > maxWidth) break;
    out += ch;
  }
  return `${out}…`;
}

export interface TipRow {
  readonly name: string;
  readonly value: string;
  /** CSS custom property name without the leading dashes, e.g. `series-1`. */
  readonly role: string;
}

/** Serialized tooltip payload; the page script rebuilds it with textContent, never innerHTML. */
export function tipPayload(title: string, rows: readonly TipRow[]): string {
  return JSON.stringify({ title, rows: rows.map((r) => [r.name, r.value, r.role]) });
}
