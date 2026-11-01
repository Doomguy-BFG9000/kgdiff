# llm-extraction · two LLM extraction runs over the same article

GraphRAG pipelines and agent memories re-extract knowledge graphs all the time. This dataset holds
two runs of the same LLM entity / relation extractor over the short article below. Node ids are
minted per run (`e_3f9a`), so ids say nothing about identity: kgdiff has to align the runs by
similarity (`{ "match": { "strategy": "similarity" } }`).

| | run A | run B |
| --- | --- | --- |
| nodes | 39 | 40 |
| edges | 55 | 59 |

## Source article

> **Marie Curie and the discovery of radioactivity**
>
> Maria Skłodowska was born in Warsaw, then part of the Russian-ruled Kingdom of Poland, in 1867.
> Barred from the city's university, she studied at the clandestine Flying University before moving
> to Paris in 1891 to read physics and mathematics at the University of Paris, often simply called
> the Sorbonne. There she met Pierre Curie, a physicist teaching at the École supérieure de physique
> et de chimie industrielles (ESPCI); they married in July 1895.
>
> Wilhelm Röntgen's discovery of X-rays in 1895 led Henri Becquerel to find, a year later, that
> uranium salts emit penetrating “uranic rays”. Marie Curie chose these rays as her doctoral subject.
> Using a sensitive electrometer built by Pierre and his brother Jacques, she showed that the
> emission depended only on the amount of uranium, found that thorium emitted the same kind of rays,
> and coined the word “radioactivity”.
>
> Working in a converted shed at ESPCI with tonnes of pitchblende residue from the mines of
> St. Joachimsthal in Bohemia, the Curies announced polonium, named after Marie's homeland, in July
> 1898, and radium in December 1898, the latter together with Gustave Bémont. Both discoveries were
> reported to the French Academy of Sciences. In 1903 Marie defended her thesis, *Recherches sur les
> substances radioactives*, under Gabriel Lippmann, and shared the Nobel Prize in Physics with Pierre
> and Becquerel.
>
> After Pierre's death in Paris in 1906 she took over his chair, becoming the first woman to teach
> at the Univ. of Paris. With André-Louis Debierne she isolated radium metal in 1910, and in 1911
> she received the Nobel Prize in Chemistry. She founded the Radium Institute in Paris in 1914 and,
> during the First World War, equipped mobile radiography units, the “petites Curies”. Her daughters
> were Irène, who shared the 1935 Nobel Prize in Chemistry with her husband Frédéric Joliot for the
> discovery of artificial radioactivity, and the writer Ève Curie. Marie Curie died of aplastic
> anemia at a sanatorium in Passy, Haute-Savoie, in 1934; in 1995 her remains were moved to the
> Panthéon.

## Differences between the runs

| Kind | Run A | Run B | kgdiff reports |
| --- | --- | --- | --- |
| Label variants (37 matched pairs; 21 relabelled, 13 differ only by their id and are unchanged) | Marie Curie · Univ. of Paris · polonium (Po) · radium (Ra) · ESPCI · St. Joachimsthal · First World War · Henri Becquerel · Irène Joliot-Curie · aplastic anemia · uranic rays · petites Curies … | Marie Skłodowska-Curie · University of Paris · Polonium · Radium · École supérieure de physique et de chimie industrielles · Jáchymov · World War I · Antoine Henri Becquerel · Irene Joliot-Curie · aplastic anaemia · Becquerel rays · mobile radiography units … | similarity match (no `rekey`: ids are meaningless under `similarity`) + `rename`, `aliases` |
| Hallucination | Albert Einstein, and Marie –collaborated_with→ Einstein | — | removed node + edge |
| Missed by run A | — | Gustave Bémont (co-discovered radium), French Academy of Sciences (where both discoveries were announced) | added nodes + 4 edges |
| Ambiguous pair | pitchblende | uraninite (pitchblende) | **suggestion** (below threshold, score ≈ 0.70); nodes stay removed / added; radium –extracted_from→ is retargeted to uraninite, the mined_in statements are a removed + an added edge |
| Retarget | Marie –born_in→ Poland | Marie –born_in→ Warsaw | edge retarget |
| Predicate change | Marie –worked_at→ ESPCI | Marie –affiliated_with→ ESPCI | predicate |
| Wrong relation dropped | Pierre –discovered→ thorium | — | removed edge |
| New relations | — | thorium –exhibits→ radioactivity; Irène –awarded→ Nobel Prize in Chemistry (1935); polonium –isolated_from→ uraninite | added edges |
| Edge attribute | married_to `{ year: 1895 }` | married_to `{ year: 1895, date: "1895-07-26" }` | edge attrs |
| Type drift | radioactivity, artificial radioactivity: `Concept` | `Phenomenon` | types |
| Attribute drift | Marie Curie nationality `Polish` | `Polish-French` | attrs |

Every accepted match scores ≥ 0.85 on label, type and attributes alone (most label variants are
rescued by the aliases the extractor emits), so the result does not depend on neighbour
propagation. pitchblende ↔ uraninite (pitchblende) is ambiguous on purpose — pitchblende is a
variety of uraninite — and should be offered to the reviewer, not applied.

## Files

- `before.json` (run A), `after.json` (run B): kgdiff native JSON; run B lists entities in a
  different order, as a second LLM call would.
- `meta.json`: options `{ "match": { "strategy": "similarity" } }`.
- `expected.json`: exact matches, renames, edge changes and the suggestion; `legend` maps the random
  ids of both runs back to readable entity keys.

The article is original text written for this dataset. License: CC0-1.0.
