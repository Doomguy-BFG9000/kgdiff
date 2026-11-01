/**
 * Render real `kgdiff` terminal output (ANSI SGR escapes from the CLI's golden snapshots) as
 * DOM. Colors map back to the meaning families; every non-ASCII character gets a fixed-width
 * cell (1 or 2 columns, East Asian Width) so columns line up exactly as in a terminal whatever
 * fallback fonts the browser picks for CJK text and glyphs like ⊕ ⇄ █.
 */

interface Style {
  bold: boolean;
  dim: boolean;
  color: string | null;
}

/** Truecolor values the CLI emits (docs/visual-language.md dark tokens) → CSS variables. */
const COLORS: Readonly<Record<string, string>> = {
  '52;211;153': 'var(--t-added)',
  '248;113;113': 'var(--t-removed)',
  '251;191;36': 'var(--t-content)',
  '56;189;248': 'var(--t-structure)',
  '167;139;250': 'var(--t-identity)',
  '124;156;255': 'var(--t-accent)',
};

/** East Asian Wide / Fullwidth code points (the ranges that occur in practice). */
function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) ||
    (cp >= 0x1f900 && cp <= 0x1f9ff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

function appendText(parent: Node, text: string): void {
  let ascii = '';
  const flush = (): void => {
    if (ascii) parent.appendChild(document.createTextNode(ascii));
    ascii = '';
  };
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 0x80) {
      ascii += ch;
      continue;
    }
    flush();
    const cell = document.createElement('span');
    // Full blocks (the diffstat bar) are painted as solid cells so the bar stays continuous.
    cell.className = ch === '\u2588' ? 'c1 blk' : isWide(cp) ? 'c2' : 'c1';
    cell.textContent = ch;
    parent.appendChild(cell);
  }
  flush();
}

function applySgr(style: Style, params: number[]): void {
  for (let i = 0; i < params.length; i++) {
    const p = params[i] ?? 0;
    if (p === 0) {
      style.bold = false;
      style.dim = false;
      style.color = null;
    } else if (p === 1) style.bold = true;
    else if (p === 2) style.dim = true;
    else if (p === 22) {
      style.bold = false;
      style.dim = false;
    } else if (p === 39) style.color = null;
    else if (p === 38 && params[i + 1] === 2) {
      const rgb = params.slice(i + 2, i + 5).join(';');
      style.color = COLORS[rgb] ?? `rgb(${params.slice(i + 2, i + 5).join(',')})`;
      i += 4;
    }
  }
}

/** ANSI text → a fragment of styled spans. Unknown escape sequences are dropped. */
export function renderAnsi(text: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  const style: Style = { bold: false, dim: false, color: null };
  // biome-ignore lint/suspicious/noControlCharactersInRegex: parsing terminal escapes
  const re = /\u001b\[([\d;]*)m/g;
  let last = 0;
  const emit = (chunk: string): void => {
    if (!chunk) return;
    if (!style.bold && !style.dim && !style.color) {
      appendText(frag, chunk);
      return;
    }
    const span = document.createElement('span');
    if (style.bold) span.classList.add('b');
    if (style.dim) span.classList.add('d');
    if (style.color) span.style.color = style.color;
    appendText(span, chunk);
    frag.appendChild(span);
  };
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    emit(text.slice(last, m.index));
    applySgr(
      style,
      (m[1] ?? '').split(';').map((s) => (s === '' ? 0 : Number(s))),
    );
    last = m.index + m[0].length;
  }
  emit(text.slice(last));
  return frag;
}
