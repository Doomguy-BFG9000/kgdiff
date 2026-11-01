# ontology-release · Mini Human Disease Ontology 2026-09-01 → 2026-10-01

Two monthly releases of the **Mini Human Disease Ontology (MHD)**, a small OBO 1.4 ontology written
for these examples. It mirrors how real OBO Foundry ontologies (DO, MONDO, HPO) evolve: terms are
never deleted, they are obsoleted with `replaced_by:` or `consider:` pointers, and every release
mixes structural curation with definition and cross-reference upkeep.

| | 2026-09-01 | 2026-10-01 |
| --- | --- | --- |
| terms (`[Term]`) | 179 | 184 |
| relations (`[Typedef]`) | 3 | 3 |
| edges (`is_a` + `relationship:`) | 351 | 353 |

## What it models

- Three namespaces: `disease` (94 terms: cardiovascular, respiratory, nervous, endocrine,
  digestive, urinary, musculoskeletal, skin and blood diseases, cancer and infections), `anatomy`
  (43 terms, UBERON-like) and `phenotype` (42 terms, HPO-like).
- `is_a` hierarchy plus `relationship: part_of` (anatomy partonomy), `located_in` (disease →
  anatomy) and `has_symptom` (disease → phenotype), each declared in a `[Typedef]` stanza with its
  BFO / RO cross-reference.
- Definitions, EXACT / RELATED synonyms (with an `abbreviation` synonym type), subsets and xrefs to
  DOID, MESH, ICD10CM, ICD11, SNOMEDCT, UBERON and HP.

## Changes 2026-09-01 → 2026-10-01

| Change | Terms | kgdiff reports |
| --- | --- | --- |
| Merge: duplicate obsoleted, `replaced_by` the survivor, synonym + symptom moved over | heart attack `MHD:0000019` → myocardial infarction `MHD:0000018` | merge (hint), source renamed “obsolete …”, deprecated, edges collapsed / carried |
| Merge | chronic obstructive airway disease `MHD:0000032` → COPD `MHD:0000031` | merge (hint) |
| Merge 2 → 1 | juvenile diabetes `MHD:0000064` + insulin-dependent diabetes mellitus `MHD:0000065` → type 1 diabetes mellitus `MHD:0000062` | merge (hint), 2 sources |
| Split (2022 AVP nomenclature): obsoleted with `consider:` two new narrower terms, promoted from its NARROW synonyms | diabetes insipidus `MHD:0000067` → arginine vasopressin deficiency `MHD:0000204` + arginine vasopressin resistance `MHD:0000205` | split (**heuristic**: `consider:` is not a hint; the new labels were synonyms of the old term and the new terms take over its `is_a` / `has_symptom` edges) |
| New small subtree | arginine vasopressin disorder `MHD:0000203` with the two terms above | added |
| New terms (2023 steatotic liver disease nomenclature) | MetALD `MHD:0000201`, cryptogenic steatotic liver disease `MHD:0000202` | added |
| Renames (old name kept as EXACT synonym) | fatty liver disease → steatotic liver disease; NAFLD → MASLD; NASH → MASH; alcoholic → alcohol-related liver disease; Alzheimer's disease → Alzheimer disease | rename + aliases |
| `is_a` moves | tuberculosis (lung disease → bacterial infectious disease), Hashimoto thyroiditis (hypothyroidism → autoimmune thyroid disease), Crohn disease (intestinal disease → inflammatory bowel disease), alcohol-related liver disease (liver disease → steatotic liver disease) | move + hierarchy edge retarget (cause move) |
| Namespace change + move | hyperglycemia `MHD:0000074`: `disease` → `phenotype`, under abnormal blood glucose concentration | attrs (`namespace`, `def`) + move |
| Synonym edits | migraine −RELATED “headache” (broader term, not a synonym); dyspnea +EXACT “shortness of breath”, +RELATED “breathlessness” | aliases |
| Definition edits | asthma (GINA-style wording), chronic kidney disease (KDIGO wording), MASLD, steatotic liver disease, hyperglycemia | attrs (`def`) |
| Xref edits | asthma SNOMED CT edition bump; ICD11 codes for COVID-19, type 1 / type 2 diabetes, CKD | attrs (`xref`) |

Obsoleted terms keep their id and lose their `is_a` / `relationship:` lines (OBO practice), so they
show up as modified nodes with `deprecate`, `rename` (“obsolete …”), `attrs` and, for the merge
sources, `replacement` (`replaced_by` added). Losing parents is part of the obsoletion, not a
`move`. Children of renamed terms are untouched: nothing moves unless it changed.

## Files

- `before.obo`, `after.obo`: OBO 1.4, terms sorted by id, `! name` comments regenerated. `[Typedef]`
  stanzas name the relations; they are not nodes.
- `meta.json`: options `{ "match": { "strategy": "id" }, "hierarchyPredicates": ["is_a"] }`.
- `expected.json`: exact changes. Attribute changes list keys only, because the value shape of OBO
  tags is parser-defined (synonym edits also show up as `attrs.synonyms`, which keeps the scope);
  the split's edges are listed as `uncertain`.

MHD identifiers are fictional. Cross-references point to real vocabularies for realism but are not
curated: do not use this ontology clinically. License: CC0-1.0.
