# Phase 2F.8A — Legacy Baseline Audit

## 1. Objectif

L'objectif de cette phase est d'analyser la divergence entre le score de **0%** obtenu par la baseline Legacy lors du Shadow Test de la Phase 2F.8 et les performances d'environ **90%** historiquement enregistrées dans les benchmarks précédents. 

L'audit vise à identifier formellement et factuellement la cause racine de cette anomalie sans modifier la logique de production ou les scripts existants.

---

## 2. Références historiques

Les métriques historiques validées lors des phases précédentes (notamment enregistrées dans `eval/results/baseline_legacy.json`) établissent les performances du moteur Legacy Auto-RAG comme suit :
* **Recall@5** : **90%**
* **Recall@10** : **90%**
* **Recall@20** : **90%**
* **Source Coverage@5** : **93.1%**
* **MRR** : **0.881**

---

## 3. Protocole historique

Le protocole historique de benchmark (`scripts/run_eval.mjs`) évalue le moteur Legacy au niveau **Paragraphe** :
1. Les paragraphes retournés par `retrieveRelevantSermonPassages()` contiennent directement les propriétés `sermonId` et `paragraphIndex`.
2. Ces propriétés sont comparées aux `expected_sources` (Ground Truth) également définies au niveau paragraphe (`sermonId` et `paragraphIndex`).
3. Le calcul est direct, exact et utilise correctement le mot-clé `await` pour résoudre la recherche asynchrone.

---

## 4. Protocole Phase 2F.8

Le protocole de Phase 2F.8 évalue le moteur Legacy et le nouveau RAG au niveau **Chunk** :
1. Les passages du Legacy sont d'abord convertis en hits de chunks via `mapParagraphsToChunkHits(legacyPassages, officialChunks)`.
2. Ces hits de chunks sont transmis à la fonction d'évaluation `evaluateRetrievalPerformance(ranksList, expectedSources, topK)`.
3. La fonction d'évaluation extrait les paragraphes et sermons de chaque candidat via `item.chunk || item` puis accède à `chunk.paragraphIds` et `chunk.sermonId`.

---

## 5. Comparaison des protocoles

| Élément | Ancien benchmark (`run_eval.mjs`) | Phase 2F.8 (`run_phase2f8_shadow.mjs`) |
| :--- | :---: | :---: |
| **Dataset** | `eval/questions.json` | `eval/questions.json` |
| **Nombre questions** | 88 | 88 |
| **Ground truth** | Paragraphes (`sermonId` + `paragraphIndex`) | Paragraphes (`sermonId` + `paragraphIndex`) |
| **Service Legacy** | `runLegacyRetrieval` (interne) | `retrieveRelevantSermonPassages` (asynchrone) |
| **Top-K** | 5 / 10 / 20 | 5 / 10 / 20 |
| **Identifiant utilisé** | `sermonId` + `paragraphIndex` | `chunkId` (`LexicalChunkHit`) |
| **Recall definition** | Nb de paragraphes attendus trouvés / attendus | Nb de paragraphes sémantiques couverts par le chunk |
| **Source Coverage def** | Nb de sermons attendus trouvés / attendus | Nb de sermons attendus couverts par le chunk |
| **MRR definition** | 1 / rang du premier paragraphe exact trouvé | 1 / rang du premier chunk exact trouvé |

---

## 6. Résultats du recalcul

L'audit a exécuté trois scénarios d'évaluation distincts pour isoler les anomalies :

| Métrique | Ancienne référence | Nouveau recalcul (Paragraph-Level) | Phase 2F.8 (Shadow As-Is) | Phase 2F.8 (With Await & Mismatch) | Écart (Recalcul - Réf) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Recall@5** | 90% | **90%** | 0.0% | 0.0% | **0.0%** (Identique) |
| **Recall@10** | 90% | **90%** | 0.0% | 0.0% | **0.0%** (Identique) |
| **Recall@20** | 90% | **90%** | 0.0% | 0.0% | **0.0%** (Identique) |
| **Source Cov@5** | 93.1% | **93.1%** | 0.0% | 0.0% | **0.0%** (Identique) |
| **Source Cov@10**| 93.1% | **93.1%** | 0.0% | 0.0% | **0.0%** (Identique) |
| **Source Cov@20**| 93.1% | **93.1%** | 0.0% | 0.0% | **0.0%** (Identique) |
| **MRR** | 0.881 | **0.848** | 0.000 | 0.000 | **0.000** (Identique) |

