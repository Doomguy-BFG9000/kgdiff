/**
 * Render the CLI's `--markdown` output (golden snapshot) like GitHub renders a PR comment.
 * Not a general Markdown parser: exactly the subset kgdiff emits (heading, paragraphs, one
 * table, `<details>` groups with bullet lists, `**bold**`, `*italic*`, backslash escapes),
 * built with DOM APIs only. The colored square emoji become family swatches.
 */

const SQUARES: Readonly<Record<string, string>> = {
  '🟩': 'added',
  '🟥': 'removed',
  '🟨': 'content',
  '🟦': 'structure',
  '🟪': 'identity',
};

function inline(parent: HTMLElement, text: string): void {
  // Tokens: **bold**, *italic*, emoji squares; everything else is text (escapes removed).
  const re = /\*\*(.+?)\*\*|\*(.+?)\*|(🟩|🟥|🟨|🟦|🟪)/gu;
  let last = 0;
  const plain = (s: string): void => {
    if (s) parent.append(s.replace(/\\([\\`*_~#[\]()|<>-])/g, '$1'));
  };
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    plain(text.slice(last, m.index));
    if (m[1] !== undefined) {
      const b = document.createElement('strong');
      inline(b, m[1]);
      parent.append(b);
    } else if (m[2] !== undefined) {
      const em = document.createElement('em');
      inline(em, m[2]);
      parent.append(em);
    } else if (m[3] !== undefined) {
      const sq = document.createElement('span');
      sq.className = 'md-sq';
      sq.dataset.family = SQUARES[m[3]] ?? 'neutral';
      sq.setAttribute('aria-hidden', 'true');
      parent.append(sq);
    }
    last = m.index + m[0].length;
  }
  plain(text.slice(last));
}

function cells(row: string): string[] {
  return row
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());
}

export function renderMarkdown(source: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  let container: HTMLElement | DocumentFragment = frag;
  let list: HTMLUListElement | null = null;
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const t = line.trim();
    if (t !== '' && !t.startsWith('- ')) list = null;
    if (t === '') continue;
    if (t.startsWith('## ')) {
      const h = document.createElement('h4');
      inline(h, t.slice(3));
      container.append(h);
    } else if (t.startsWith('<details')) {
      const d = document.createElement('details');
      d.open = t.includes('open');
      frag.append(d);
      container = d;
    } else if (t.startsWith('<summary>')) {
      const s = document.createElement('summary');
      inline(s, t.replace(/<\/?summary>/g, ''));
      container.append(s);
    } else if (t === '</details>') {
      container = frag;
    } else if (t.startsWith('|')) {
      const rows: string[] = [];
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('|')) {
        rows.push((lines[i] ?? '').trim());
        i++;
      }
      i--;
      const [head, align, ...body] = rows;
      const right = cells(align ?? '').map((a) => a.endsWith(':') && !a.startsWith(':'));
      const table = document.createElement('table');
      const thead = table.createTHead().insertRow();
      cells(head ?? '').forEach((c, k) => {
        const th = document.createElement('th');
        if (right[k]) th.className = 'r';
        inline(th, c);
        thead.append(th);
      });
      const tbody = table.createTBody();
      for (const r of body) {
        const tr = tbody.insertRow();
        cells(r).forEach((c, k) => {
          const td = tr.insertCell();
          if (right[k]) td.className = 'r';
          inline(td, c);
        });
      }
      container.append(table);
    } else if (t.startsWith('- ')) {
      if (!list) {
        list = document.createElement('ul');
        container.append(list);
      }
      const li = document.createElement('li');
      inline(li, t.slice(2));
      list.append(li);
    } else {
      const p = document.createElement('p');
      inline(p, t);
      container.append(p);
    }
  }
  return frag;
}
