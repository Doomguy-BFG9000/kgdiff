/**
 * Hand-written graph pairs used by the scenario tests. Each reads like a real change set.
 */
import type { GraphInput, NodeInput } from '@kgdiff/core';

// ─── 1. Enterprise knowledge graph (企业知识图谱) ────────────────────────────────

const enterpriseNodes: NodeInput[] = [
  {
    id: 'Enterprise',
    label: '企业',
    type: 'Class',
    attrs: { 统一社会信用代码: 'string', 注册地址: 'string' },
  },
  { id: 'ListedCompany', label: '上市公司', type: 'Class' },
  { id: 'Person', label: '自然人', type: 'Class' },
  { id: 'LegalRep', label: '法人代表', type: 'Role' },
  { id: 'LegalRepresentative', label: '法定代表人', type: 'Role' },
  { id: 'TopTenShareholders', label: '十大股东', type: 'Role' },
  { id: 'ExecutivePosition', label: '高管任职', type: 'Relation' },
  { id: 'SpotCheck', label: '抽查检查', type: 'Event' },
];

export const enterpriseBefore: GraphInput = {
  meta: { name: 'enterprise-kg', version: '2026.09' },
  nodes: enterpriseNodes,
  edges: [
    { source: 'ListedCompany', predicate: 'rdfs:subClassOf', target: 'Enterprise' },
    { source: 'LegalRep', predicate: 'kg:任职于', target: 'Enterprise' },
    { source: 'LegalRepresentative', predicate: 'kg:任职于', target: 'Enterprise' },
    { source: 'Person', predicate: 'kg:担任', target: 'LegalRep' },
    { source: 'TopTenShareholders', predicate: 'kg:持股', target: 'Enterprise' },
    { source: 'ExecutivePosition', predicate: 'kg:关联', target: 'Person' },
    { source: 'SpotCheck', predicate: 'kg:检查', target: 'Enterprise' },
  ],
};

/** `hint`: 法定代表人 declares that it replaces 法人代表; `heuristic`: it only gains the synonym. */
export function enterpriseAfter(variant: 'hint' | 'heuristic'): GraphInput {
  return {
    meta: { name: 'enterprise-kg', version: '2026.10' },
    nodes: [
      {
        id: 'Enterprise',
        label: '企业',
        type: 'Class',
        attrs: { 统一社会信用代码: 'string', 实缴资本: 'decimal', 经营范围: 'string' },
      },
      { id: 'ListedCompany', label: '上市公司', type: 'Class' },
      { id: 'Person', label: '自然人', type: 'Class' },
      variant === 'hint'
        ? { id: 'LegalRepresentative', label: '法定代表人', type: 'Role', replaces: ['LegalRep'] }
        : { id: 'LegalRepresentative', label: '法定代表人', type: 'Role', aliases: ['法人代表'] },
      { id: 'TopTenShareholders', label: '十大股东', type: 'Role' },
      { id: 'ExecutivePosition', label: '董监高任职', type: 'Relation' },
      { id: 'BeneficialOwner', label: '受益所有人', type: 'Role' },
    ],
    edges: [
      { source: 'ListedCompany', predicate: 'rdfs:subClassOf', target: 'Enterprise' },
      { source: 'LegalRepresentative', predicate: 'kg:任职于', target: 'Enterprise' },
      { source: 'Person', predicate: 'kg:担任', target: 'LegalRepresentative' },
      { source: 'TopTenShareholders', predicate: 'kg:持股', target: 'ListedCompany' },
      { source: 'ExecutivePosition', predicate: 'kg:关联', target: 'Person' },
      { source: 'BeneficialOwner', predicate: 'kg:受益于', target: 'Enterprise' },
      { source: 'Person', predicate: 'kg:认定为', target: 'BeneficialOwner' },
    ],
  };
}

// ─── 2. OBO-style obsoletion ────────────────────────────────────────────────

export const oboBefore: GraphInput = {
  meta: { name: 'go', version: '2026-09-01' },
  nodes: [
    { id: 'GO:0008219', label: 'cell death', attrs: { namespace: 'biological_process' } },
    {
      id: 'GO:0012501',
      label: 'programmed cell death',
      attrs: { namespace: 'biological_process' },
    },
    {
      id: 'GO:0006915',
      label: 'apoptotic process',
      aliases: ['apoptosis'],
      attrs: { namespace: 'biological_process' },
    },
    {
      id: 'GO:0006917',
      label: 'induction of apoptosis',
      attrs: { namespace: 'biological_process' },
    },
  ],
  edges: [
    { source: 'GO:0012501', predicate: 'is_a', target: 'GO:0008219' },
    { source: 'GO:0006915', predicate: 'is_a', target: 'GO:0012501' },
    { source: 'GO:0006917', predicate: 'is_a', target: 'GO:0012501' },
  ],
};

export const oboAfter: GraphInput = {
  meta: { name: 'go', version: '2026-10-01' },
  nodes: [
    { id: 'GO:0008219', label: 'cell death', attrs: { namespace: 'biological_process' } },
    {
      id: 'GO:0012501',
      label: 'programmed cell death',
      attrs: { namespace: 'biological_process' },
    },
    {
      id: 'GO:0006915',
      label: 'apoptotic process',
      aliases: ['apoptosis'],
      attrs: { namespace: 'biological_process' },
    },
    {
      id: 'GO:0006917',
      label: 'obsolete induction of apoptosis',
      deprecated: true,
      replacedBy: ['GO:0006915'],
      attrs: { namespace: 'biological_process' },
    },
  ],
  edges: [
    { source: 'GO:0012501', predicate: 'is_a', target: 'GO:0008219' },
    { source: 'GO:0006915', predicate: 'is_a', target: 'GO:0012501' },
  ],
};

