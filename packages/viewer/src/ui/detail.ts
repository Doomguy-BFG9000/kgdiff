/**
 * Detail panel (docs/interaction.md §Detail panel): for the selected hunk (or node) — title,
 * family pill, prev / next, reviewed toggle; identity, name (character diff), attributes
 * (word diff), synonyms / types chips, hierarchy, relations as sentences, merge / split
 * composition and match evidence. Unchanged nodes show their attributes and relations.
 */
import type {
  AttrChange,
  AttrValue,
  DiffResult,
  EdgeFacet,
  MatchEvidence,
  NodeFacet,
  UnionEdge,
  UnionId,
  UnionNode,
} from '@kgdiff/core';
import type { Family, Scene, SceneHunk } from '@kgdiff/scene';
import type { Topic } from '../controller.js';
import { attr, h, icon, iconButton, replaceKeepingFocus } from '../dom.js';
import { formatPercent, type Translator } from '../i18n.js';
import { type DiffSegment, diffChars, diffWords } from '../text-diff.js';
import { formatValue, listItems, sceneHunkGlyph, type UiContext } from './context.js';

const MAX_NODES = 12;
const MAX_RELATIONS = 12;
const CLAMP_CHARS = 180;

type Child = Node | string | null | false | undefined;

function section(title: string, count: number | null, ...children: Child[]): HTMLElement {
  return h(
    'section',
    { class: 'section' },
    h('h3', null, title, count !== null ? h('span', { class: 'n', text: String(count) }) : null),
    ...children,
  );
}

function kv(rows: readonly (readonly [string, Child | Child[]])[]): HTMLElement {
  const dl = h('dl', { class: 'kv' });
  for (const [k, v] of rows) dl.append(h('dt', { text: k }), h('dd', null, ...[v].flat()));
  return dl;
}

/** Render one side of a diff: equal text plus that side's changes marked. */
function marked(segs: readonly DiffSegment[], side: 'before' | 'after'): (string | HTMLElement)[] {
  const out: (string | HTMLElement)[] = [];
  for (const s of segs) {
    if (s.op === 'equal') out.push(s.text);
    else if (s.op === 'delete' && side === 'before')
      out.push(h('del', { class: 'hl', text: s.text }));
    else if (s.op === 'insert' && side === 'after')
      out.push(h('ins', { class: 'hl', text: s.text }));
  }
  return out;
}

function chip(text: string, kind: 'add' | 'del' | 'same'): HTMLElement {
  const sign = kind === 'add' ? '+' : kind === 'del' ? '−' : '';
  return h(
    'span',
    { class: `vchip${kind === 'same' ? '' : ` ${kind}`}` },
    sign ? h('span', { class: 'sign', 'aria-hidden': 'true', text: sign }) : null,
    text,
  );
}

function chips(
  added: readonly string[],
  removed: readonly string[],
  same: readonly string[] = [],
): HTMLElement {
  return h(
    'div',
    { class: 'chips' },
    removed.map((x) => chip(x, 'del')),
    added.map((x) => chip(x, 'add')),
    same.map((x) => chip(x, 'same')),
  );
}

function familyOfEdge(e: UnionEdge): Family {
  if (e.status === 'added') return 'added';
  if (e.status === 'removed') {
    return e.facets.some((f) => f.kind === 'collapsed') ? 'identity' : 'removed';
  }
  for (const f of e.facets) {
    if (f.kind === 'retarget')
      return f.cause === 'merge' || f.cause === 'split' ? 'identity' : 'structure';
    if (f.kind === 'predicate') return 'structure';
  }
  return e.status === 'modified' ? 'content' : 'neutral';
}

export class Detail {
  readonly el: HTMLElement;
  readonly #body: HTMLElement;
  #showUnchangedAttrs = false;
  #showAllRelations = false;
  #showAllNodes = false;
  readonly #expandedValues = new Set<string>();
  #lastKey = '';

  readonly #ctx: UiContext;