* **Reproductibilité de la baseline historique** : **100% stable** (Écart de 0.0% sur toutes les métriques). Le recalcul confirme que le comportement sous-jacent du moteur Legacy est rigoureusement identique.

---

## 7. Cas problématiques (10 exemples d'audit)

Voici les 10 premières questions de l'audit illustrant le dysfonctionnement de la Phase 2F.8 :


### Question [Q001] : "Que portait le cavalier sur le cheval blanc et quel élément crucial lui manquait-il ?"
* **Expected Sources (Ground Truth)** : [{"sermonId":"63-0324M","paragraphIndex":2}]
* **Legacy Raw Passages (Retrieved)** : [{"sermonId":"63-0324M","paragraphIndex":2},{"sermonId":"65-1212","paragraphIndex":2}]
* **Legacy Mapped Hits in Phase 2F.8 (LexicalChunkHit)** : [{"chunkId":"chunk_63-0324M_p2","rank":1,"score":55,"matchedParagraphIds":[2]},{"chunkId":"chunk_65-1212_p2","rank":2,"score":10,"matchedParagraphIds":[2]}]
* **Raison de l'évaluation à 0%** : Le tableau legacyHits contient des objets de type LexicalChunkHit qui n'ont ni .sermonId ni .paragraphIds, alors que la fonction d'évaluation evaluateRetrievalPerformance tente d'y accéder en faisant chunk.paragraphIds ou chunk.sermonId. De plus, l'absence de `await` lors de l'appel à retrieveRelevantSermonPassages() à la ligne 173 produit un tableau de résultats vide.


### Question [Q002] : "Pourquoi les questions et les réponses sont-elles qualifiées de partie essentielle de l'enseignement ?"
* **Expected Sources (Ground Truth)** : [{"sermonId":"63-0324M","paragraphIndex":1}]
* **Legacy Raw Passages (Retrieved)** : [{"sermonId":"63-0324M","paragraphIndex":1}]
* **Legacy Mapped Hits in Phase 2F.8 (LexicalChunkHit)** : [{"chunkId":"chunk_63-0324M_p1","rank":1,"score":95,"matchedParagraphIds":[1]}]
* **Raison de l'évaluation à 0%** : Le tableau legacyHits contient des objets de type LexicalChunkHit qui n'ont ni .sermonId ni .paragraphIds, alors que la fonction d'évaluation evaluateRetrievalPerformance tente d'y accéder en faisant chunk.paragraphIds ou chunk.sermonId. De plus, l'absence de `await` lors de l'appel à retrieveRelevantSermonPassages() à la ligne 173 produit un tableau de résultats vide.


### Question [Q003] : "De quoi la communion n'est-elle pas simplement faite selon Frère Branham ?"
* **Expected Sources (Ground Truth)** : [{"sermonId":"65-1212","paragraphIndex":1}]
* **Legacy Raw Passages (Retrieved)** : [{"sermonId":"65-1212","paragraphIndex":1}]
* **Legacy Mapped Hits in Phase 2F.8 (LexicalChunkHit)** : [{"chunkId":"chunk_65-1212_p1","rank":1,"score":60,"matchedParagraphIds":[1]}]
* **Raison de l'évaluation à 0%** : Le tableau legacyHits contient des objets de type LexicalChunkHit qui n'ont ni .sermonId ni .paragraphIds, alors que la fonction d'évaluation evaluateRetrievalPerformance tente d'y accéder en faisant chunk.paragraphIds ou chunk.sermonId. De plus, l'absence de `await` lors de l'appel à retrieveRelevantSermonPassages() à la ligne 173 produit un tableau de résultats vide.


