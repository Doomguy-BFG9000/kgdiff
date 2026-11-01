import { describe, expect, it } from 'vitest';
import { parseGraph } from '../src/index.js';

/**
 * Budget (docs: "50k triples < 1 s"). Assertions leave headroom for slow CI machines; the
 * actual timings are logged so regressions stay visible.
 */
const BUDGET_MS = 1000;
const CI_HEADROOM = 2.5;
const TRIPLES = 50_000;

/** OWL-flavoured Turtle: 11 triples per class (labels, literals, hierarchy, a restriction). */
function owlTurtle(triples: number): { text: string; triples: number } {
  const classes = Math.ceil(triples / 11);
  const lines = [
    '@prefix ex: <https://example.org/onto/> .',
    '@prefix obo: <http://purl.obolibrary.org/obo/> .',
    '@prefix owl: <http://www.w3.org/2002/07/owl#> .',
    '@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .',
    '',
  ];
  for (let i = 0; i < classes; i++) {
    const parent =
      i === 0 ? 'owl:Thing' : `obo:EX_${String(Math.floor((i - 1) / 4)).padStart(7, '0')}`;
    lines.push(
      `obo:EX_${String(i).padStart(7, '0')} a owl:Class ;`,
      `  rdfs:label "class ${i}"@en, "类 ${i}"@zh ;`,
      `  ex:score ${i % 97} ; ex:flag ${i % 2 === 0} ;`,
      `  rdfs:subClassOf ${parent} ;`,
      `  ex:related obo:EX_${String((i * 7919) % classes).padStart(7, '0')} ;`,
      `  rdfs:subClassOf [ a owl:Restriction ; owl:onProperty obo:BFO_0000050 ; owl:someValuesFrom obo:EX_${String((i * 31) % classes).padStart(7, '0')} ] .`,
    );
  }
  return { text: lines.join('\n'), triples: classes * 11 };
}

function nTriples(triples: number): string {
  const lines: string[] = [];
  for (let i = 0; i < triples / 2; i++) {
    lines.push(
      `<https://example.org/n/${i}> <http://www.w3.org/2000/01/rdf-schema#label> "node ${i}" .`,
      `<https://example.org/n/${i}> <https://example.org/p/next> <https://example.org/n/${(i + 1) % 1000}> .`,
    );
  }
  return lines.join('\n');
}

function obo(terms: number): string {
  const stanzas = ['format-version: 1.4', 'ontology: perf', ''];
  for (let i = 0; i < terms; i++) {
    stanzas.push(
      '[Term]',
      `id: EX:${String(i).padStart(7, '0')}`,
      `name: term ${i}`,
      `def: "Definition of term ${i}, with \\"quotes\\"." [PMID:${i}, GOC:x]`,
      `synonym: "synonym ${i}" EXACT []`,
      `is_a: EX:${String(Math.floor(i / 3)).padStart(7, '0')} ! parent`,
      `relationship: part_of EX:${String((i * 13) % terms).padStart(7, '0')} {source="x"}`,
      '',
    );
  }
  return stanzas.join('\n');
}

function json(edges: number): string {
  const nodes = Array.from({ length: edges / 5 }, (_, i) => ({
    id: `n${i}`,
    label: `Node ${i}`,
    type: 'T',
    weight: i,
  }));
  const links = Array.from({ length: edges }, (_, i) => ({
    source: `n${i % nodes.length}`,
    target: `n${(i * 7) % nodes.length}`,
    predicate: 'rel',
    w: i,
  }));
  return JSON.stringify({ nodes, edges: links });
}

/** Cold (first call, as in the CLI) and warm (JIT-compiled) timings of `run`, in ms. */
function time(run: () => unknown): { cold: number; warm: number; label: string } {
  const measure = () => {
    const start = performance.now();
    run();
    return performance.now() - start;
  };
  const cold = measure();
  const warm = measure();
  return { cold, warm, label: `${cold.toFixed(0)} ms cold, ${warm.toFixed(0)} ms warm` };
}

describe('performance', () => {
  it(`parses ${TRIPLES / 1000}k OWL Turtle triples within the budget`, () => {
    const { text, triples } = owlTurtle(TRIPLES);
    let nodes = 0;
    const ms = time(() => {
      nodes = parseGraph(text, { format: 'turtle' }).graph.nodes.length;
    });
    console.info(`[formats] turtle: ${triples} triples → ${nodes} nodes in ${ms.label}`);
    expect(nodes).toBe(Math.ceil(TRIPLES / 11));
    expect(ms.cold).toBeLessThan(BUDGET_MS * CI_HEADROOM);
  });

  it(`parses ${TRIPLES / 1000}k N-Triples within the budget`, () => {
    const text = nTriples(TRIPLES);
    const ms = time(() => parseGraph(text, { format: 'ntriples' }));
    console.info(`[formats] n-triples: ${TRIPLES} triples in ${ms.label}`);
    expect(ms.cold).toBeLessThan(BUDGET_MS * CI_HEADROOM);
  });

  it('parses a 10k-term OBO file within the budget', () => {
    const text = obo(10_000);
    const ms = time(() => parseGraph(text, { format: 'obo' }));
    console.info(`[formats] obo: 10000 terms (${text.split('\n').length} lines) in ${ms.label}`);
    expect(ms.cold).toBeLessThan(BUDGET_MS * CI_HEADROOM);
  });

  it('parses 50k JSON edges within the budget', () => {
    const text = json(TRIPLES);
    const ms = time(() => parseGraph(text, { format: 'json' }));
    console.info(`[formats] json: ${TRIPLES} edges in ${ms.label}`);
    expect(ms.cold).toBeLessThan(BUDGET_MS * CI_HEADROOM);
  });
});
