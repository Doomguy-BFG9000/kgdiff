/**
 * Shadow-DOM styles. Colors, fonts and motion come from the scene `Theme` as CSS custom
 * properties (`themeVariables`), so the chrome always matches the canvas; the static sheet
 * only references `var(--kg-…)`. Spacing follows a 4 / 8 px grid; borders are hairlines.
 */
import type { ChangeFamily, Theme } from '@kgdiff/scene';

export const FAMILIES: readonly ChangeFamily[] = [
  'added',
  'removed',
  'content',
  'structure',
  'identity',
];

/** CSS custom properties for `theme` (a `:host` rule body). */
export function themeVariables(theme: Theme): string {
  const dark = theme.name === 'dark';
  const vars: Record<string, string> = {
    'color-scheme': dark ? 'dark' : 'light',
    '--kg-bg': theme.canvas.background,
    '--kg-grid': theme.canvas.grid,
    '--kg-panel': theme.surface.panel,
    '--kg-raised': theme.surface.raised,
    '--kg-overlay': theme.surface.overlay,
    '--kg-border': theme.surface.border,
    '--kg-border-strong': theme.surface.borderStrong,
    '--kg-control-border': theme.surface.controlBorder,
    '--kg-shadow': theme.surface.shadow,
    '--kg-text': theme.text.primary,
    '--kg-text-2': theme.text.secondary,
    '--kg-text-3': theme.text.muted,
    '--kg-accent': theme.accent.base,
    '--kg-accent-strong': theme.accent.strong,
    '--kg-accent-soft': theme.accent.soft,
    '--kg-accent-text': theme.accent.text,
    '--kg-neutral': theme.neutral.node,
    '--kg-neutral-stroke': theme.neutral.nodeStroke,
    '--kg-neutral-edge': theme.neutral.edge,
    '--kg-font': theme.font.family,
    '--kg-mono': theme.font.mono,
    '--kg-fast': `${theme.motion.fast}ms`,
    '--kg-base': `${theme.motion.base}ms`,
    '--kg-slow': `${theme.motion.slow}ms`,
    '--kg-ease': `cubic-bezier(${theme.motion.easing.join(', ')})`,
    // Derived interaction tints (not color-coded: hover / press / inputs / scrims).
    '--kg-hover': dark ? 'rgba(255,255,255,0.045)' : 'rgba(15,23,42,0.04)',
    '--kg-press': dark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.07)',
    '--kg-input': dark ? theme.surface.raised : '#F3F5F8',
    '--kg-selected': dark ? theme.surface.raised : '#F5F7FB',
    '--kg-scrim': dark ? 'rgba(5,7,11,0.56)' : 'rgba(15,23,42,0.18)',
    '--kg-skeleton': dark ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.05)',
    '--kg-skeleton-hi': dark ? 'rgba(255,255,255,0.09)' : 'rgba(15,23,42,0.09)',
    '--kg-track': dark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)',
    '--kg-kbd': dark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.05)',
  };
  for (const f of FAMILIES) {
    const c = theme.family[f];
    vars[`--kg-${f}`] = c.base;
    vars[`--kg-${f}-strong`] = c.strong;
    vars[`--kg-${f}-soft`] = c.soft;
    vars[`--kg-${f}-text`] = c.text;
  }
  return Object.entries(vars)
    .map(([k, v]) => `${k}: ${v};`)
    .join(' ');
}

const familyRules = [...FAMILIES, 'neutral' as const]
  .map((f) =>
    f === 'neutral'
      ? `[data-family="neutral"] { --fam-base: var(--kg-neutral); --fam-soft: var(--kg-hover); --fam-text: var(--kg-text-2); }`
      : `[data-family="${f}"] { --fam-base: var(--kg-${f}); --fam-soft: var(--kg-${f}-soft); --fam-text: var(--kg-${f}-text); }`,
  )
  .join('\n');

