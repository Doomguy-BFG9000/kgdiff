/**
 * A deliberately tiny syntax highlighter for the site's own static snippets (HTML, TypeScript,
 * JSON, YAML). Calm, near-monochrome classes (`tok-k` keywords, `tok-s` strings, `tok-c`
 * comments, `tok-n` numbers, `tok-t` tags, `tok-a` attributes, `tok-p` punctuation): family
 * colors are reserved for change meaning.
 */

type Lang = 'html' | 'ts' | 'json' | 'yaml';

interface Rule {
  readonly re: RegExp;
  readonly cls: string;
}

const TS_KEYWORDS =
  'import|from|export|const|let|await|async|function|return|new|of|if|else|for|type|interface|true|false|null|undefined';

const RULES: Readonly<Record<Lang, readonly Rule[]>> = {
  ts: [
    { re: /\/\/[^\n]*/y, cls: 'tok-c' },
    { re: /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/y, cls: 'tok-s' },
    { re: new RegExp(`\\b(?:${TS_KEYWORDS})\\b`, 'y'), cls: 'tok-k' },
    { re: /\b\d+(?:\.\d+)?\b/y, cls: 'tok-n' },
    { re: /[{}()[\];,.=>:]/y, cls: 'tok-p' },
  ],
  json: [
    { re: /"(?:[^"\\\n]|\\.)*"(?=\s*:)/y, cls: 'tok-a' },
    { re: /"(?:[^"\\\n]|\\.)*"/y, cls: 'tok-s' },
    { re: /\b(?:true|false|null)\b/y, cls: 'tok-k' },
    { re: /-?\b\d+(?:\.\d+)?\b/y, cls: 'tok-n' },
    { re: /[{}[\],:]/y, cls: 'tok-p' },
  ],
  yaml: [
    { re: /#[^\n]*/y, cls: 'tok-c' },
    { re: /"(?:[^"\\\n]|\\.)*"|'[^'\n]*'/y, cls: 'tok-s' },
    { re: /[\w.-]+(?=:\s)/y, cls: 'tok-a' },
    { re: /-(?=\s)/y, cls: 'tok-p' },
    { re: /\b\d+\b/y, cls: 'tok-n' },
  ],
  html: [
    { re: /<!--[\s\S]*?-->/y, cls: 'tok-c' },
    { re: /<\/?[a-zA-Z][\w-]*|\/?>/y, cls: 'tok-t' },
    { re: /\s[a-zA-Z-]+(?==)/y, cls: 'tok-a' },
    { re: /"[^"\n]*"/y, cls: 'tok-s' },
  ],
};

/** Inside <script> blocks of an HTML snippet, highlight as TypeScript. */
function highlightHtml(code: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  const parts = code.split(/(<script[^>]*>)([\s\S]*?)(<\/script>)/);
  // split with 3 groups: [before, open, body, close, after, …]
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] ?? '';
    const role = i % 4;
    frag.append(role === 2 ? tokenize(part, RULES.ts) : tokenize(part, RULES.html));
  }
  return frag;
}

function tokenize(code: string, rules: readonly Rule[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  let plain = '';
  let i = 0;
  const flush = (): void => {
    if (plain) frag.append(plain);
    plain = '';
  };
  outer: while (i < code.length) {
    for (const rule of rules) {
      rule.re.lastIndex = i;
      const m = rule.re.exec(code);
      if (m && m.index === i && m[0].length > 0) {
        flush();
        const span = document.createElement('span');
        span.className = rule.cls;
        span.textContent = m[0];
        frag.append(span);
        i += m[0].length;
        continue outer;
      }
    }
    plain += code[i];
    i += 1;
  }
  flush();
  return frag;
}

/** Highlight every `code[data-highlight]` under `root` in place (idempotent). */
export function highlightAll(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>('code[data-highlight]')) {
    if (el.dataset.highlighted) continue;
    const lang = el.dataset.highlight as Lang;
    const code = el.textContent ?? '';
    const frag = lang === 'html' ? highlightHtml(code) : tokenize(code, RULES[lang] ?? []);
    el.replaceChildren(frag);
    el.dataset.highlighted = 'true';
  }
}