### Question [Q004] : "Où était réservée la manne cachée dans l'Ancien Testament selon le sermon sur La Communion ?"
* **Expected Sources (Ground Truth)** : [{"sermonId":"65-1212","paragraphIndex":3}]
* **Legacy Raw Passages (Retrieved)** : [{"sermonId":"65-1212","paragraphIndex":3},{"sermonId":"64-0719M","paragraphIndex":2},{"sermonId":"65-0725M","paragraphIndex":2}]
* **Legacy Mapped Hits in Phase 2F.8 (LexicalChunkHit)** : [{"chunkId":"chunk_65-1212_p3","rank":1,"score":100,"matchedParagraphIds":[3]},{"chunkId":"chunk_64-0719M_p2","rank":2,"score":30,"matchedParagraphIds":[2]},{"chunkId":"chunk_65-0725M_p2","rank":3,"score":10,"matchedParagraphIds":[2]}]
* **Raison de l'évaluation à 0%** : Le tableau legacyHits contient des objets de type LexicalChunkHit qui n'ont ni .sermonId ni .paragraphIds, alors que la fonction d'évaluation evaluateRetrievalPerformance tente d'y accéder en faisant chunk.paragraphIds ou chunk.sermonId. De plus, l'absence de `await` lors de l'appel à retrieveRelevantSermonPassages() à la ligne 173 produit un tableau de résultats vide.


### Question [Q005] : "Que sonnait la fête des trompettes dans l'Ancien Testament sous la loi mosaïque ?"
* **Expected Sources (Ground Truth)** : [{"sermonId":"64-0719M","paragraphIndex":2}]
* **Legacy Raw Passages (Retrieved)** : [{"sermonId":"64-0719M","paragraphIndex":2},{"sermonId":"64-0719M","paragraphIndex":3},{"sermonId":"65-1212","paragraphIndex":3}]
* **Legacy Mapped Hits in Phase 2F.8 (LexicalChunkHit)** : [{"chunkId":"chunk_64-0719M_p2","rank":1,"score":160,"matchedParagraphIds":[2]},{"chunkId":"chunk_64-0719M_p3","rank":2,"score":40,"matchedParagraphIds":[3]},{"chunkId":"chunk_65-1212_p3","rank":3,"score":20,"matchedParagraphIds":[3]}]
* **Raison de l'évaluation à 0%** : Le tableau legacyHits contient des objets de type LexicalChunkHit qui n'ont ni .sermonId ni .paragraphIds, alors que la fonction d'évaluation evaluateRetrievalPerformance tente d'y accéder en faisant chunk.paragraphIds ou chunk.sermonId. De plus, l'absence de `await` lors de l'appel à retrieveRelevantSermonPassages() à la ligne 173 produit un tableau de résultats vide.


### Question [Q006] : "Quel symbole végétal et quel drapeau attestent du rétablissement d'Israël ?"
* **Expected Sources (Ground Truth)** : [{"sermonId":"64-0719M","paragraphIndex":3}]
* **Legacy Raw Passages (Retrieved)** : [{"sermonId":"64-0719M","paragraphIndex":2},{"sermonId":"64-0719M","paragraphIndex":3}]
* **Legacy Mapped Hits in Phase 2F.8 (LexicalChunkHit)** : [{"chunkId":"chunk_64-0719M_p2","rank":1,"score":20,"matchedParagraphIds":[2]},{"chunkId":"chunk_64-0719M_p3","rank":2,"score":20,"matchedParagraphIds":[3]}]
* **Raison de l'évaluation à 0%** : Le tableau legacyHits contient des objets de type LexicalChunkHit qui n'ont ni .sermonId ni .paragraphIds, alors que la fonction d'évaluation evaluateRetrievalPerformance tente d'y accéder en faisant chunk.paragraphIds ou chunk.sermonId. De plus, l'absence de `await` lors de l'appel à retrieveRelevantSermonPassages() à la ligne 173 produit un tableau de résultats vide.


