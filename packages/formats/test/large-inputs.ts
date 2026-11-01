/**
 * Generated inputs at the size of the parsing budget (docs: "50k triples < 1 s"), shared by
 * performance.test.ts and performance.bench.ts.
 */

export const TRIPLES = 50_000;

/** OWL-flavoured Turtle: 11 triples per class (labels, literals, hierarchy, a restriction). */
export function owlTurtle(triples: number): { text: string; triples: number } {
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

export function nTriples(triples: number): string {
  const lines: string[] = [];
  for (let i = 0; i < triples / 2; i++) {
    lines.push(
      `<https://example.org/n/${i}> <http://www.w3.org/2000/01/rdf-schema#label> "node ${i}" .`,
      `<https://example.org/n/${i}> <https://example.org/p/next> <https://example.org/n/${(i + 1) % 1000}> .`,
    );
  }
  return lines.join('\n');
}

export function obo(terms: number): string {
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

export function json(edges: number): string {
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
