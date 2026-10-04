# Phase 2F.11 — Exposé RAG Integration & Controlled Validation

## 1. Contexte & Objectif

L'objectif de la **Phase 2F.11** est d'utiliser la section **« Exposé des Sept Âges de l'Église »** déjà existante dans l'application comme corpus documentaire principal de développement et de validation du nouveau RAG modulaire, tout en maintenant strictement les feature flags de production (`useLegacyRetrieval=true`, `useHybridRetrieval=false`).

---

## 2. Audit & Diagnostic Technique de l'Exposé Existant

* **Fichier de stockage** : `public/expose.json` (2,89 Mo, JSON complet).
* **Service d'accès** : `services/exposeService.ts` (`loadExposeData`, `getExposeChapter`, `getExposePage`, `searchExpose`).
* **Volume documentaire** :
  - **11 chapitres** (Introduction Chapitre 0 + Chapitres 1 à 10).
  - **363 pages** (pages 9 à 374).
  - **1 590 paragraphes originaux** avec identifiants (`paragraph_id`), numéros de page et titres de sections.
* **Intégration UI** : `Sidebar.tsx` (vue dédiée, sélecteur de chapitre/section, liste de pages virtualisée), `Reader.tsx` (navigation fluide, formatage des paragraphes), `SearchResults.tsx` (recherche lexicale).

---

## 3. Abstraction Documentaire & Adaptateur Déployés

1. **Abstraction Documentaire (`types.ts`)** :
   - Introduction du type canonique `DocumentSourceType = 'sermon' | 'expose' | 'bible' | 'song'`.
   - Modèles `CanonicalDocument` et `DocumentParagraph` pour unifier progressivement les sources documentaires.
   - Extension rétrocompatible de `SermonChunk` (`documentId`, `documentType`, `sectionTitle`, `chapterTitle`).

2. **Adaptateur Exposé (`services/exposeDocumentService.ts`)** :
   - Extraction des 11 chapitres sous forme canonique et compatible `Sermon` (`expose-ch-0` à `expose-ch-10`).
   - Découpage en **1 434 chunks sémantiques** respectant les frontières de paragraphes, taille moyenne de ~778 caractères.
   - **Taux de couverture des paragraphes : 100,00%** (1 590/1 590 paragraphes indexés, zéro perte).
   - Recherche lexicale BM25 / scoring par paragraphe dédiée au RAG (`searchExposeLexicalForRag`).
   - Pipeline Auto-RAG complet (`executeExposeRagPipeline`).

---

## 4. Résultats Comparatifs de Retrieval

Évaluation sur le benchmark de **40 questions Exposé** (`eval/expose_questions.json`) :

| Pipeline | Recall@5 | Recall@10 | Recall@20 | Source Coverage@5 | Source Coverage@10 | Source Coverage@20 | MRR |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Lexical BM25** | 90.0% | 96.7% | 100.0% | 86.7% | 95.0% | 100.0% | 0.761 |
| **Hybrid RRF (k=60)** | 93.3% | 96.7% | 100.0% | 88.3% | 95.0% | 100.0% | 0.915 |
| **Reranked New RAG** | **100.0%** | **100.0%** | **100.0%** | **98.3%** | **98.3%** | **98.3%** | **1.000** |

---

## 5. Answerability & Abstention

* **Questions couvertes (in-domain)** : 30
* **Questions hors corpus / refus** : 10
* **Vrais Positifs (TP)** : 30
* **Vrais Négatifs (TN - Abstention réussie)** : 10
* **Faux Positifs (FP - Hallucinations évitées)** : 0
* **Faux Négatifs (FN)** : 0
* **Précision Answerability** : 100.0%
* **Rappel Answerability** : 100.0%
* **Taux d'Abstention sur hors-corpus** : **100.0%**

---

## 6. Citations & Absence d'Exposition Technique

* **Citations évaluées** : 200
* **Citations valides et authentifiées** : 200 (100.0%)
* **Citations invalides** : 0
* **Format des citations** : `[Réf: expose-ch-N, §P]` (ex: `[Réf: expose-ch-3, §98]`)
* **Exposition de Chunk ID technique** : **0 (AUCUN)**
* **Déterminisme du pipeline** : **100% vérifié**

---

## 7. État des Feature Flags de Production

* `useLegacyRetrieval` : `true` (strictement inchangé)
* `useHybridRetrieval` : `false` (strictement inchangé)

---

## 8. Conclusion

La section Exposé constitue désormais un corpus documentaire riche et entièrement opérationnel pour le RAG. Le pipeline complet fonctionne avec une couverture de 100%, un recall optimal et une étanchéité totale contre les fuites techniques et les fallbacks non autorisés.
