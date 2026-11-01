# schema-vocab · schema.org-style vocabulary release

A Turtle slice of a schema.org-style vocabulary: classes (`rdfs:Class`) with `rdfs:subClassOf`,
data types, and properties (`rdf:Property`) with `schema:domainIncludes` / `schema:rangeIncludes`.
Labels are `@en`, with `@zh` labels on most classes; synonyms use `skos:altLabel`. The two releases
are modelled on the kinds of changes schema.org ships (inserting intermediate types, superseding
plural properties), but they are not actual schema.org releases and the comments are original text.

| | vocab-2026.09 | vocab-2026.10 |
| --- | --- | --- |
| terms | 66 (37 classes, 6 data types, 23 properties) | 71 |
| edges | 105 | 112 |

## Changes

| Change | Terms | kgdiff reports |
| --- | --- | --- |
| New intermediate classes and a new subtree | `SocialMediaPosting` (+ `DiscussionForumPosting`), `FoodEstablishment` (+ `CafeOrCoffeeShop`), `VirtualLocation` | added nodes + `rdfs:subClassOf` edges |
| Class moves | `BlogPosting`: `Article` → `SocialMediaPosting`; `Restaurant`: `LocalBusiness` → `FoodEstablishment` | move + hierarchy edge retarget (cause move) |
| Deprecation with replacement (`owl:deprecated true` + `obo:IAO_0100001`) | `Code` → `SoftwareSourceCode`; `employees` → `employee` | merge (hint), deprecate, replacement, comment edit |
| Label changes | `NGO` → “Non-governmental organization” (old label kept as `skos:altLabel`); typo fix “Scholarly artcle” → “Scholarly article” | rename (+ alias) |
| Alias added | `Corporation` +“Company” | aliases |
| Comment edits | `Dataset`, `Event`, `servesCuisine` (+ the two deprecated terms) | attrs (`rdfs:comment`) |
| OWL existential restriction added | `Review rdfs:subClassOf [ a owl:Restriction ; owl:onProperty schema:itemReviewed ; owl:someValuesFrom schema:Thing ]` | added edge `Review –schema:itemReviewed→ Thing` |
| Domain retarget | `servesCuisine` `domainIncludes`: `Restaurant` → `FoodEstablishment` | retarget (cause edit) |
| Range added | `location` `rangeIncludes` +`VirtualLocation` | added edge |

The `@zh` labels never change between the releases, so the result does not depend on how a parser
stores secondary-language labels.

## Files

- `before.ttl`, `after.ttl`: Turtle with `@prefix` declarations (rdf, rdfs, owl, skos, obo, schema).
- `meta.json`: options `{ "match": { "strategy": "id" } }`.
- `expected.json`: exact changes; node ids are full IRIs, predicates compact CURIEs.

License: CC0-1.0.