  constructor(ctx: UiContext) {
    this.#ctx = ctx;
    this.#body = h('div', { class: 'detail-scroll scroll', tabindex: '-1' });
    this.el = h('section', { class: 'detail', 'data-empty': 'true' }, this.#body);
  }

  update(topics: ReadonlySet<Topic>): void {
    if (
      topics.has('selection') ||
      topics.has('data') ||
      topics.has('locale') ||
      topics.has('review') ||
      topics.has('status') ||
      topics.has('filters')
    ) {
      this.#render();
    }
  }

  #render(): void {
    const c = this.#ctx.controller;
    const tr = this.#ctx.tr();
    attr(this.el, 'aria-label', tr.t('detail.label'));
    const scene = c.scene;
    const diff = c.diff;
    this.el.hidden =
      c.status !== 'ready' || !scene || !diff || (scene.hunks.length === 0 && c.selectedNode < 0);
    if (this.el.hidden || !scene || !diff) return;
    const key = `${c.selectedHunk}|${c.selectedNode}`;
    if (key !== this.#lastKey) {
      this.#lastKey = key;
      this.#showUnchangedAttrs = false;
      this.#showAllRelations = false;
      this.#showAllNodes = false;
      this.#expandedValues.clear();
      this.#body.scrollTop = 0;
    }
    if (c.selectedHunk < 0 && c.selectedNode < 0) {
      attr(this.el, 'data-empty', 'true');
      replaceKeepingFocus(
        this.#ctx.root,
        this.#body,
        this.#body,
        h(
          'div',
          { class: 'detail-empty' },
          icon('changes'),
          h(
            'div',
            null,
            h('div', { text: tr.t('detail.empty') }),
            h('div', { class: 'sub', text: tr.t('detail.emptyHint') }),
          ),
        ),
      );
      return;
    }
    attr(this.el, 'data-empty', 'false');
    const hunk = c.selectedHunk >= 0 ? scene.hunks[c.selectedHunk] : undefined;
    if (hunk) this.#renderHunk(hunk, scene, diff, tr);
    else this.#renderNode(scene, diff, tr);
  }