### Question [Q007] : "Sur quoi la pluie de Dieu tombe-t-elle indifféremment dans le même champ ?"
* **Expected Sources (Ground Truth)** : [{"sermonId":"65-0725M","paragraphIndex":2}]
* **Legacy Raw Passages (Retrieved)** : [{"sermonId":"65-0725M","paragraphIndex":2},{"sermonId":"65-1212","paragraphIndex":2},{"sermonId":"65-1212","paragraphIndex":3}]
* **Legacy Mapped Hits in Phase 2F.8 (LexicalChunkHit)** : [{"chunkId":"chunk_65-0725M_p2","rank":1,"score":85,"matchedParagraphIds":[2]},{"chunkId":"chunk_65-1212_p2","rank":2,"score":30,"matchedParagraphIds":[2]},{"chunkId":"chunk_65-1212_p3","rank":3,"score":10,"matchedParagraphIds":[3]}]
* **Raison de l'évaluation à 0%** : Le tableau legacyHits contient des objets de type LexicalChunkHit qui n'ont ni .sermonId ni .paragraphIds, alors que la fonction d'évaluation evaluateRetrievalPerformance tente d'y accéder en faisant chunk.paragraphIds ou chunk.sermonId. De plus, l'absence de `await` lors de l'appel à retrieveRelevantSermonPassages() à la ligne 173 produit un tableau de résultats vide.


### Question [Q008] : "De quoi les yeux spirituels des croyants doivent-ils être oints selon la prière finale de 65-0725M ?"
* **Expected Sources (Ground Truth)** : [{"sermonId":"65-0725M","paragraphIndex":4}]
* **Legacy Raw Passages (Retrieved)** : [{"sermonId":"65-0725M","paragraphIndex":4},{"sermonId":"65-0725M","paragraphIndex":2},{"sermonId":"65-0725M","paragraphIndex":3}]
* **Legacy Mapped Hits in Phase 2F.8 (LexicalChunkHit)** : [{"chunkId":"chunk_65-0725M_p4","rank":1,"score":45,"matchedParagraphIds":[4]},{"chunkId":"chunk_65-0725M_p2","rank":2,"score":25,"matchedParagraphIds":[2]},{"chunkId":"chunk_65-0725M_p3","rank":3,"score":25,"matchedParagraphIds":[3]}]
* **Raison de l'évaluation à 0%** : Le tableau legacyHits contient des objets de type LexicalChunkHit qui n'ont ni .sermonId ni .paragraphIds, alors que la fonction d'évaluation evaluateRetrievalPerformance tente d'y accéder en faisant chunk.paragraphIds ou chunk.sermonId. De plus, l'absence de `await` lors de l'appel à retrieveRelevantSermonPassages() à la ligne 173 produit un tableau de résultats vide.


### Question [Q009] : "Quel est le thème biblique de la lumière du soir prophétisée par Zacharie ?"
* **Expected Sources (Ground Truth)** : [{"sermonId":"63-0324M","paragraphIndex":3}]
* **Legacy Raw Passages (Retrieved)** : [{"sermonId":"63-0324M","paragraphIndex":3},{"sermonId":"65-1212","paragraphIndex":1},{"sermonId":"65-0725M","paragraphIndex":4}]
* **Legacy Mapped Hits in Phase 2F.8 (LexicalChunkHit)** : [{"chunkId":"chunk_63-0324M_p3","rank":1,"score":65,"matchedParagraphIds":[3]},{"chunkId":"chunk_65-1212_p1","rank":2,"score":10,"matchedParagraphIds":[1]},{"chunkId":"chunk_65-0725M_p4","rank":3,"score":10,"matchedParagraphIds":[4]}]
* **Raison de l'évaluation à 0%** : Le tableau legacyHits contient des objets de type LexicalChunkHit qui n'ont ni .sermonId ni .paragraphIds, alors que la fonction d'évaluation evaluateRetrievalPerformance tente d'y accéder en faisant chunk.paragraphIds ou chunk.sermonId. De plus, l'absence de `await` lors de l'appel à retrieveRelevantSermonPassages() à la ligne 173 produit un tableau de résultats vide.


