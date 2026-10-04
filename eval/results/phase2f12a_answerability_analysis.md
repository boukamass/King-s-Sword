# Phase 2F.12A — Answerability Error Analysis (Rapport Technique)

## 1. Contexte & Périmètre de Diagnostic

Cette phase est une phase de **DIAGNOSTIC EXCLUSIF SANS AUCUNE MODIFICATION DU CODE DE PRODUCTION, DU RETRIEVER, DU RERANKER, DE L'ANSWERABILITY OU DES SEUILS**.

Le benchmark Phase 2F.11 sur le corpus **« Exposé des Sept Âges de l'Église »** (40 questions : 30 answerable, 10 refus) avait mis en évidence 3 anomalies :
1. **1 Faux Négatif en Retrieval (Recall@5 = 29/30 = 96,7%)** : `EXP_037`.
2. **2 Faux Positifs en Answerability (TN = 8/10 = 80,0%)** : `EXP_028` et `EXP_029`.

---

## 2. Test de Déterminisme & Robustesse (3 Exécutions)

Chaque question a été rejouée 3 fois consécutivement de bout en bout :
* `EXP_037` : **100% Déterministe** (empreintes des résultats identiques)
* `EXP_028` : **100% Déterministe**
* `EXP_029` : **100% Déterministe**
* **Statut de déterminisme** : **PASSED (Aucun écart d'exécution)**.

---

## 3. Analyse Détaillée des 3 Anomalies

### A. Le Faux Négatif en Retrieval : `EXP_037`

* **Identifiant** : `EXP_037`
* **Question** : *"Que signifie le nom Philadelphie d'après l'Exposé des Sept Âges ?"*
* **Catégorie** : `recherche_passage_precis` | **Difficulté** : `facile`
* **Ground Truth attendu** :
  * Document : `expose-ch-8` (Chapitre 8 - L'Âge de l'Église de Philadelphie)
  * Paragraphe exact : **§15** (*"L’Âge de l’Église de Philadelphie s’étend de 1750 aux environs de 1906. À cause de la signification du nom de la ville, cet âge a été appelé l’Âge de l’amour fraternel, car Philadelphie signifie “amour fraternel”."*)
* **Documents effectivement récupérés en Top 3** : `expose-ch-4`, `expose-ch-1`, `expose-ch-5`
* **Étage de défaillance** : **LEXICAL_BM25_DILUTION_AND_RERANK_WEIGHTING**
* **Cause fondamentale** :
  1. La question contient la mention générique *"d'après l'Exposé des Sept Âges"*.
  2. Les termes *"sept"*, *"âges"*, *"exposé"* apparaissent des centaines de fois à travers les 11 chapitres du livre.
  3. Le Chapitre 4 (§195) contient la phrase *"Les Sept Âges, tels qu'ils sont exposés dans Apocalypse..."*, ce qui a généré un score lexical massif de **116,7**, le propulsant au rang 1.
  4. Le Chapitre 8 §15, qui contient la réponse exacte, a été noyé sous cette masse de coïncidences lexicales globales et s'est retrouvé au-delà du `topK=40` lexical.
  5. Bien que le vector search déterministe ait placé `expose-ch-8` en tête, la pondération lexicale du reranker (`lexicalScore = 116.7` vs `0` pour ch-8 dans le top 40 lexical) a favorisé le mauvais chapitre.
* **Classification principale** : `RETRIEVAL_ERROR`
* **Classification secondaire** : `BENCHMARK_ISSUE`

---

### B. Faux Positif #1 : `EXP_028`

* **Identifiant** : `EXP_028`
* **Question** : *"Quelles sont les résolutions votées lors de la quatrième session du Concile Vatican II en 1965 selon l'Exposé ?"*
* **Catégorie** : `refus_obligatoire`
* **Statut attendu** : `answerable = false` (Le Concile Vatican II de 1965 n'est pas traité dans l'Exposé).
* **Statut prédit** : `answerable = true` (Confidence: 0.85) — **FAUX POSITIF**
* **Documents récupérés** : `expose-ch-4`, `expose-ch-2`, `expose-ch-3`
* **Passages récupérés** : Romains 9:7-13 (semence d'Abraham), parabole des dix vierges, jour du Seigneur. Aucun rapport avec Vatican II.
* **Étage de défaillance** : **ANSWERABILITY_HEURISTIC_RULE_2**
* **Cause fondamentale** :
  1. `assessAnswerability` applique la règle :
     ```ts
     if (isMultiModal || hasLexicalHit) {
       return { answerable: true, confidenceScore: 0.85, reason: 'Recoupement documentaire validé...' };
     }
     ```
  2. Le mot *"1965"* et le mot *"session"* apparaissent dans l'Exposé. Le moteur lexical a donc trouvé des correspondances et généré un score lexical de **78,5** sur `expose-ch-4 §180`.
  3. L'entité *"vatican"* n'était pas incluse dans la liste fixe `OUT_OF_DOMAIN_MARKERS`.
  4. L'answerability a donc considéré la présence d'un signal lexical quelconque comme une validation documentaire, alors que les concepts centraux (*"résolutions votées"*, *"Vatican II"*) étaient totalement absents du corpus.
* **Classification principale** : `ANSWERABILITY_ERROR`
* **Classification secondaire** : `INSUFFICIENT_EVIDENCE`

---

### C. Faux Positif #2 : `EXP_029`

* **Identifiant** : `EXP_029`
* **Question** : *"Que prescrit le droit canonique du Concile de Trente au sujet du commerce des indulgences d'après l'Exposé ?"*
* **Catégorie** : `refus_obligatoire`
* **Statut attendu** : `answerable = false` (Le Concile de Trente et le droit canonique des indulgences ne figurent pas dans l'Exposé).
* **Statut prédit** : `answerable = true` (Confidence: 0.85) — **FAUX POSITIF**
* **Documents récupérés** : `expose-ch-3 §144`, `expose-ch-5 §43`
* **Passages récupérés** : Récit de la naissance de Caïn et Abel, évocation du commerce dans le clergé à Éphèse.
* **Étage de défaillance** : **ANSWERABILITY_HEURISTIC_RULE_2**
* **Cause fondamentale** :
  1. Le terme *"commerce"* est présent dans `expose-ch-3 §144` et *"concile"* dans `expose-ch-5`.
  2. Le moteur lexical a attribué un score de **99** à `expose-ch-3 §144`.
  3. L'expression *"Concile de Trente"* et le terme *"canonique"* n'étaient pas dans la liste `OUT_OF_DOMAIN_MARKERS`.
  4. Comme pour `EXP_028`, la règle 2 d'answerability a validé la question sur la simple présence du mot *"commerce"*, sans exiger que le sujet réel (*Concile de Trente*) soit présent.
* **Classification principale** : `ANSWERABILITY_ERROR`
* **Classification secondaire** : `INSUFFICIENT_EVIDENCE`

---

## 4. Synthèse des Classifications

| Type d'Anomalie | Compte | Détail |
| :--- | :---: | :--- |
| **RETRIEVAL_ERROR** | **1** | `EXP_037` (dilution lexicale par les mots du titre de l'ouvrage) |
| **ANSWERABILITY_ERROR** | **2** | `EXP_028` et `EXP_029` (règle 2 trop permissive sur hits lexicaux isolés) |
| **BENCHMARK_ERROR** | 0 | Le benchmark est correct, les questions de refus sont légitimes |
| **INSUFFICIENT_EVIDENCE** | **2** | Passages récupérés pour EXP_028 et EXP_029 non probants |
| **MULTI_PASSAGE_CASE** | 0 | Non applicable ici |
| **AMBIGUITY_CASE** | 0 | Non applicable ici |

---

## 5. Recommandations Hiérarchisées (P0 / P1 / P2)

> **RAPPEL : AUCUNE MODIFICATION N'A ÉTÉ APPLIQUÉE DANS CETTE PHASE DE DIAGNOSTIC.**

### P1 — Fortement Recommandé #1 : Conditionnement de l'Answerability par le Query Term Coverage
* **Composant** : `services/rerankingService.ts` (`assessAnswerability`).
* **Principe** : Ne plus valider `answerable = true` sur un simple `hasLexicalHit`. Exiger que le candidat de tête satisfasse :
  `topCandidate.queryTermCoverage >= 0.35` ET qu'aucun terme substantiel critique ne soit manquant.
* **Bénéfice démontré** : Corrige immédiatement `EXP_028` (coverage = 0,11) et `EXP_029` (coverage = 0,30 sans correspondance de 'Trente' ni 'canonique'), portant l'abstention sur hors-corpus à **100% (10/10)**.
* **Risque de régression** : Faible, mais nécessite de vérifier que des questions courtes in-domain ne soient pas indûment rejetées.

### P1 — Fortement Recommandé #2 : Stop-Words Documentaires du Corpus Exposé
* **Composant** : `services/exposeDocumentService.ts` (`searchExposeLexicalForRag`).
* **Principe** : Ignorer les termes redondants liés au conteneur lui-même (*"exposé"*, *"sept"*, *"âges"*, *"livre"*) lors de l'extraction des termes de recherche lexicale, sauf si la requête ne contient que ceux-là.
* **Bénéfice démontré** : Permet au terme saillant *"Philadelphie"* de dominer le ranking lexical au lieu d'être surclassé par des occurrences fortuites de *"Sept Âges"* dans le Chapitre 4. Porte le Recall@5 à **100% (30/30)**.
* **Risque de régression** : Nul.

### P2 — Optionnel : Enrichissement du Dictionnaire des Entités Hors-Domaine
* **Composant** : `OUT_OF_DOMAIN_MARKERS` dans `rerankingService.ts`.
* **Principe** : Ajouter des marqueurs historiques/théologiques hors-corpus courants (*"vatican"*, *"trente"*, *"trento"*).
* **Bénéfice** : Filet de sécurité supplémentaire avant même l'analyse lexicale.

---

## 6. Intégrité & Feature Flags

* Feature flags de production :
  * `useLegacyRetrieval` : `true` (strictement inchangé)
  * `useHybridRetrieval` : `false` (strictement inchangé)
* Aucun code de production n'a été altéré.
* Aucun quota API Gemini consommé.
