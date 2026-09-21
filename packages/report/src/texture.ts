/**
 * Texture: the backup identity channel for categorical and status marks. One directional line
 * fill, 45° or its 135° mirror, inked tone-on-tone. Off by default; on for print, forced-colors,
 * or the viewer's toggle. Sequential marks (the heatmap) keep their lightness ramp instead.
 */
import { el } from './html.js';

export interface TexturedRole {
  readonly role: string;
  readonly angle: 45 | 135;
}

export const TEXTURED_ROLES: readonly TexturedRole[] = [
  { role: 'series-1', angle: 45 },
  { role: 'series-2', angle: 135 },
  { role: 'other', angle: 45 },
  { role: 'status-good', angle: 45 },
  { role: 'status-warning', angle: 135 },
  { role: 'status-serious', angle: 45 },
];

const PERIOD = 6;
const STROKE = 2;
const WASH_OPACITY = 0.28;

/** Hidden SVG holding one pattern per role, referenced as url(#tex-<role>). */
export function renderTextureDefs(): string {
  return el(
    'svg',
    { width: 0, height: 0, style: 'position:absolute', 'aria-hidden': 'true', focusable: 'false' },
    el(
      'defs',
      {},
      ...TEXTURED_ROLES.map((t) =>
        el(
          'pattern',
          {
            id: `tex-${t.role}`,
            patternUnits: 'userSpaceOnUse',
            width: PERIOD,
            height: PERIOD,
            patternTransform: `rotate(${t.angle})`,
          },
          el('rect', { width: PERIOD, height: PERIOD, style: `fill:var(--${t.role});opacity:${WASH_OPACITY}` }),
          el('line', { x1: 0, y1: 0, x2: 0, y2: PERIOD, style: `stroke:var(--${t.role});stroke-width:${STROKE}` }),
        ),
      ),
    ),
  );
}

/** CSS that swaps solid fills for the patterns under the `.textured` root class, print and forced-colors. */
export function textureCss(): string {
  const rules = TEXTURED_ROLES.map(
    (t) =>
      `[data-role="${t.role}"].seg { fill: url(#tex-${t.role}) !important; }\n` +
      `.swatch[data-role="${t.role}"] { background: repeating-linear-gradient(${t.angle}deg, var(--${t.role}) 0 ${STROKE}px, color-mix(in srgb, var(--${t.role}) ${Math.round(WASH_OPACITY * 100)}%, transparent) ${STROKE}px ${PERIOD}px) !important; }`,
  ).join('\n');
  return `:root.textured ${rules.replaceAll('\n', '\n:root.textured ')}\n@media print, (forced-colors: active) {\n${rules}\n}`;
}