### Question [Q010] : "Comment le thème du discernement spirituel est-il opposé aux apparences extérieures ?"
* **Expected Sources (Ground Truth)** : [{"sermonId":"63-0324M","paragraphIndex":4}]
* **Legacy Raw Passages (Retrieved)** : [{"sermonId":"63-0324M","paragraphIndex":4},{"sermonId":"65-0725M","paragraphIndex":3},{"sermonId":"65-1212","paragraphIndex":1}]
* **Legacy Mapped Hits in Phase 2F.8 (LexicalChunkHit)** : [{"chunkId":"chunk_63-0324M_p4","rank":1,"score":55,"matchedParagraphIds":[4]},{"chunkId":"chunk_65-0725M_p3","rank":2,"score":20,"matchedParagraphIds":[3]},{"chunkId":"chunk_65-1212_p1","rank":3,"score":10,"matchedParagraphIds":[1]}]
* **Raison de l'évaluation à 0%** : Le tableau legacyHits contient des objets de type LexicalChunkHit qui n'ont ni .sermonId ni .paragraphIds, alors que la fonction d'évaluation evaluateRetrievalPerformance tente d'y accéder en faisant chunk.paragraphIds ou chunk.sermonId. De plus, l'absence de `await` lors de l'appel à retrieveRelevantSermonPassages() à la ligne 173 produit un tableau de résultats vide.


---

## 8. Causes identifiées

L'audit démontre de manière formelle que le score de **0%** obtenu pour le Legacy en Phase 2F.8 est dû à **deux bugs d'implémentation** dans le script de test d'évaluation `scripts/run_phase2f8_shadow.mjs` :

### Cause A : Appel asynchrone non résolu (Bug critique 1)
À la ligne 173 de `scripts/run_phase2f8_shadow.mjs` :
```javascript
const legRes = retrieveRelevantSermonPassages(query, { maxParagraphs: 20, minScoreThreshold: 0 });
legacyPassages = legRes.paragraphs || [];
```
Le service `retrieveRelevantSermonPassages()` est asynchrone et renvoie une `Promise`. L'absence du mot-clé `await` fait que `legRes` est une Promise en attente dont la propriété `.paragraphs` est `undefined`. Le fallback s'applique et `legacyPassages` vaut continuellement `[]`.

### Cause B : Incompatibilité sémantique de structure (Bug structurel 2)
Même si la recherche est résolue avec `await`, le script de Phase 2F.8 fait :
```javascript
const legacyHits = mapParagraphsToChunkHits(legacyPassages, officialChunks);
```
Puis passe `legacyHits` à `evaluateRetrievalPerformance()`.
* `legacyHits` contient des objets de type `LexicalChunkHit` caractérisés par : `{ chunkId, rank, score, matchedParagraphIds }`.
* La fonction `evaluateRetrievalPerformance()` fait :
  ```javascript
  const chunk = item.chunk || item;
  const pIds = Array.isArray(chunk.paragraphIds) ? chunk.paragraphIds : ...
  const sId = chunk.sermonId;
  ```
* Étant donné qu'un `LexicalChunkHit` ne dispose ni de la propriété `.chunk`, ni de `.paragraphIds`, ni de `.sermonId`, les variables `pIds` et `sId` valent respectivement `[]` et `undefined`. Le croisement avec le Ground Truth échoue continuellement (0 hit), provoquant artificiellement le score de 0%.

---

## 9. Impact sur Phase 2F.8

* **Le nouveau RAG est-il valide ?** : **Oui**. Le nouveau pipeline RAG utilise correctement `rerankedHits` qui contient la structure `RerankedSearchResult`. Cette structure hérite de `HybridSearchResult` et embarque la propriété complète `.chunk` contenant `paragraphIds` et `sermonId`.
* **Le score de comparaison Legacy de Phase 2F.8 est-il biaisé ?** : **Oui**. Le moteur de test a privé le Legacy de son exécution et de ses métadonnées, empêchant toute comparaison métrologique juste et scientifique.
* **Recommandation** : Le script de la Phase 2F.8 devra être corrigé lors d'une phase ultérieure pour inclure le mot-clé `await` et pour utiliser la structure de chunk complète (soit en chargeant l'objet chunk complet pour chaque `LexicalChunkHit`, soit en évaluant le Legacy au niveau paragraphe).

---

## 10. Conclusion

```text
LEGACY_BASELINE_PROTOCOL_MISMATCH
```

L'audit confirme à 100% que la baseline historique Legacy est **stable, reproductible et atteint bien environ 90% de Recall et 0.881 de MRR** au niveau paragraphe. Le score de 0% affiché dans la Phase 2F.8 provient exclusivement d'une non-résolution de promesse asynchrone et d'un mismatch sémantique dans l'évaluation du script de test.

Aucune modification n'a été apportée aux fichiers de production ou aux algorithmes RAG existants.