// ─── 3. Hierarchy move ──────────────────────────────────────────────────────

export const taxonomyBefore: GraphInput = {
  nodes: [
    { id: 'Animal', label: 'Animal' },
    { id: 'Mammal', label: 'Mammal' },
    { id: 'Fish', label: 'Fish' },
    { id: 'Whale', label: 'Whale' },
    { id: 'Shark', label: 'Shark' },
  ],
  edges: [
    { source: 'Mammal', predicate: 'rdfs:subClassOf', target: 'Animal' },
    { source: 'Fish', predicate: 'rdfs:subClassOf', target: 'Animal' },
    { source: 'Whale', predicate: 'rdfs:subClassOf', target: 'Fish' },
    { source: 'Shark', predicate: 'rdfs:subClassOf', target: 'Fish' },
  ],
};

export const taxonomyAfter: GraphInput = {
  nodes: taxonomyBefore.nodes,
  edges: [
    { source: 'Mammal', predicate: 'rdfs:subClassOf', target: 'Animal' },
    { source: 'Fish', predicate: 'rdfs:subClassOf', target: 'Animal' },
    { source: 'Whale', predicate: 'rdfs:subClassOf', target: 'Mammal' },
    { source: 'Shark', predicate: 'rdfs:subClassOf', target: 'Fish' },
  ],
};

// ─── 4. LLM extraction with random ids ──────────────────────────────────────

export const extractionBefore: GraphInput = {
  nodes: [
    { id: 'e_91f2', label: 'Marie Curie', type: 'Person' },
    { id: 'e_03aa', label: 'Pierre Curie', type: 'Person' },
    { id: 'e_7c1d', label: 'Univ. of Paris', type: 'Organization' },
    { id: 'e_55b0', label: 'Radium', type: 'Element' },
    { id: 'e_e812', label: 'Nobel Prize in Physics', type: 'Award' },
  ],
  edges: [
    { source: 'e_91f2', predicate: 'spouse', target: 'e_03aa' },
    { source: 'e_91f2', predicate: 'worked at', target: 'e_7c1d' },
    { source: 'e_03aa', predicate: 'worked at', target: 'e_7c1d' },
    { source: 'e_91f2', predicate: 'discovered', target: 'e_55b0' },
    { source: 'e_91f2', predicate: 'won', target: 'e_e812' },
  ],
};

export const extractionAfter: GraphInput = {
  nodes: [
    { id: 'n1', label: 'Marie Skłodowska-Curie', type: 'Person' },
    { id: 'n2', label: 'Pierre Curie', type: 'Person' },
    { id: 'n3', label: 'University of Paris', type: 'Organization' },
    { id: 'n4', label: 'Radium', type: 'Element' },
    { id: 'n5', label: 'Polonium', type: 'Element' },
    { id: 'n6', label: 'Nobel Prize', type: 'Award' },
  ],
  edges: [
    { source: 'n1', predicate: 'spouse', target: 'n2' },
    { source: 'n1', predicate: 'worked at', target: 'n3' },
    { source: 'n2', predicate: 'worked at', target: 'n3' },
    { source: 'n1', predicate: 'discovered', target: 'n4' },
    { source: 'n1', predicate: 'discovered', target: 'n5' },
    { source: 'n1', predicate: 'won', target: 'n6' },
  ],
};

// ─── 5. Predicate change ────────────────────────────────────────────────────

export const employmentBefore: GraphInput = {
  nodes: [
    { id: 'alice', label: 'Alice' },
    { id: 'acme', label: 'ACME Corp' },
  ],
  edges: [{ source: 'alice', predicate: 'schema:worksFor', target: 'acme' }],
};

export const employmentAfter: GraphInput = {
  nodes: employmentBefore.nodes,
  edges: [{ source: 'alice', predicate: 'schema:employedBy', target: 'acme' }],
};

// ─── 6. Split via `replaces` hints ──────────────────────────────────────────

export const partyBefore: GraphInput = {
  nodes: [
    { id: 'Party', label: 'Party', type: 'Class' },
    { id: 'Contract', label: 'Contract', type: 'Class' },
    { id: 'Address', label: 'Address', type: 'Class' },
  ],
  edges: [
    { source: 'Party', predicate: 'signs', target: 'Contract' },
    { source: 'Party', predicate: 'hasAddress', target: 'Address' },
  ],
};

export const partyAfter: GraphInput = {
  nodes: [
    { id: 'NaturalPerson', label: 'Natural person', type: 'Class', replaces: ['Party'] },
    { id: 'LegalEntity', label: 'Legal entity', type: 'Class', replaces: ['Party'] },
    { id: 'Contract', label: 'Contract', type: 'Class' },
    { id: 'Address', label: 'Address', type: 'Class' },
  ],
  edges: [
    { source: 'NaturalPerson', predicate: 'signs', target: 'Contract' },
    { source: 'LegalEntity', predicate: 'hasAddress', target: 'Address' },
    { source: 'LegalEntity', predicate: 'signs', target: 'Contract' },
  ],
};
