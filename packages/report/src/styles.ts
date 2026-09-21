import { PALETTE_CSS } from './palette.js';
import { textureCss } from './texture.js';

export const STYLES = `${PALETTE_CSS}
* { box-sizing: border-box; }
html { background: var(--page); color: var(--text-primary); font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
body { margin: 0 auto; max-width: 1200px; padding: 24px 20px 48px; }
h1 { font-size: 22px; font-weight: 600; margin: 0; }
.head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; }
.head .meta { color: var(--text-secondary); margin: 4px 0 0; }
.controls { display: flex; align-items: center; gap: 16px; color: var(--text-secondary); }
.controls label { display: inline-flex; align-items: center; gap: 6px; }
select { font: inherit; color: var(--text-primary); background: var(--surface-1); border: 1px solid var(--border); border-radius: 6px; padding: 4px 8px; }
.card { background: var(--surface-1); border: 1px solid var(--border); border-radius: 10px; padding: 16px 18px; }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin-bottom: 20px; }
.tile-label { margin: 0; color: var(--text-secondary); }
.tile-value { margin: 4px 0 0; font-size: 32px; font-weight: 600; line-height: 1.15; }
.tile-sub { margin: 6px 0 0; color: var(--text-muted); font-size: 13px; }
.meter { height: 6px; border-radius: 3px; background: var(--meter-track); margin-top: 10px; overflow: hidden; }
.meter span { display: block; height: 100%; background: var(--meter-fill); border-radius: 3px; }
.grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(480px, 1fr)); gap: 16px; }
figure { margin: 0; }
.fig-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.fig-title { font-weight: 600; font-size: 15px; }
.fig-sub { margin: 2px 0 0; color: var(--text-secondary); font-size: 13px; }
.toggle { font: inherit; font-size: 12px; color: var(--text-secondary); background: transparent; border: 1px solid var(--border); border-radius: 6px; padding: 3px 10px; cursor: pointer; white-space: nowrap; }
.toggle:hover, .toggle[aria-pressed="true"] { color: var(--text-primary); border-color: var(--baseline); }
.legend { list-style: none; display: flex; flex-wrap: wrap; gap: 6px 18px; padding: 0; margin: 12px 0 4px; color: var(--text-secondary); font-size: 13px; }
.legend li { display: inline-flex; align-items: center; gap: 6px; }
.legend .icon { color: var(--text-secondary); font-size: 12px; }
.swatch { display: inline-block; width: 12px; height: 12px; border-radius: 2px; }
.scale { display: flex; align-items: center; gap: 4px; margin: 12px 0 4px; color: var(--text-secondary); font-size: 13px; }
.scale .swatch { width: 18px; height: 12px; }
.chart { margin-top: 8px; }
.chart svg { display: block; width: 100%; height: auto; font-family: inherit; }
.grid { stroke: var(--grid); stroke-width: 1; }
.baseline { stroke: var(--baseline); stroke-width: 1; }
.tick { fill: var(--text-muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.row-label { fill: var(--text-secondary); font-size: 12px; }
.value { fill: var(--text-secondary); font-size: 12px; font-variant-numeric: tabular-nums; }
.direct { fill: var(--text-secondary); font-size: 11px; }
.hit-area { fill: transparent; }
.hit { outline: none; cursor: default; }
.hit:hover .seg, .hit:focus-visible .seg, .cell:hover, .cell:focus-visible { filter: brightness(1.15); }
.cell { outline: none; }
.cell:focus-visible { stroke: var(--text-primary); stroke-width: 1.5; }
.table-view { margin-top: 8px; overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--grid); white-space: nowrap; }
th { color: var(--text-secondary); font-weight: 500; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.empty { color: var(--text-secondary); text-align: center; padding: 40px 16px; }
#tip { position: fixed; z-index: 10; pointer-events: none; background: var(--surface-1); color: var(--text-primary); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; box-shadow: 0 4px 16px rgba(0,0,0,0.12); font-size: 13px; max-width: 320px; }
#tip .tip-title { font-weight: 600; margin: 0 0 4px; }
#tip ul { list-style: none; margin: 0; padding: 0; }
#tip li { display: flex; align-items: center; gap: 8px; }
#tip li .key { display: inline-block; width: 12px; height: 2px; border-radius: 1px; }
#tip li strong { font-variant-numeric: tabular-nums; }
#tip li span:last-child { color: var(--text-secondary); }
footer { margin-top: 24px; color: var(--text-muted); font-size: 12px; }
${textureCss()}
`;
