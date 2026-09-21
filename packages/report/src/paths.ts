import { n } from './html.js';

/** Column with 4px-rounded top corners and a square base on the baseline. */
export function columnPath(x: number, top: number, width: number, height: number, radius: number): string {
  const r = Math.min(radius, height / 2, width / 2);
  const [x0, x1, y0, y1] = [n(x), n(x + width), n(top), n(top + height)];
  return `M${x0},${n(top + r)} A${n(r)},${n(r)} 0 0 1 ${n(x + r)},${y0} H${n(x + width - r)} A${n(r)},${n(r)} 0 0 1 ${x1},${n(top + r)} V${y1} H${x0} Z`;
}

/** Horizontal bar with a rounded data end on the right and a square start on the baseline. */
export function barPath(x: number, top: number, width: number, height: number, radius: number): string {
  const r = Math.min(radius, height / 2, width / 2);
  const [x0, x1, y0, y1] = [n(x), n(x + width), n(top), n(top + height)];
  return `M${x0},${y0} H${n(x + width - r)} A${n(r)},${n(r)} 0 0 1 ${x1},${n(top + r)} V${n(top + height - r)} A${n(r)},${n(r)} 0 0 1 ${n(x + width - r)},${y1} H${x0} Z`;
}
