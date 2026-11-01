/**
 * Terminal colors: support detection (`--color`, TTY, `NO_COLOR`, `FORCE_COLOR`, `COLORTERM`,
 * `TERM`) and a tiny painter for the meaning families of docs/visual-language.md.
 *
 * Colors are the visual-language family colors: the dark ("night") base colors on dark or
 * unknown backgrounds, the light ("paper") strong colors when `COLORFGBG` reports a light
 * background. Truecolor terminals get the exact values, 256-color terminals the nearest xterm
 * palette entry, others the closest of the 16 basic colors.
 */

export type ColorMode = 'auto' | 'always' | 'never';

/** 0 = no color, 1 = 16 colors, 2 = 256 colors, 3 = truecolor. */
export type ColorLevel = 0 | 1 | 2 | 3;

export type Env = Readonly<Record<string, string | undefined>>;

/** Color tones used by the CLI: the five meaning families plus UI accents. */
export type Tone = 'added' | 'removed' | 'content' | 'structure' | 'identity' | 'accent';

/**
 * `FORCE_COLOR`: `0` / `false` → 0, `1` / `2` / `3` → exactly that level, `''` / `true` /
 * anything else → `'depth'` (on, at the terminal's depth); unset → `undefined`.
 */
function forceColorLevel(value: string | undefined): ColorLevel | 'depth' | undefined {
  if (value === undefined) return undefined;
  const v = value.trim().toLowerCase();
  if (v === 'false' || v === '0') return 0;
  if (v === '1') return 1;
  if (v === '2') return 2;
  if (v === '3') return 3;
  return 'depth';
}

/** Color depth the terminal supports, assuming color is wanted at all. */
export function terminalDepth(env: Env): ColorLevel {
  const colorterm = (env.COLORTERM ?? '').toLowerCase();
  if (colorterm === 'truecolor' || colorterm === '24bit') return 3;
  const term = (env.TERM ?? '').toLowerCase();
  if (env.WT_SESSION || term === 'xterm-kitty' || term === 'xterm-ghostty' || term === 'wezterm') {
    return 3;
  }
  if (env.GITHUB_ACTIONS === 'true') return 3;
  if (/-256(colou?r)?$/.test(term) || env.TERM_PROGRAM === 'Apple_Terminal') return 2;
  return 1;
}

/**
 * Resolve the color level.
 *
 * - `never` → 0.
 * - `always` → the level `FORCE_COLOR` names (1–3), else the terminal depth (at least 16
 *   colors), even when `NO_COLOR` is set.
 * - `auto`: `FORCE_COLOR` wins (`0`/`false` disables, `1`–`3` force exactly that level, other
 *   values the terminal depth), then a non-empty `NO_COLOR` disables, then color only when the
 *   stream is a TTY and `TERM` is not `dumb`.
 */
export function resolveColorLevel(mode: ColorMode, env: Env, isTTY: boolean): ColorLevel {
  if (mode === 'never') return 0;
  const forced = forceColorLevel(env.FORCE_COLOR);
  const depth = (): ColorLevel => {
    const d = terminalDepth(env);
    return d === 0 ? 1 : d;
  };
  if (mode === 'always') return typeof forced === 'number' && forced > 0 ? forced : depth();
  if (forced !== undefined) return forced === 'depth' ? depth() : forced;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return 0;
  if (!isTTY || env.TERM === 'dumb') return 0;
  return terminalDepth(env);
}

/** True when `COLORFGBG` (rxvt, Konsole, iTerm2…) reports a light background. */
export function isLightBackground(env: Env): boolean {
  const parts = (env.COLORFGBG ?? '').split(';');
  const bg = Number(parts[parts.length - 1]);
  return bg === 7 || bg === 15;
}

type Rgb = readonly [number, number, number];

interface ToneColors {
  readonly dark: Rgb;
  readonly light: Rgb;
  /** SGR foreground code of the nearest basic color. */
  readonly basic: number;
}

const hex = (value: string): Rgb => {
  const n = Number.parseInt(value.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
};

/** docs/visual-language.md: dark `family.*.base`, light `family.*.strong`. */
const TONES: Readonly<Record<Tone, ToneColors>> = {
  added: { dark: hex('#34D399'), light: hex('#15803D'), basic: 32 },
  removed: { dark: hex('#F87171'), light: hex('#B91C1C'), basic: 31 },
  content: { dark: hex('#FBBF24'), light: hex('#B45309'), basic: 33 },
  structure: { dark: hex('#38BDF8'), light: hex('#0369A1'), basic: 36 },
  identity: { dark: hex('#A78BFA'), light: hex('#6D28D9'), basic: 35 },
  accent: { dark: hex('#7C9CFF'), light: hex('#2F49B5'), basic: 34 },
};

const CUBE = [0, 95, 135, 175, 215, 255] as const;

function nearestCube(v: number): number {
  let best = 0;
  for (let i = 1; i < CUBE.length; i++) {
    if (Math.abs((CUBE[i] as number) - v) < Math.abs((CUBE[best] as number) - v)) best = i;
  }
  return best;
}

/** Nearest xterm-256 palette index (6×6×6 cube or gray ramp) by squared RGB distance. */
export function ansi256([r, g, b]: Rgb): number {
  const ri = nearestCube(r);
  const gi = nearestCube(g);
  const bi = nearestCube(b);
  const cube: Rgb = [CUBE[ri] as number, CUBE[gi] as number, CUBE[bi] as number];
  const grayLevel = Math.min(23, Math.max(0, Math.round(((r + g + b) / 3 - 8) / 10)));
  const gray = 8 + grayLevel * 10;
  const dist = (c: Rgb): number => (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2;
  return dist([gray, gray, gray]) < dist(cube) ? 232 + grayLevel : 16 + 36 * ri + 6 * gi + bi;
}

/** Applies colors and text attributes; every method is the identity at level 0. */
export interface Painter {
  readonly level: ColorLevel;
  tone(tone: Tone, text: string): string;
  bold(text: string): string;
  dim(text: string): string;
}

/** Create a painter for `level`. `light` picks colors that read on light backgrounds. */
export function createPainter(level: ColorLevel, light = false): Painter {
  if (level === 0) {
    const id = (text: string): string => text;
    return { level, tone: (_tone, text) => text, bold: id, dim: id };
  }
  const open: Record<Tone, string> = {} as Record<Tone, string>;
  for (const [name, colors] of Object.entries(TONES) as [Tone, ToneColors][]) {
    const rgb = light ? colors.light : colors.dark;
    open[name] =
      level === 3
        ? `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`
        : level === 2
          ? `\x1b[38;5;${ansi256(rgb)}m`
          : `\x1b[${colors.basic}m`;
  }
  const wrap = (start: string, end: string) => (text: string) =>
    text === '' ? '' : `${start}${text}${end}`;
  return {
    level,
    tone: (tone, text) => (text === '' ? '' : `${open[tone]}${text}\x1b[39m`),
    // SGR 22 ends both bold and dim; the CLI never nests the two.
    bold: wrap('\x1b[1m', '\x1b[22m'),
    dim: wrap('\x1b[2m', '\x1b[22m'),
  };
}

/** Remove SGR escape sequences (for measuring or comparing painted text). */
export function stripAnsi(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC is the point.
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}