export const STYLES = /* css */ `
:host {
  all: initial;
  display: block;
  position: relative;
  height: 100%;
  min-height: 420px;
  contain: content;
  font-family: var(--kg-font);
  font-size: 13px;
  line-height: 1.45;
  color: var(--kg-text);
  background: var(--kg-bg);
  -webkit-font-smoothing: antialiased;
}
:host([hidden]) { display: none; }
*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }
button, input { font: inherit; color: inherit; letter-spacing: inherit; }
button {
  margin: 0; padding: 0; border: 0; background: none; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
button:disabled { cursor: default; opacity: 0.4; }
:focus { outline: none; }
:focus-visible { outline: 2px solid var(--kg-accent); outline-offset: 2px; }
.icon { width: 16px; height: 16px; flex: none; display: block; }
.sr-only {
  position: absolute !important; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
kbd {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 20px; height: 20px; padding: 0 5px; border-radius: 5px;
  font: 500 11px/1 var(--kg-mono); color: var(--kg-text-2);
  background: var(--kg-kbd); box-shadow: inset 0 0 0 1px var(--kg-border), inset 0 -1px 0 var(--kg-border);
}
.scroll { overflow: auto; scrollbar-width: thin; scrollbar-color: var(--kg-border-strong) transparent; }

/* ── Root layout ─────────────────────────────────────────────────────────── */
.root {
  position: absolute; inset: 0; display: flex; flex-direction: column; overflow: hidden;
  background: var(--kg-bg);
}
.body { position: relative; flex: 1; min-height: 0; display: flex; }
.stage-wrap { position: relative; flex: 1; min-width: 0; min-height: 0; overflow: hidden; background: var(--kg-bg); }
.stage { position: absolute; inset: 0; }
.stage canvas { outline: none; }
.stage canvas:focus-visible { outline: 2px solid var(--kg-accent); outline-offset: -2px; }
.chrome { position: absolute; inset: 0; pointer-events: none; }
.chrome > * { pointer-events: auto; }

/* ── Buttons ─────────────────────────────────────────────────────────────── */
.icon-btn {
  display: inline-flex; align-items: center; justify-content: center; flex: none;
  width: 32px; height: 32px; border-radius: 8px; color: var(--kg-text-2);
  transition: background var(--kg-fast) var(--kg-ease), color var(--kg-fast) var(--kg-ease);
}
.icon-btn:hover { background: var(--kg-hover); color: var(--kg-text); }
.icon-btn:active { background: var(--kg-press); }
.icon-btn[aria-pressed="true"], .icon-btn[aria-expanded="true"] { background: var(--kg-press); color: var(--kg-text); }
.icon-btn.sm { width: 28px; height: 28px; border-radius: 7px; }
.btn {
  display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px;
  border-radius: 7px; font-size: 12px; font-weight: 500; color: var(--kg-text);
  background: var(--kg-hover); box-shadow: inset 0 0 0 1px var(--kg-border);
  transition: background var(--kg-fast) var(--kg-ease), box-shadow var(--kg-fast) var(--kg-ease);
}
.btn:hover { background: var(--kg-press); box-shadow: inset 0 0 0 1px var(--kg-border-strong); }
.link-btn { min-height: 28px; color: var(--kg-accent-text); font-weight: 500; font-size: 12px; border-radius: 4px; }
.link-btn:hover { text-decoration: underline; text-underline-offset: 3px; }

/* ── Header ──────────────────────────────────────────────────────────────── */
.header {
  position: relative; z-index: 3; flex: none; height: 52px; display: flex; align-items: center; gap: 12px;
  padding: 0 10px 0 14px; background: var(--kg-panel); border-bottom: 1px solid var(--kg-border);
}
.brand { display: flex; align-items: center; gap: 8px; flex: none; color: var(--kg-text); }
.brand-mark { width: 20px; height: 20px; display: block; }
.brand-name { font-size: 14px; font-weight: 650; letter-spacing: -0.01em; }
.header-sep { width: 1px; height: 20px; background: var(--kg-border-strong); flex: none; }
.versions { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1 1 0; font-size: 13px; overflow: hidden;
  mask-image: linear-gradient(90deg, #000 calc(100% - 16px), transparent); }
.versions .name { font-weight: 550; color: var(--kg-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.versions .arrow { color: var(--kg-text-3); flex: none; }
.versions .side { display: flex; align-items: center; gap: 6px; min-width: 0; }
.tag {
  display: inline-flex; align-items: center; height: 20px; padding: 0 6px; border-radius: 5px; flex: none;
  font: 500 11px/1 var(--kg-mono); color: var(--kg-text-2); background: var(--kg-hover);
  box-shadow: inset 0 0 0 1px var(--kg-border); white-space: nowrap; max-width: 160px; overflow: hidden; text-overflow: ellipsis;
}
.header-center { flex: none; display: flex; justify-content: center; }
/* header="compact": no brand or names (the host shows them); the names keep their space so the
   mode control stays centered. */
:host([header="compact"]) .brand, :host([header="compact"]) .header-sep { display: none; }
:host([header="compact"]) .versions { visibility: hidden; }
.header-end { display: flex; align-items: center; gap: 4px; flex: 1 0 auto; justify-content: flex-end; }
.stats { display: flex; align-items: center; gap: 4px; margin-right: 6px; }

.segmented {
  position: relative; display: inline-flex; align-items: center; gap: 2px; height: 32px; padding: 2px;
  border-radius: 9px; background: var(--kg-hover); box-shadow: inset 0 0 0 1px var(--kg-border);
}
.segmented .thumb {
  position: absolute; top: 2px; bottom: 2px; left: 0; width: 0; border-radius: 7px;
  background: var(--kg-raised); box-shadow: 0 1px 2px rgba(0,0,0,0.12), inset 0 0 0 1px var(--kg-border-strong);
  transition: transform var(--kg-base) var(--kg-ease), width var(--kg-base) var(--kg-ease);
}
.seg {
  position: relative; z-index: 1; display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px;
  border-radius: 7px; font-size: 12.5px; font-weight: 500; color: var(--kg-text-2); white-space: nowrap;
  transition: color var(--kg-fast) var(--kg-ease);
}
.seg:hover { color: var(--kg-text); }
.seg[aria-checked="true"] { color: var(--kg-text); }
.seg .icon { opacity: 0.9; }

.pill {
  display: inline-flex; align-items: center; gap: 4px; height: 28px; padding: 0 9px; border-radius: 14px;
  font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap;
  transition: box-shadow var(--kg-fast) var(--kg-ease), background var(--kg-fast) var(--kg-ease), opacity var(--kg-fast) var(--kg-ease);
}
.stat { color: var(--fam-text); background: var(--fam-soft); box-shadow: inset 0 0 0 1px transparent; }
.stat:hover { box-shadow: inset 0 0 0 1px var(--fam-base); }
.stat[aria-pressed="true"] { box-shadow: inset 0 0 0 1.5px var(--fam-base); }
.stats.filtering .stat[aria-pressed="false"] { opacity: 0.55; }
.stat .glyph { font-weight: 700; }


${familyRules}

/* ── Floating chrome ─────────────────────────────────────────────────────── */
.card {
  background: var(--kg-overlay); border-radius: 12px; box-shadow: var(--kg-shadow), 0 0 0 1px var(--kg-border);
  backdrop-filter: blur(16px) saturate(140%);
}
.float { position: absolute; }
.top-left { top: 12px; left: 12px; }
.bottom-left { bottom: 16px; left: 16px; }
.bottom-right { bottom: 16px; right: 16px; }
.chip {
  display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border-radius: 8px;
  font-size: 12px; font-weight: 600; color: var(--kg-text-2); letter-spacing: 0.01em;
}

.map-cluster { display: flex; align-items: flex-end; gap: 8px; }
.zoom-bar { display: flex; flex-direction: column; padding: 2px; gap: 2px; }
.zoom-bar .icon-btn { width: 30px; height: 30px; }
.minimap-host { position: relative; width: 184px; height: 128px; border-radius: 12px; box-shadow: 0 0 0 1px var(--kg-border); }
.minimap-host canvas { border-radius: 12px; }

.legend { padding: 6px; min-width: 0; }
.legend-head { display: flex; align-items: center; gap: 6px; height: 28px; padding: 0 6px 0 8px; font-size: 11px; font-weight: 600;
  letter-spacing: 0.06em; text-transform: uppercase; color: var(--kg-text-3); border-radius: 7px; width: 100%; }
.legend-head:hover { color: var(--kg-text-2); background: var(--kg-hover); }
.legend-head .icon { width: 14px; height: 14px; margin-left: auto; transition: transform var(--kg-base) var(--kg-ease); }
.legend[data-open="false"] .legend-head .icon { transform: rotate(180deg); }
.legend[data-open="false"] .legend-body { display: none; }
.legend[data-open="false"] { padding: 2px; }
.legend-body { display: grid; gap: 2px; padding: 2px 4px 4px; }
.legend-row { display: grid; grid-template-columns: 22px auto; align-items: center; column-gap: 8px; height: 26px; padding: 0 10px 0 4px; border-radius: 6px; cursor: default; }
.legend-row .name { font-size: 12px; font-weight: 550; color: var(--kg-text); }
.swatch { width: 22px; height: 22px; display: block; }

.caption {
  position: absolute; top: 12px; left: 50%; transform: translateX(-50%); max-width: min(560px, calc(100% - 200px));
  display: flex; align-items: center; gap: 8px; height: 32px; padding: 0 12px 0 6px; font-size: 12.5px; font-weight: 550;
  transition: opacity var(--kg-base) var(--kg-ease);
}
.caption .text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.caption .count { color: var(--kg-text-3); font-weight: 500; font-variant-numeric: tabular-nums; flex: none; }
.caption[data-empty="true"] { opacity: 0; pointer-events: none; }

.glyph-box {
  display: inline-flex; align-items: center; justify-content: center; flex: none; width: 20px; height: 20px; border-radius: 6px;
  font-size: 12px; font-weight: 700; line-height: 1; color: var(--fam-text); background: var(--fam-soft);
}

.stepper { display: inline-flex; align-items: center; gap: 8px; height: 38px; padding: 0 4px 0 12px; }
.stepper .label { font-size: 12px; font-weight: 550; color: var(--kg-text-2); }
.stepper .opts { display: inline-flex; gap: 2px; padding: 2px; border-radius: 8px; background: var(--kg-hover); }
.stepper .opt { width: 28px; height: 28px; border-radius: 6px; font-size: 12px; font-weight: 600; color: var(--kg-text-2); font-variant-numeric: tabular-nums; }
.stepper .opt:hover { color: var(--kg-text); }
.stepper .expand { display: inline-flex; align-items: center; gap: 4px; height: 28px; padding: 0 10px 0 8px; margin-left: 4px; border-radius: 7px; font-size: 12px; font-weight: 600; color: var(--kg-text-2); box-shadow: inset 0 0 0 1px var(--kg-border-strong); font-variant-numeric: tabular-nums; }
.stepper .expand:hover:not(:disabled) { color: var(--kg-text); background: var(--kg-hover); }
.stepper .expand .icon { width: 14px; height: 14px; }
.stepper .opt[aria-checked="true"] { background: var(--kg-raised); color: var(--kg-text); box-shadow: inset 0 0 0 1px var(--kg-border-strong); }

/* Swipe */
.swipe { position: absolute; inset: 0; pointer-events: none; }
.swipe .divider {
  position: absolute; top: 0; bottom: 0; left: 0; width: 24px; margin-left: -12px; cursor: ew-resize; pointer-events: auto;
  touch-action: none; display: flex; justify-content: center;
}
.swipe .divider::before { content: ''; width: 1.5px; height: 100%; background: var(--kg-accent); opacity: 0.85; box-shadow: 0 0 12px var(--kg-accent-soft); }
.swipe .handle {
  position: absolute; top: 50%; left: 50%; width: 32px; height: 32px; margin: -16px 0 0 -16px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center; gap: 0; color: var(--kg-accent-text);
  background: var(--kg-overlay); box-shadow: var(--kg-shadow), 0 0 0 1.5px var(--kg-accent);
  backdrop-filter: blur(16px);
  transition: transform var(--kg-fast) var(--kg-ease);
}
.swipe .handle .icon { width: 12px; height: 12px; }
.swipe .divider:hover .handle, .swipe .divider.dragging .handle { transform: scale(1.08); }
.swipe .divider:focus-visible { outline: none; }
.swipe .divider:focus-visible .handle { box-shadow: var(--kg-shadow), 0 0 0 2px var(--kg-accent), 0 0 0 5px var(--kg-accent-soft); }
.swipe .side-chip { position: absolute; top: 12px; pointer-events: none; }
.swipe .side-chip.before { left: 12px; }
.swipe .side-chip.after { right: 12px; }

/* Replay transport */
.transport {
  position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%); width: min(600px, calc(100% - 496px));
  min-width: 360px;
  display: flex; align-items: center; gap: 4px; height: 48px; padding: 0 8px;
}
.transport .play { width: 36px; height: 36px; border-radius: 10px; color: var(--kg-text); }
.transport .play .icon { width: 18px; height: 18px; }
.transport .pos { flex: none; min-width: 64px; text-align: center; font-size: 12px; font-weight: 550; color: var(--kg-text-2); font-variant-numeric: tabular-nums; }
.transport .speed { flex: none; height: 28px; min-width: 44px; padding: 0 8px; border-radius: 7px; font-size: 12px; font-weight: 600; color: var(--kg-text-2); font-variant-numeric: tabular-nums; box-shadow: inset 0 0 0 1px var(--kg-border); }
.transport .speed:hover { color: var(--kg-text); background: var(--kg-hover); }
.scrubber { position: relative; flex: 1; height: 36px; margin: 0 8px; cursor: pointer; touch-action: none; border-radius: 6px; }
.scrubber .track { position: absolute; left: 0; right: 0; top: 50%; height: 4px; margin-top: -2px; border-radius: 2px; background: var(--kg-track); overflow: hidden; }
.scrubber .fill { position: absolute; left: 0; top: 0; bottom: 0; width: 100%; transform-origin: left; background: var(--kg-accent); opacity: 0.85; }
.scrubber .ticks { position: absolute; left: 0; right: 0; top: 50%; height: 14px; margin-top: -7px; width: 100%; pointer-events: none; overflow: visible; }
.scrubber .knob {
  position: absolute; top: 50%; left: 0; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%;
  background: var(--kg-text); box-shadow: 0 1px 4px rgba(0,0,0,0.35), 0 0 0 3px var(--kg-accent-soft); pointer-events: none;
}
.scrubber:focus-visible { outline-offset: 0; }
.scrub-tip {
  position: absolute; bottom: 100%; margin-bottom: 10px; transform: translateX(-50%); max-width: 320px; padding: 6px 10px;
  font-size: 12px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none;
  display: flex; align-items: center; gap: 6px;
}
.finished {
  position: absolute; left: 50%; bottom: 76px; transform: translateX(-50%); display: flex; align-items: center; gap: 10px;
  height: 36px; padding: 0 6px 0 12px; font-size: 12.5px; font-weight: 550; color: var(--kg-text);
  animation: rise var(--kg-base) var(--kg-ease);
}
.finished .icon { color: var(--kg-accent-text); }
@keyframes rise { from { opacity: 0; transform: translate(-50%, 6px); } }

/* Tooltip */
.tooltip {
  position: absolute; left: 0; top: 0; z-index: 4; width: max-content; max-width: 300px; padding: 10px 12px; pointer-events: none;
  border-radius: 10px; opacity: 0; transition: opacity var(--kg-fast) var(--kg-ease);
}
.tooltip[data-open="true"] { opacity: 1; }
.tooltip .t-label { font-size: 13px; font-weight: 600; color: var(--kg-text); overflow-wrap: anywhere; }
.tooltip .t-old { font-size: 12px; color: var(--kg-text-3); text-decoration: line-through; overflow-wrap: anywhere; }
.tooltip .t-id { margin-top: 2px; font: 11px/1.4 var(--kg-mono); color: var(--kg-text-3); overflow-wrap: anywhere; }
.tooltip .t-status { margin-top: 8px; display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 550; color: var(--fam-text); }
.tooltip .t-status .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--fam-base); flex: none; }
.tooltip .t-sum { margin-top: 4px; font-size: 12px; color: var(--kg-text-2); overflow-wrap: anywhere; }
.tooltip .t-hint { margin-top: 6px; font-size: 11px; color: var(--kg-text-3); }

/* States (loading / identical / error / empty) */
.state {
  position: absolute; inset: 0; z-index: 2; display: flex; align-items: center; justify-content: center; padding: 24px;
  pointer-events: none;
}
.state > * { pointer-events: auto; }
.state.blocking { background: var(--kg-bg); }
.state-card { width: min(380px, 100%); padding: 24px; text-align: left; }
.state-card .state-icon {
  width: 36px; height: 36px; border-radius: 10px; display: flex; align-items: center; justify-content: center;
  color: var(--kg-accent-text); background: var(--kg-accent-soft); margin-bottom: 16px;
}
.state-card .state-icon .icon { width: 20px; height: 20px; }
.state-card.error .state-icon { color: var(--kg-removed-text); background: var(--kg-removed-soft); }
.state-card.ok .state-icon { color: var(--kg-added-text); background: var(--kg-added-soft); }
.state-card h2 { margin: 0; font-size: 15px; font-weight: 650; letter-spacing: -0.01em; }
.state-card p { margin: 6px 0 0; color: var(--kg-text-2); font-size: 13px; }
.state-card details { margin-top: 16px; font-size: 12px; color: var(--kg-text-2); }
.state-card summary { cursor: pointer; font-weight: 550; color: var(--kg-text-2); border-radius: 4px; width: max-content; }
.state-card pre {
  margin: 8px 0 0; max-height: 200px; padding: 10px 12px; border-radius: 8px; background: var(--kg-input);
  font: 11.5px/1.5 var(--kg-mono); white-space: pre-wrap; overflow-wrap: anywhere; color: var(--kg-text-2);
  box-shadow: inset 0 0 0 1px var(--kg-border);
}
.steps { list-style: none; margin: 16px 0 0; padding: 0; display: grid; gap: 10px; }
.steps li { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--kg-text-3); transition: color var(--kg-base) var(--kg-ease); }
.steps li[data-state="active"] { color: var(--kg-text); font-weight: 550; }
.steps li[data-state="done"] { color: var(--kg-text-2); }
.steps .mark { width: 18px; height: 18px; flex: none; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: inset 0 0 0 1.5px var(--kg-border-strong); }
.steps li[data-state="done"] .mark { background: var(--kg-accent-soft); box-shadow: none; color: var(--kg-accent-text); }
.steps li[data-state="done"] .mark .icon { width: 12px; height: 12px; }
.steps li[data-state="active"] .mark { box-shadow: inset 0 0 0 1.5px var(--kg-accent-soft); border-top: 1.5px solid var(--kg-accent); animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.skeleton-grid {
  position: absolute; inset: 0;
  background-image: radial-gradient(var(--kg-skeleton-hi) 1.2px, transparent 1.4px); background-size: 24px 24px;
  mask-image: radial-gradient(ellipse at center, #000 20%, transparent 75%);
  animation: breathe 2.4s ease-in-out infinite;
}
@keyframes breathe { 50% { opacity: 0.45; } }

/* ── Sidebar ─────────────────────────────────────────────────────────────── */
.sidebar {
  position: relative; z-index: 2; flex: none; width: 360px; display: flex; overflow: hidden;
  background: var(--kg-panel); border-left: 1px solid var(--kg-border);
  transition: width var(--kg-base) var(--kg-ease), border-color var(--kg-base) var(--kg-ease);
}
.sidebar[data-open="false"] { width: 0; border-left-color: transparent; }
.sidebar-inner { width: 360px; flex: none; display: flex; flex-direction: column; min-height: 0; }
.sheet-handle { display: none; }
.sb-head { flex: none; padding: 12px 12px 8px; display: grid; gap: 10px; border-bottom: 1px solid var(--kg-border); }
.sb-title { display: flex; align-items: center; gap: 8px; height: 24px; padding: 0 2px; }
.sb-title h2 { margin: 0; font-size: 13px; font-weight: 650; }
.count-badge {
  display: inline-flex; align-items: center; height: 18px; padding: 0 6px; border-radius: 9px; font-size: 11px; font-weight: 600;
  color: var(--kg-text-2); background: var(--kg-hover); box-shadow: inset 0 0 0 1px var(--kg-border); font-variant-numeric: tabular-nums;
}
.progress { margin-left: auto; display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: var(--kg-text-3); font-variant-numeric: tabular-nums; }
.progress .bar { width: 64px; height: 4px; border-radius: 2px; background: var(--kg-track); overflow: hidden; }
.progress .bar > div { height: 100%; width: 100%; transform-origin: left; background: var(--kg-accent); border-radius: 2px; transition: transform var(--kg-base) var(--kg-ease); }
.progress[data-complete="true"] { color: var(--kg-accent-text); }

.search { position: relative; display: flex; align-items: center; height: 32px; border-radius: 8px; background: var(--kg-input);
  box-shadow: inset 0 0 0 1px var(--kg-border); transition: box-shadow var(--kg-fast) var(--kg-ease); }
.search:focus-within { box-shadow: inset 0 0 0 1px var(--kg-accent), 0 0 0 3px var(--kg-accent-soft); }
.search > .icon { position: absolute; left: 10px; color: var(--kg-text-3); pointer-events: none; }
.search input {
  flex: 1; min-width: 0; height: 100%; padding: 0 64px 0 32px; border: 0; background: transparent; font-size: 13px; color: var(--kg-text);
}
.search input::placeholder { color: var(--kg-text-3); }
.search input::-webkit-search-cancel-button { display: none; }
.search kbd { position: absolute; right: 8px; }
.search .clear { position: absolute; right: 2px; width: 28px; height: 28px; border-radius: 6px; display: flex; align-items: center; justify-content: center; color: var(--kg-text-3); }
.search .clear:hover { color: var(--kg-text); background: var(--kg-hover); }

.filters { display: flex; flex-wrap: wrap; gap: 4px; }
.fchip {
  display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 8px 0 7px; border-radius: 14px;
  font-size: 11.5px; font-weight: 550; color: var(--kg-text-2); box-shadow: inset 0 0 0 1px var(--kg-border);
  transition: background var(--kg-fast) var(--kg-ease), box-shadow var(--kg-fast) var(--kg-ease), color var(--kg-fast) var(--kg-ease);
}
.fchip:hover { background: var(--kg-hover); color: var(--kg-text); }
.fchip .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--fam-base); flex: none; }
.fchip .n { color: var(--kg-text-3); font-variant-numeric: tabular-nums; font-weight: 500; }
.fchip[aria-pressed="true"] { background: var(--fam-soft); color: var(--fam-text); box-shadow: inset 0 0 0 1px var(--fam-base); }
.fchip[aria-pressed="true"] .n { color: var(--fam-text); opacity: 0.8; }
.fchip:disabled { opacity: 0.35; }

.list-wrap { position: relative; flex: 1 1 50%; min-height: 96px; display: flex; flex-direction: column; }
.list { position: relative; flex: 1; min-height: 0; outline: none; }
.list:focus-visible { outline: none; }
.list:focus-visible:not(:has(.row[aria-selected="true"])) { box-shadow: inset 0 0 0 2px var(--kg-accent); }
.list:focus-visible .row[aria-selected="true"] { box-shadow: inset 0 0 0 2px var(--kg-accent); }
.list-inner { position: relative; width: 100%; }
.row {
  position: absolute; left: 8px; right: 8px; height: 52px; display: flex; align-items: center; gap: 10px; padding: 0 6px 0 14px;
  border-radius: 8px; cursor: pointer; user-select: none; -webkit-user-select: none;
  transition: background var(--kg-fast) var(--kg-ease), box-shadow var(--kg-fast) var(--kg-ease);
}
.row::before { content: ''; position: absolute; left: 4px; top: 10px; bottom: 10px; width: 3px; border-radius: 2px; background: var(--fam-base); }
.row:hover { background: var(--kg-hover); }
.row[aria-selected="true"] { background: var(--kg-selected); box-shadow: inset 0 0 0 1px var(--kg-accent), 0 1px 2px rgba(0,0,0,0.06); }
.row .txt { flex: 1; min-width: 0; display: grid; gap: 1px; }
.row .title { font-size: 13px; font-weight: 500; color: var(--kg-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row .sub { font-size: 12px; color: var(--kg-text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-height: 17px; }
.row[data-reviewed="true"] .title { color: var(--kg-text-2); }
.row[data-reviewed="true"] .glyph-box { opacity: 0.7; }
.rv {
  flex: none; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.rv .ring {
  width: 18px; height: 18px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
  box-shadow: inset 0 0 0 1.5px var(--kg-control-border); color: transparent;
  transition: background var(--kg-fast) var(--kg-ease), box-shadow var(--kg-fast) var(--kg-ease), color var(--kg-fast) var(--kg-ease), transform var(--kg-fast) var(--kg-ease);
}
.rv .ring .icon { width: 12px; height: 12px; }
.rv:hover .ring { box-shadow: inset 0 0 0 1.5px var(--kg-accent); color: var(--kg-text-3); }
.rv[data-pressed="true"] .ring { background: var(--kg-accent); box-shadow: none; color: var(--kg-bg); }
.rv[data-pressed="true"]:active .ring { transform: scale(0.9); }
.group {
  position: absolute; left: 0; right: 0; height: 32px; display: flex; align-items: center; gap: 8px; padding: 10px 16px 0 22px;
  font-size: 11px; font-weight: 650; letter-spacing: 0.06em; text-transform: uppercase; color: var(--kg-text-3);
}
.group .n { font-weight: 500; letter-spacing: 0; font-variant-numeric: tabular-nums; }
.sticky {
  position: absolute; top: 0; left: 0; right: 0; z-index: 1; height: 32px; background: var(--kg-panel);
  box-shadow: 0 1px 0 var(--kg-border); pointer-events: none;
}
.sticky .group { position: static; height: 32px; padding-top: 0; }
.sticky[data-shadow="false"] { box-shadow: none; }
.list-empty { padding: 32px 24px; text-align: center; color: var(--kg-text-3); font-size: 12.5px; display: grid; gap: 10px; justify-items: center; }
.skeleton-row { height: 52px; margin: 0 8px; padding: 0 14px; display: flex; align-items: center; gap: 10px; }
.skeleton-row .b { flex: 1; max-width: 70%; height: 10px; border-radius: 5px; background: var(--kg-skeleton); }
.skeleton-row:nth-child(even) .b { max-width: 52%; }
.skeleton-row .g { width: 20px; height: 20px; border-radius: 6px; background: var(--kg-skeleton); flex: none; }
.shimmer { animation: breathe 1.6s ease-in-out infinite; }

.results { padding: 4px 0 8px; }
.results-head { padding: 8px 16px 6px; font-size: 11px; font-weight: 650; letter-spacing: 0.06em; text-transform: uppercase; color: var(--kg-text-3); }
.result {
  display: flex; align-items: center; gap: 10px; width: calc(100% - 16px); margin: 0 8px; height: 44px; padding: 0 10px; border-radius: 8px;
  text-align: left;
}
.result:hover, .result[aria-selected="true"] { background: var(--kg-hover); }
.result[aria-selected="true"] { box-shadow: inset 0 0 0 1px var(--kg-border-strong); }
.result .sdot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: var(--fam-base); }
.result[data-family="neutral"] .sdot { background: transparent; box-shadow: inset 0 0 0 1.5px var(--kg-neutral-stroke); }
.result .txt { flex: 1; min-width: 0; display: grid; }
.result .title { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.result .sub { font: 11px/1.4 var(--kg-mono); color: var(--kg-text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.result mark { background: var(--kg-accent-soft); color: inherit; border-radius: 3px; padding: 0 1px; }
.result .status { font-size: 11.5px; color: var(--fam-text); flex: none; }

/* ── Detail panel ────────────────────────────────────────────────────────── */
.detail { flex: 0 1 auto; max-height: 58%; min-height: 0; display: flex; flex-direction: column; border-top: 1px solid var(--kg-border); background: var(--kg-panel); }
.detail[data-empty="true"] { flex: none; }
.detail-empty { padding: 16px; display: flex; align-items: center; gap: 12px; color: var(--kg-text-3); font-size: 12.5px; }
.detail-empty .icon { color: var(--kg-text-3); }
.detail-empty .sub { font-size: 11.5px; margin-top: 2px; }
.detail-scroll { flex: 1; min-height: 0; padding: 14px 16px 20px; }
.d-top { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; }
.fam-pill { display: inline-flex; align-items: center; gap: 6px; height: 22px; padding: 0 8px 0 6px; border-radius: 6px; font-size: 11.5px; font-weight: 600; color: var(--fam-text); background: var(--fam-soft); }
.fam-pill .g { font-weight: 700; }
.d-nav { margin-left: auto; display: flex; align-items: center; gap: 2px; }
.d-title { margin: 0; font-size: 14.5px; line-height: 1.4; font-weight: 600; letter-spacing: -0.005em; overflow-wrap: anywhere; }
.d-sub { margin-top: 4px; font-size: 12.5px; color: var(--kg-text-2); overflow-wrap: anywhere; }
.rv-btn { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px 0 6px; border-radius: 7px; font-size: 12px; font-weight: 550; color: var(--kg-text-2); box-shadow: inset 0 0 0 1px var(--kg-border); margin-right: 4px; }
.rv-btn:hover { color: var(--kg-text); background: var(--kg-hover); }
.rv-btn .ring { width: 16px; height: 16px; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: inset 0 0 0 1.5px var(--kg-control-border); color: transparent; }
.rv-btn .ring .icon { width: 11px; height: 11px; }
.rv-btn[aria-pressed="true"] { color: var(--kg-accent-text); box-shadow: inset 0 0 0 1px var(--kg-accent); background: var(--kg-accent-soft); }
.rv-btn[aria-pressed="true"] .ring { background: var(--kg-accent); box-shadow: none; color: var(--kg-bg); }
.section { margin-top: 18px; }
.section > h3 { margin: 0 0 8px; font-size: 11px; font-weight: 650; letter-spacing: 0.06em; text-transform: uppercase; color: var(--kg-text-3); display: flex; align-items: center; gap: 6px; }
.section > h3 .n { font-weight: 500; letter-spacing: 0; }
.kv { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 6px 12px; font-size: 12.5px; align-items: baseline; }
.kv dt { color: var(--kg-text-3); }
.kv dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.id-text { font: 12px/1.5 var(--kg-mono); color: var(--kg-text); overflow-wrap: anywhere; }
.chips { display: flex; flex-wrap: wrap; gap: 4px; }
.vchip { display: inline-flex; align-items: center; gap: 4px; min-height: 22px; padding: 2px 8px; border-radius: 6px; font-size: 12px; background: var(--kg-hover); box-shadow: inset 0 0 0 1px var(--kg-border); overflow-wrap: anywhere; }
.vchip.add { color: var(--kg-added-text); background: var(--kg-added-soft); box-shadow: none; }
.vchip.del { color: var(--kg-removed-text); background: var(--kg-removed-soft); box-shadow: none; text-decoration: line-through; text-decoration-thickness: 1px; }
.vchip .sign { font-weight: 700; text-decoration: none; display: inline-block; }
.pair { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 6px; }
.pair .b, .line.old { color: var(--kg-text-2); }
.pair .arr { color: var(--kg-text-3); }
.line { display: grid; grid-template-columns: 10px minmax(0, 1fr); gap: 6px; align-items: baseline; }
.line .sign { font: 600 12px/1 var(--kg-mono); text-align: center; }
.line.old .sign { color: var(--kg-removed-text); }
.line.new .sign { color: var(--kg-added-text); }
del.hl { text-decoration: line-through; text-decoration-color: var(--kg-removed); background: var(--kg-removed-soft); color: var(--kg-removed-text); border-radius: 3px; padding: 0 1px; }
ins.hl { text-decoration: none; background: var(--kg-added-soft); color: var(--kg-added-text); border-radius: 3px; padding: 0 1px; }
.attrs { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 12.5px; table-layout: fixed; }
.attrs td { vertical-align: baseline; padding: 6px 8px 6px 0; border-top: 1px solid var(--kg-border); overflow-wrap: anywhere; }
.attrs tr:first-child td { border-top: 0; padding-top: 0; }
.attrs td > * + * { margin-top: 4px; }
.attrs td.k { color: var(--kg-text-2); }
.attrs col.k { width: 28%; }
.val { white-space: pre-wrap; }
.val.clamped { display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.more { margin-top: 2px; }
.disclosure { display: inline-flex; align-items: center; gap: 4px; min-height: 28px; margin-top: 4px; font-size: 12px; color: var(--kg-text-2); border-radius: 4px; }
.disclosure:hover { color: var(--kg-text); }
.disclosure .icon { width: 12px; height: 12px; transition: transform var(--kg-base) var(--kg-ease); }
.disclosure[aria-expanded="true"] .icon { transform: rotate(180deg); }
.rels { display: grid; gap: 2px; }
.rel { display: flex; align-items: baseline; gap: 8px; width: 100%; padding: 6px 8px; margin: 0 -8px; border-radius: 7px; text-align: left; font-size: 12.5px; line-height: 1.5; width: calc(100% + 16px); }
.rel:hover { background: var(--kg-hover); }
.rel .sign { flex: none; width: 12px; font: 600 12px/1.5 var(--kg-mono); color: var(--fam-text); text-align: center; }
.rel .s { min-width: 0; overflow-wrap: anywhere; }
.rel .node { font-weight: 550; }
.rel .pred { color: var(--kg-text-2); white-space: nowrap; }
.rel .was { color: var(--kg-text-3); }
.rel.removed .s { text-decoration: line-through; text-decoration-color: var(--kg-text-3); color: var(--kg-text-2); }
.nodes { display: grid; gap: 2px; }
.node-link { display: flex; align-items: center; gap: 8px; width: calc(100% + 16px); margin: 0 -8px; padding: 5px 8px; border-radius: 7px; text-align: left; font-size: 12.5px; }
.node-link:hover { background: var(--kg-hover); }
.node-link[aria-current="true"] { background: var(--kg-hover); box-shadow: inset 0 0 0 1px var(--kg-border-strong); }
.node-link .sdot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: var(--fam-base); }
.node-link .lbl { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.node-link .meta { flex: none; color: var(--kg-text-3); font-size: 11.5px; }
.comp { display: grid; gap: 6px; }
.comp-row { display: flex; align-items: center; gap: 8px; font-size: 12.5px; flex-wrap: wrap; }
.comp-row .arrow { color: var(--kg-text-3); }
.comp-row .note { color: var(--kg-text-3); font-size: 11.5px; }
.bars { display: grid; gap: 6px; }
.bar-row { display: grid; grid-template-columns: 84px minmax(0, 1fr) 40px; align-items: center; gap: 10px; font-size: 12px; }
.bar-row .lbl { color: var(--kg-text-2); }
.bar-row .track { height: 6px; border-radius: 3px; background: var(--kg-track); overflow: hidden; }
.bar-row .fill { height: 100%; border-radius: 3px; background: var(--kg-identity); }
.bar-row .v { text-align: right; color: var(--kg-text-2); font-variant-numeric: tabular-nums; }
.note-line { font-size: 12px; color: var(--kg-text-3); margin-top: 6px; }

/* ── Popovers ────────────────────────────────────────────────────────────── */
.menu {
  position: absolute; z-index: 10; top: 48px; right: 10px; width: 240px; padding: 6px; border-radius: 12px;
  animation: pop var(--kg-fast) var(--kg-ease);
}
@keyframes pop { from { opacity: 0; transform: translateY(-4px) scale(0.98); } }
.menu-group + .menu-group { margin-top: 4px; padding-top: 4px; border-top: 1px solid var(--kg-border); }
.menu-label { padding: 6px 8px 4px; font-size: 11px; font-weight: 650; letter-spacing: 0.06em; text-transform: uppercase; color: var(--kg-text-3); }
.menu-item { display: flex; align-items: center; gap: 8px; width: 100%; height: 32px; padding: 0 8px; border-radius: 7px; font-size: 13px; color: var(--kg-text); text-align: left; }
.menu-item:hover, .menu-item:focus-visible { background: var(--kg-hover); outline: none; }
.menu-item .icon { color: var(--kg-text-2); }
.menu-item .check { margin-left: auto; color: var(--kg-accent-text); opacity: 0; }
.menu-item[aria-checked="true"] .check { opacity: 1; }
.menu-item .sw { display: inline-flex; gap: 2px; }
.menu-item .sw i { width: 6px; height: 6px; border-radius: 50%; display: block; }

.overlay-scrim {
  position: absolute; inset: 0; z-index: 20; display: flex; align-items: center; justify-content: center; padding: 24px;
  background: var(--kg-scrim); animation: fade var(--kg-fast) var(--kg-ease);
}
@keyframes fade { from { opacity: 0; } }
.dialog { width: min(640px, 100%); max-height: 100%; display: flex; flex-direction: column; border-radius: 14px; animation: pop var(--kg-base) var(--kg-ease); }
.dialog-head { display: flex; align-items: center; gap: 10px; padding: 14px 12px 10px 20px; }
.dialog-head h2 { margin: 0; font-size: 15px; font-weight: 650; }
.dialog-head .icon-btn { margin-left: auto; }
.dialog-body { padding: 0 20px 18px; }
.keys { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 24px; }
.key-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 34px; border-bottom: 1px solid var(--kg-border); font-size: 12.5px; color: var(--kg-text-2); }
.key-row .ks { display: inline-flex; align-items: center; gap: 3px; flex: none; color: var(--kg-text-3); font-size: 11px; }

/* ── Compact (< 760 px): bottom sheet ────────────────────────────────────── */
.root[data-compact="true"] .body { flex-direction: column; }
.root[data-compact="true"] .sidebar {
  width: auto; height: var(--sheet-h, 40%); min-height: 0; border-left: 0; border-top: 1px solid var(--kg-border);
  border-radius: 14px 14px 0 0; margin-top: -14px; box-shadow: 0 -8px 24px rgba(0,0,0,0.18);
  transition: height var(--kg-base) var(--kg-ease);
}
.root[data-compact="true"] .sidebar.dragging { transition: none; }
.root[data-compact="true"] .sidebar[data-open="false"] { height: 0; border-top-color: transparent; box-shadow: none; }
.root[data-compact="true"] .sidebar-inner { width: 100%; }
.root[data-compact="true"] .sheet-handle {
  display: flex; flex: none; justify-content: center; align-items: center; height: 28px; cursor: ns-resize; touch-action: none; border-radius: 14px 14px 0 0;
}
.root[data-compact="true"] .sheet-handle::before { content: ""; width: 36px; height: 4px; border-radius: 2px; background: var(--kg-control-border); }
.root[data-compact="true"] .sb-head { padding-top: 4px; }
.root[data-compact="true"] .seg .lbl { display: none; }
.root[data-compact="true"] .seg { padding: 0 9px; }
.root[data-compact="true"] .versions, .root[data-compact="true"] .header-sep, .root[data-compact="true"] .stats,
.root[data-compact="true"] .brand-name { display: none; }
.root[data-compact="true"] .header-center { flex: 1; justify-content: flex-start; }
.root[data-compact="true"] .header-end { flex: none; }
.root[data-compact="true"] .minimap-host, .root[data-compact="true"] .legend { display: none; }
/* Zoom controls move to the top-right corner, clear of the full-width replay transport. */
.root[data-compact="true"] .map-cluster { top: 52px; bottom: auto; right: 12px; }
.root[data-compact="true"] .transport { bottom: 24px; width: calc(100% - 24px); min-width: 0; }
.root[data-compact="true"] .transport .pos { min-width: 48px; }
.root[data-compact="true"] .detail { max-height: 50%; }
.root[data-compact="true"] .caption { max-width: calc(100% - 24px); }
.root[data-narrow="true"] .stats { display: none; }
.root[data-narrow="true"] .versions .tag, .root[data-narrow="true"] .versions .arrow { display: none; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 1ms !important; animation-iteration-count: 1 !important; transition-duration: 1ms !important; }
  .skeleton-grid, .shimmer { animation: none; }
}
`;