  #nav(tr: Translator, hunk: SceneHunk | undefined): HTMLElement {
    const c = this.#ctx.controller;
    const items: Child[] = [];
    if (hunk) {
      const reviewed = c.isReviewed(hunk.id);
      items.push(
        h(
          'button',
          {
            type: 'button',
            class: 'rv-btn',
            'data-focus-key': 'review',
            'aria-pressed': String(reviewed),
            title: `${tr.t(reviewed ? 'review.unmark' : 'review.mark')} (X)`,
            onclick: () => c.toggleReviewed(hunk.id),
          },
          h('span', { class: 'ring' }, icon('check')),
          tr.t('review.toggle'),
        ),
      );
    }
    const rank = hunk ? c.list.rank.get(hunk.index) : undefined;
    const prev = iconButton('chevron-up', `${tr.t('detail.prev')} (K)`, () => c.prev(), {
      class: 'icon-btn sm',
      'data-focus-key': 'prev',
    });
    const next = iconButton('chevron-down', `${tr.t('detail.next')} (J)`, () => c.next(), {
      class: 'icon-btn sm',
      'data-focus-key': 'next',
    });
    prev.disabled = rank === 0 || c.list.order.length === 0;
    next.disabled =
      (rank !== undefined && rank >= c.list.order.length - 1) || c.list.order.length === 0;
    items.push(prev, next);
    return h('div', { class: 'd-nav' }, ...items);
  }

  #renderHunk(hunk: SceneHunk, scene: Scene, diff: DiffResult, tr: Translator): void {
    const c = this.#ctx.controller;
    const core = diff.index.hunk(hunk.id);
    const focusIndex =
      c.selectedNode >= 0 && hunk.nodes.includes(c.selectedNode) ? c.selectedNode : hunk.anchor;
    const focusId = focusIndex >= 0 ? scene.nodes[focusIndex]?.id : core?.anchor;
    const focus = focusId !== undefined ? diff.index.node(focusId) : undefined;
    const parts: Child[] = [
      h(
        'div',
        { class: 'd-top' },
        h(
          'span',
          { class: 'fam-pill', 'data-family': hunk.family },
          h('span', { class: 'g', 'aria-hidden': 'true', text: sceneHunkGlyph(hunk) }),
          tr.t(`kind.${hunk.kind}`),
        ),
        this.#nav(tr, hunk),
      ),
      h('h2', { class: 'd-title', text: hunk.title }),
      hunk.subtitle ? h('div', { class: 'd-sub', text: hunk.subtitle }) : null,
    ];
    const nodeIds = core?.nodes ?? [];
    if (nodeIds.length > 1) parts.push(this.#nodeList(nodeIds, focusId, scene, diff, tr));
    if (focus) parts.push(...this.#nodeSections(focus, diff, tr, nodeIds.length > 1));
    const edges = (core?.edges ?? [])
      .map((id) => diff.index.edge(id))
      .filter((e): e is UnionEdge => e !== undefined);
    if (edges.length > 0) parts.push(this.#relations(edges, focusId, scene, diff, tr, true));
    replaceKeepingFocus(this.#ctx.root, this.#body, this.#body, ...parts);
  }

  #renderNode(scene: Scene, diff: DiffResult, tr: Translator): void {
    const c = this.#ctx.controller;
    const sn = scene.nodes[c.selectedNode];
    const node = sn ? diff.index.node(sn.id) : undefined;
    if (!sn || !node) {
      replaceKeepingFocus(this.#ctx.root, this.#body, this.#body);
      return;
    }
    const edges = diff.index.edgesOf(node.id);
    replaceKeepingFocus(
      this.#ctx.root,
      this.#body,
      this.#body,
      h(
        'div',
        { class: 'd-top' },
        h(
          'span',
          { class: 'fam-pill', 'data-family': sn.family },
          h('span', { class: 'g', 'aria-hidden': 'true', text: '·' }),
          tr.t(node.status === 'unchanged' ? 'detail.unchangedNode' : `status.${node.status}`),
        ),
        this.#nav(tr, undefined),
      ),
      h('h2', { class: 'd-title', text: node.label }),
      ...this.#nodeSections(node, diff, tr, false),
      edges.length > 0 ? this.#relations(edges, node.id, scene, diff, tr, false) : null,
    );
  }

  // ─── Sections ────────────────────────────────────────────────────────────

  #nodeList(
    ids: readonly UnionId[],
    focusId: UnionId | undefined,
    scene: Scene,
    diff: DiffResult,
    tr: Translator,
  ): HTMLElement {
    const c = this.#ctx.controller;
    const shown = this.#showAllNodes ? ids : ids.slice(0, MAX_NODES);
    const list = h('div', { class: 'nodes' });
    for (const id of shown) {
      const n = diff.index.node(id);
      const i = scene.nodeIndex.get(id);
      const fam = i !== undefined ? (scene.nodes[i]?.family ?? 'neutral') : 'neutral';
      list.appendChild(
        h(
          'button',
          {
            type: 'button',
            class: 'node-link',
            'data-focus-key': `node:${id}`,
            'data-family': fam,
            'aria-current': String(id === focusId),
            onclick: () => {
              if (i !== undefined) c.selectNode(i, { fly: true });
            },
          },
          h('span', { class: 'sdot', 'aria-hidden': 'true' }),
          h('span', { class: 'lbl', text: n?.label ?? id, title: n?.label ?? id }),
          h('span', { class: 'meta', text: n ? tr.t(`status.${n.status}`) : '' }),
        ),
      );
    }
    return section(
      tr.t('detail.nodes'),
      ids.length,
      list,
      ids.length > MAX_NODES
        ? this.#moreToggle(tr, this.#showAllNodes, () => {
            this.#showAllNodes = !this.#showAllNodes;
            this.#render();
          })
        : null,
    );
  }

  #moreToggle(tr: Translator, expanded: boolean, onClick: () => void): HTMLElement {
    return h(
      'button',
      {
        type: 'button',
        class: 'disclosure',
        'data-focus-key': 'nodes-more',
        'aria-expanded': String(expanded),
        onclick: onClick,
      },
      tr.t(expanded ? 'detail.showLess' : 'detail.showMore'),
      icon('chevron-down'),
    );
  }

  #nodeSections(
    node: UnionNode,
    diff: DiffResult,
    tr: Translator,
    showName: boolean,
  ): HTMLElement[] {
    const out: HTMLElement[] = [];
    const facets = node.facets;
    const find = <K extends NodeFacet['kind']>(kind: K) =>
      facets.find((f): f is Extract<NodeFacet, { kind: K }> => f.kind === kind);
    const label = (id: UnionId): string => diff.index.node(id)?.label ?? id;

    // Identity
    const rekey = find('rekey');
    const types = find('types');
    const deprecate = find('deprecate');
    const current = node.after ?? node.before;
    const idRows: [string, Child | Child[]][] = [];
    if (showName) idRows.push([tr.t('detail.name'), h('span', { text: node.label })]);
    idRows.push([
      tr.t('detail.id'),
      rekey
        ? [
            h(
              'span',
              { class: 'id-text' },
              h('del', { class: 'hl', text: rekey.from }),
              ' → ',
              h('ins', { class: 'hl', text: rekey.to }),
            ),
            rekey.score < 1
              ? h('span', {
                  class: 'note-line',
                  text: ` · ${tr.t('detail.matchScore', { p: formatPercent(rekey.score) })}`,
                })
              : null,
          ]
        : h('span', { class: 'id-text', text: node.afterId ?? node.beforeId ?? node.id }),
    ]);
    if (types) idRows.push([tr.t('detail.types'), chips(types.added, types.removed)]);
    else if (node.types.length > 0) idRows.push([tr.t('detail.types'), chips([], [], node.types)]);
    const statusBits: Child[] = [tr.t(`status.${node.status}`)];
    if (current?.deprecated && !deprecate) statusBits.push(` · ${tr.t('detail.deprecated')}`);
    if (deprecate) {
      statusBits.push(
        ' · ',
        h('strong', {
          text: tr.t(deprecate.deprecated ? 'detail.deprecated' : 'detail.undeprecated'),
        }),
      );
    }
    if (current?.implicit) statusBits.push(` · ${tr.t('detail.implicit')}`);
    idRows.push([tr.t('detail.status'), statusBits]);
    out.push(section(tr.t('detail.identity'), null, kv(idRows)));

    // Name
    const rename = find('rename');
    if (rename) {
      const segs = diffChars(rename.from, rename.to);
      out.push(
        section(
          tr.t('detail.name'),
          null,
          h(
            'div',
            { class: 'namediff' },
            h(
              'div',
              { class: 'line old', 'aria-label': `${tr.t('detail.before')}: ${rename.from}` },
              h('span', { class: 'sign', 'aria-hidden': 'true', text: '−' }),
              h('span', null, ...marked(segs, 'before')),
            ),
            h(
              'div',
              { class: 'line new', 'aria-label': `${tr.t('detail.after')}: ${rename.to}` },
              h('span', { class: 'sign', 'aria-hidden': 'true', text: '+' }),
              h('span', null, ...marked(segs, 'after')),
            ),
          ),
        ),
      );
    }

    // Attributes
    const attrs = find('attrs');
    const changes = attrs?.changes ?? [];
    const all = current?.attrs ?? {};
    const changedKeys = new Set(changes.map((x) => x.key));
    const unchanged = Object.keys(all)
      .filter((k) => !changedKeys.has(k))
      .sort();
    if (changes.length > 0 || unchanged.length > 0) {
      out.push(this.#attributes(node.id, changes, unchanged, all, tr));
    }

    // Synonyms
    const aliases = find('aliases');
    if (aliases)
      out.push(section(tr.t('detail.aliases'), null, chips(aliases.added, aliases.removed)));
    else if (current && current.aliases.length > 0 && node.status === 'unchanged') {
      out.push(section(tr.t('detail.aliases'), null, chips([], [], current.aliases)));
    }

    // Hierarchy
    const move = find('move');
    if (move) {
      const dl = h('dl', { class: 'hier' });
      dl.append(
        h('dt', { text: tr.t('detail.before') }),
        h(
          'dd',
          null,
          move.from.length
            ? move.from.map((id) => chip(label(id), 'del'))
            : chip(tr.t('detail.none'), 'same'),
        ),
        h('dt', { text: tr.t('detail.after') }),
        h(
          'dd',
          null,
          move.to.length
            ? move.to.map((id) => chip(label(id), 'add'))
            : chip(tr.t('detail.none'), 'same'),
        ),
      );
      out.push(section(tr.t('detail.hierarchy'), null, dl));
    }

    // Replacement links
    const replacement = find('replacement');
    if (replacement) {
      const rows: [string, Child][] = [];
      const { replacedBy, replaces } = replacement;
      if (replacedBy.added.length || replacedBy.removed.length) {
        rows.push([tr.t('detail.replacedBy'), chips(replacedBy.added, replacedBy.removed)]);
      }
      if (replaces.added.length || replaces.removed.length) {
        rows.push([tr.t('detail.replaces'), chips(replaces.added, replaces.removed)]);
      }
      if (rows.length) out.push(section(tr.t('detail.deprecated'), null, kv(rows)));
    }

    // Composition
    const comp = this.#composition(node, diff, tr, label);
    if (comp) out.push(comp);

    // Evidence
    const evidence = this.#evidence(node, diff, tr, label);
    if (evidence) out.push(evidence);
    return out;
  }

  #attributes(
    nodeId: string,
    changes: readonly AttrChange[],
    unchanged: readonly string[],
    all: Readonly<Record<string, AttrValue>>,
    tr: Translator,
  ): HTMLElement {
    const table = h(
      'table',
      { class: 'attrs' },
      h('colgroup', null, h('col', { class: 'k' }), h('col'), h('col')),
    );
    if (changes.length > 0) {
      table.appendChild(
        h(
          'thead',
          null,
          h(
            'tr',
            null,
            h('th', { scope: 'col', text: tr.t('detail.key') }),
            h('th', { scope: 'col', text: tr.t('detail.before') }),
            h('th', { scope: 'col', text: tr.t('detail.after') }),
          ),
        ),
      );
    }
    const body = h('tbody');
    for (const ch of changes) body.appendChild(this.#changeRow(nodeId, ch, tr));
    if (this.#showUnchangedAttrs || changes.length === 0) {
      for (const k of unchanged) {
        body.appendChild(
          h(
            'tr',
            { class: 'unchanged' },
            h('td', { class: 'k', text: k }),
            h('td', { colspan: '2' }, this.#value(`${nodeId}|u|${k}`, formatValue(all[k]), tr)),
          ),
        );
      }
    }
    table.appendChild(body);
    const toggle =
      changes.length > 0 && unchanged.length > 0
        ? h(
            'button',
            {
              type: 'button',
              class: 'disclosure',
              'data-focus-key': 'attrs-more',
              'aria-expanded': String(this.#showUnchangedAttrs),
              onclick: () => {
                this.#showUnchangedAttrs = !this.#showUnchangedAttrs;
                this.#render();
              },
            },
            tr.plural('detail.unchangedAttrs', unchanged.length),
            icon('chevron-down'),
          )
        : null;
    return section(tr.t('detail.attributes'), null, table, toggle);
  }

  #changeRow(nodeId: string, ch: AttrChange, tr: Translator): HTMLElement {
    const empty = (): HTMLElement => h('span', { class: 'empty', text: tr.t('detail.emptyValue') });
    const beforeList = listItems(ch.before);
    const afterList = listItems(ch.after);
    let before: Child | Child[];
    let after: Child | Child[];
    if (beforeList && afterList) {
      const a = new Set(afterList);
      const b = new Set(beforeList);
      before = h(
        'div',
        { class: 'chips' },
        beforeList.map((x) => chip(x, a.has(x) ? 'same' : 'del')),
      );
      after = h(
        'div',
        { class: 'chips' },
        afterList.map((x) => chip(x, b.has(x) ? 'same' : 'add')),
      );
    } else if (typeof ch.before === 'string' && typeof ch.after === 'string') {
      const segs = diffWords(ch.before, ch.after);
      before = this.#value(`${nodeId}|b|${ch.key}`, ch.before, tr, marked(segs, 'before'));
      after = this.#value(`${nodeId}|a|${ch.key}`, ch.after, tr, marked(segs, 'after'));
    } else {
      before =
        ch.before === undefined
          ? empty()
          : this.#value(`${nodeId}|b|${ch.key}`, formatValue(ch.before), tr, [
              h('del', { class: 'hl', text: formatValue(ch.before) }),
            ]);
      after =
        ch.after === undefined
          ? empty()
          : this.#value(`${nodeId}|a|${ch.key}`, formatValue(ch.after), tr, [
              h('ins', { class: 'hl', text: formatValue(ch.after) }),
            ]);
    }
    return h(
      'tr',
      { class: 'changed' },
      h('td', { class: 'k', text: ch.key }),
      h('td', { class: 'b' }, ...[before].flat()),
      h('td', { class: 'a' }, ...[after].flat()),
    );
  }

  /** A value cell, clamped to 4 lines with “Show more” when long. */
  #value(
    key: string,
    text: string,
    tr: Translator,
    content?: (string | HTMLElement)[],
  ): HTMLElement {
    const long = text.length > CLAMP_CHARS;
    const open = this.#expandedValues.has(key);
    const v = h('div', { class: `val${long && !open ? ' clamped' : ''}` }, ...(content ?? [text]));
    if (!long) return v;
    return h(
      'div',
      null,
      v,
      h('button', {
        type: 'button',
        class: 'link-btn more',
        'data-focus-key': `value:${key}`,
        text: tr.t(open ? 'detail.showLess' : 'detail.showMore'),
        onclick: () => {
          if (open) this.#expandedValues.delete(key);
          else this.#expandedValues.add(key);
          this.#render();
        },
      }),
    );
  }

  #composition(
    node: UnionNode,
    diff: DiffResult,
    tr: Translator,
    label: (id: UnionId) => string,
  ): HTMLElement | null {
    const rows: HTMLElement[] = [];
    const via = (v: 'hint' | 'heuristic', confidence: number): string =>
      v === 'hint'
        ? tr.t('detail.viaHint')
        : `${tr.t('detail.viaHeuristic')} · ${tr.t('detail.confidence', { p: formatPercent(confidence) })}`;
    for (const f of node.facets) {
      switch (f.kind) {
        case 'mergedInto':
          rows.push(
            h(
              'div',
              { class: 'comp-row' },
              chip(node.label, 'del'),
              h('span', { class: 'arrow', 'aria-hidden': 'true', text: '→' }),
              chip(label(f.target), 'same'),
              h('span', { class: 'note', text: via(f.via, f.confidence) }),
            ),
          );
          break;
        case 'mergeTarget': {
          const notes = f.sources.map((s) => {
            const src = diff.index.node(s);
            const m = src?.facets.find((x) => x.kind === 'mergedInto');
            return m && m.kind === 'mergedInto' ? via(m.via, m.confidence) : '';
          });
          rows.push(
            h(
              'div',
              { class: 'comp-row' },
              h('span', { class: 'note', text: tr.t('detail.mergedFrom') }),
            ),
            ...f.sources.map((s, i) =>
              h(
                'div',
                { class: 'comp-row' },
                chip(label(s), 'del'),
                h('span', { class: 'arrow', 'aria-hidden': 'true', text: '→' }),
                chip(node.label, 'same'),
                notes[i] ? h('span', { class: 'note', text: notes[i] }) : null,
              ),
            ),
          );
          break;
        }
        case 'splitFrom':
          rows.push(
            h(
              'div',
              { class: 'comp-row' },
              chip(label(f.source), 'same'),
              h('span', { class: 'arrow', 'aria-hidden': 'true', text: '→' }),
              chip(node.label, 'add'),
              h('span', { class: 'note', text: via(f.via, f.confidence) }),
            ),
          );
          break;
        case 'splitInto':
          rows.push(
            h(
              'div',
              { class: 'comp-row' },
              h('span', { class: 'note', text: tr.t('detail.splitInto') }),
            ),
            h(
              'div',
              { class: 'comp-row' },
              chip(node.label, 'same'),
              h('span', { class: 'arrow', 'aria-hidden': 'true', text: '→' }),
              ...f.targets.map((t) => chip(label(t), 'add')),
            ),
          );
          break;
        default:
          break;
      }
    }
    return rows.length
      ? section(tr.t('detail.composition'), null, h('div', { class: 'comp' }, ...rows))
      : null;
  }

  #evidence(
    node: UnionNode,
    diff: DiffResult,
    tr: Translator,
    label: (id: UnionId) => string,
  ): HTMLElement | null {
    const parts: Child[] = [];
    const rekey = node.facets.find((f) => f.kind === 'rekey');
    if (rekey && node.afterId !== undefined) {
      const m = diff.matches.find((x) => x.after === node.afterId);
      if (m?.method === 'hint')
        parts.push(h('div', { class: 'note-line', text: tr.t('detail.matchHint') }));
      else if (m) {
        parts.push(
          h('div', {
            class: 'note-line',
            text: tr.t('detail.matchScore', { p: formatPercent(m.score) }),
          }),
        );
        if (m.evidence) parts.push(this.#bars(m.evidence, tr));
      }
    }
    const suggestions = diff.suggestions.filter(
      (s) =>
        (node.beforeId !== undefined && node.status === 'removed' && s.before === node.beforeId) ||
        (node.afterId !== undefined && node.status === 'added' && s.after === node.afterId),
    );
    for (const s of suggestions) {
      const other =
        node.status === 'removed'
          ? diff.index.nodeByAfter(s.after)
          : diff.index.nodeByBefore(s.before);
      parts.push(
        h(
          'div',
          { class: 'comp-row', style: 'margin-top: 8px' },
          h('span', { class: 'note', text: tr.t('detail.suggestion') }),
          chip(other ? label(other.id) : node.status === 'removed' ? s.after : s.before, 'same'),
          h('span', {
            class: 'note',
            text: `${tr.t('detail.matchScore', { p: formatPercent(s.score) })} · ${tr.t(
              s.reason === 'ambiguous' ? 'detail.suggestion.ambiguous' : 'detail.suggestion.below',
            )}`,
          }),
        ),
        this.#bars(s.evidence, tr),
      );
    }
    return parts.length ? section(tr.t('detail.evidence'), null, ...parts) : null;
  }

  #bars(e: MatchEvidence, tr: Translator): HTMLElement {
    const rows: [string, number][] = [
      [tr.t('detail.evidence.label'), e.label],
      [tr.t('detail.evidence.neighbors'), e.neighbors],
      [tr.t('detail.evidence.types'), e.types],
      [tr.t('detail.evidence.attrs'), e.attrs],
    ];
    return h(
      'div',
      { class: 'bars', style: 'margin-top: 8px' },
      rows.map(([k, v]) =>
        h(
          'div',
          { class: 'bar-row' },
          h('span', { class: 'lbl', text: k }),
          h(
            'span',
            {
              class: 'track',
              role: 'meter',
              'aria-label': k,
              'aria-valuemin': '0',
              'aria-valuemax': '100',
              'aria-valuenow': String(Math.round(v * 100)),
            },
            h('span', {
              class: 'fill',
              style: `display:block; width: ${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`,
            }),
          ),
          h('span', { class: 'v', text: formatPercent(v) }),
        ),
      ),
    );
  }

  // ─── Relations ───────────────────────────────────────────────────────────

  #relations(
    edges: readonly UnionEdge[],
    focusId: UnionId | undefined,
    scene: Scene,
    diff: DiffResult,
    tr: Translator,
    changed: boolean,
  ): HTMLElement {
    const sorted = changed
      ? edges
      : [...edges].sort((a, b) => Number(a.source !== focusId) - Number(b.source !== focusId));
    const shown = this.#showAllRelations ? sorted : sorted.slice(0, MAX_RELATIONS);
    const list = h('div', { class: 'rels' });
    for (const e of shown) list.appendChild(this.#relation(e, focusId, scene, diff, tr));
    const rest = sorted.length - shown.length;
    return section(
      tr.t('detail.relations'),
      edges.length,
      list,
      rest > 0 || this.#showAllRelations
        ? h(
            'button',
            {
              type: 'button',
              class: 'disclosure',
              'data-focus-key': 'rels-more',
              'aria-expanded': String(this.#showAllRelations),
              onclick: () => {
                this.#showAllRelations = !this.#showAllRelations;
                this.#render();
              },
            },
            this.#showAllRelations
              ? tr.t('detail.showLess')
              : tr.plural('detail.moreRelations', rest),
            icon('chevron-down'),
          )
        : null,
    );
  }

  #relation(
    e: UnionEdge,
    focusId: UnionId | undefined,
    scene: Scene,
    diff: DiffResult,
    tr: Translator,
  ): HTMLElement {
    const c = this.#ctx.controller;
    const label = (id: UnionId): string => diff.index.node(id)?.label ?? id;
    const node = (id: UnionId): HTMLElement => h('span', { class: 'node', text: label(id) });
    const was = (id: UnionId): HTMLElement =>
      h('span', { class: 'was', text: ` (${tr.t('detail.was', { x: tr.quote(label(id)) })})` });
    const retarget = e.facets.find(
      (f): f is Extract<EdgeFacet, { kind: 'retarget' }> => f.kind === 'retarget',
    );
    const predicate = e.facets.find(
      (f): f is Extract<EdgeFacet, { kind: 'predicate' }> => f.kind === 'predicate',
    );
    const relabel = e.facets.find(
      (f): f is Extract<EdgeFacet, { kind: 'label' }> => f.kind === 'label',
    );
    const pred = h('span', { class: 'pred', text: ` —${e.label}→ ` });
    const outgoing = focusId !== undefined && e.source === focusId && e.target !== focusId;
    const incoming = focusId !== undefined && e.target === focusId && e.source !== focusId;
    const s: Child[] = [];
    if (outgoing) {
      s.push(h('span', { class: 'pred', text: `→ ${e.label} → ` }), node(e.target));
      if (retarget?.end === 'target') s.push(was(retarget.from));
    } else if (incoming) {
      s.push(h('span', { class: 'pred', text: `← ${e.label} ← ` }), node(e.source));
      if (retarget?.end === 'source') s.push(was(retarget.from));
    } else {
      s.push(node(e.source));
      if (retarget?.end === 'source') s.push(was(retarget.from));
      s.push(pred, node(e.target));
      if (retarget?.end === 'target') s.push(was(retarget.from));
    }
    const prevLabel = predicate
      ? (e.before?.label ?? predicate.from)
      : relabel
        ? relabel.from
        : undefined;
    if (prevLabel !== undefined) {
      s.push(
        h('span', { class: 'was', text: ` (${tr.t('detail.was', { x: tr.quote(prevLabel) })})` }),
      );
    }
    if (e.facets.some((f) => f.kind === 'attrs')) {
      s.push(h('span', { class: 'was', text: ` · ${tr.t('detail.edgeAttrs')}` }));
    }
    if (e.facets.some((f) => f.kind === 'collapsed')) {
      s.push(h('span', { class: 'was', text: ` · ${tr.t('detail.collapsed')}` }));
    }
    const sign =
      e.status === 'added'
        ? '+'
        : e.status === 'removed'
          ? '−'
          : e.status === 'modified'
            ? '~'
            : '·';
    const j = scene.edgeIndex.get(e.id);
    const family = familyOfEdge(e);
    return h(
      'button',
      {
        type: 'button',
        class: `rel ${e.status}`,
        'data-focus-key': `rel:${e.id}`,
        'data-family': family,
        title: tr.t('detail.showOnCanvas'),
        disabled: j === undefined,
        onclick: () => {
          if (j !== undefined) c.pinEdge(j);
        },
      },
      h('span', { class: 'sign', 'aria-hidden': 'true', text: sign }),
      h('span', { class: 's' }, ...s),
    );
  }
}
