/**
 * Color roles from the data-viz reference palette (dataviz skill, references/palette.md).
 * Light and dark are both selected steps of the same hues, validated per mode with
 * scripts/validate_palette.js; see docs/06-report.md for the recorded results.
 */
const LIGHT = `
  color-scheme: light;
  --page: #f9f9f7;
  --surface-1: #fcfcfb;
  --text-primary: #0b0b0b;
  --text-secondary: #52514e;
  --text-muted: #898781;
  --grid: #e1e0d9;
  --baseline: #c3c2b7;
  --border: rgba(11, 11, 11, 0.1);
  --series-1: #2a78d6;
  --series-2: #eb6834;
  --other: #898781;
  --status-good: #0ca30c;
  --status-warning: #fab219;
  --status-serious: #ec835a;
  --heat-1: #cde2fb;
  --heat-2: #9ec5f4;
  --heat-3: #6da7ec;
  --heat-4: #3987e5;
  --heat-5: #256abf;
  --heat-6: #184f95;
  --heat-7: #0d366b;
  --meter-track: #b7d3f6;
  --meter-fill: #2a78d6;
`;

const DARK = `
  color-scheme: dark;
  --page: #0d0d0d;
  --surface-1: #1a1a19;
  --text-primary: #ffffff;
  --text-secondary: #c3c2b7;
  --text-muted: #898781;
  --grid: #2c2c2a;
  --baseline: #383835;
  --border: rgba(255, 255, 255, 0.1);
  --series-1: #3987e5;
  --series-2: #d95926;
  --other: #898781;
  --status-good: #0ca30c;
  --status-warning: #fab219;
  --status-serious: #ec835a;
  --heat-1: #0d366b;
  --heat-2: #184f95;
  --heat-3: #256abf;
  --heat-4: #3987e5;
  --heat-5: #6da7ec;
  --heat-6: #9ec5f4;
  --heat-7: #cde2fb;
  --meter-track: #184f95;
  --meter-fill: #3987e5;
`;

export const PALETTE_CSS = `
:root {${LIGHT}}
@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) {${DARK}}
}
:root[data-theme="dark"] {${DARK}}
`;

/** Categorical slots actually used, for the validator run. */
export const CATEGORICAL_LIGHT = ['#2a78d6', '#eb6834'] as const;
export const CATEGORICAL_DARK = ['#3987e5', '#d95926'] as const;
