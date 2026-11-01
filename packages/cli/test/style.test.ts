import { describe, expect, it } from 'vitest';
import { createPainter, resolveColorLevel, stripAnsi } from '../src/index.js';
import { ansi256, isLightBackground, terminalDepth } from '../src/style.js';

describe('resolveColorLevel', () => {
  it('is off with --color never, whatever the environment says', () => {
    expect(resolveColorLevel('never', { FORCE_COLOR: '3' }, true)).toBe(0);
  });

  it('is on with --color always, even with NO_COLOR or without a TTY', () => {
    expect(resolveColorLevel('always', { NO_COLOR: '1' }, false)).toBeGreaterThan(0);
    expect(resolveColorLevel('always', {}, false)).toBe(1);
    expect(resolveColorLevel('always', { COLORTERM: 'truecolor' }, false)).toBe(3);
  });

  it('follows the TTY in auto mode', () => {
    expect(resolveColorLevel('auto', {}, true)).toBe(1);
    expect(resolveColorLevel('auto', {}, false)).toBe(0);
    expect(resolveColorLevel('auto', { TERM: 'dumb' }, true)).toBe(0);
  });

  it('honours a non-empty NO_COLOR in auto mode', () => {
    expect(resolveColorLevel('auto', { NO_COLOR: '1' }, true)).toBe(0);
    expect(resolveColorLevel('auto', { NO_COLOR: '' }, true)).toBe(1);
  });

  it('lets FORCE_COLOR win in auto mode', () => {
    expect(resolveColorLevel('auto', { FORCE_COLOR: '1' }, false)).toBe(1);
    expect(resolveColorLevel('auto', { FORCE_COLOR: '2' }, false)).toBe(2);
    expect(resolveColorLevel('auto', { FORCE_COLOR: '3' }, false)).toBe(3);
    expect(resolveColorLevel('auto', { FORCE_COLOR: '0' }, true)).toBe(0);
    expect(resolveColorLevel('auto', { FORCE_COLOR: 'false' }, true)).toBe(0);
    expect(resolveColorLevel('auto', { FORCE_COLOR: '1', NO_COLOR: '1' }, false)).toBe(1);
    expect(resolveColorLevel('auto', { FORCE_COLOR: '', COLORTERM: 'truecolor' }, false)).toBe(3);
  });

  it('detects the color depth', () => {
    expect(terminalDepth({ COLORTERM: 'truecolor' })).toBe(3);
    expect(terminalDepth({ COLORTERM: '24bit' })).toBe(3);
    expect(terminalDepth({ TERM: 'xterm-256color' })).toBe(2);
    expect(terminalDepth({ TERM: 'xterm' })).toBe(1);
    expect(terminalDepth({ WT_SESSION: 'x' })).toBe(3);
  });

  it('detects light backgrounds from COLORFGBG', () => {
    expect(isLightBackground({ COLORFGBG: '0;15' })).toBe(true);
    expect(isLightBackground({ COLORFGBG: '15;0' })).toBe(false);
    expect(isLightBackground({})).toBe(false);
  });
});

describe('painter', () => {
  it('is the identity without color', () => {
    const p = createPainter(0);
    expect(p.tone('added', 'x')).toBe('x');
    expect(p.bold('x')).toBe('x');
    expect(p.dim('x')).toBe('x');
  });

  it('uses the exact family colors in truecolor', () => {
    const p = createPainter(3);
    expect(p.tone('added', '+1')).toBe('\x1b[38;2;52;211;153m+1\x1b[39m');
    expect(p.tone('identity', 'x')).toContain('38;2;167;139;250');
    expect(createPainter(3, true).tone('added', 'x')).toContain('38;2;21;128;61');
  });

  it('uses the nearest xterm-256 color, or the basic color', () => {
    expect(createPainter(2).tone('removed', 'x')).toBe(
      `\x1b[38;5;${ansi256([0xf8, 0x71, 0x71])}mx\x1b[39m`,
    );
    expect(createPainter(1).tone('structure', 'x')).toBe('\x1b[36mx\x1b[39m');
  });

  it('round-trips through stripAnsi', () => {
    const p = createPainter(3);
    expect(stripAnsi(p.bold(p.tone('content', '~6')))).toBe('~6');
  });
});

describe('ansi256', () => {
  it('maps pure colors to the cube and grays to the ramp', () => {
    expect(ansi256([255, 0, 0])).toBe(196);
    expect(ansi256([0, 0, 0])).toBe(16);
    expect(ansi256([255, 255, 255])).toBe(231);
    expect(ansi256([128, 128, 128])).toBe(244);
  });
});
