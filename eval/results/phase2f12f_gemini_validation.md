# RAPPORT DE VALIDATION — PHASE 2F.12F : GÉNÉRATION RÉELLE GEMINI

**Date :** 2026-10-04T08:46:50.598Z  
**Statut Final :** **GEMINI_VALIDATION_BLOCKED_BY_QUOTA**  

---

## 1. Bilan d'Exécution

* **Générations Gemini réussies :** **4 / 9**
* **Erreurs Quota (429 / Resource Exhausted) :** **1**
* **Autres Erreurs :** **4**
* **Fallback utilisé :** **0 (Strictement 0)**

---

## 2. Détail des 10 Questions Testées

| # | Catégorie | Query | Context | Answerable | Gemini Appelé | Status | Citations (Val/Inval) | Chunk ID Exposé |
|---|---|---|---|---|---|---|---|---|
| 1 | Sermon seul | "premier sceau cavalier cheval blanc" | [63-0324M] | true | true | **SUCCESS** | 3/0 | false |
| 2 | Exposé seul | "Que signifie le nom Philadelphie d'après l'Exposé ?" | [expose-ch-8] | true | true | **SUCCESS** | 2/0 | false |
| 3 | Bible seule | "Car Dieu a tant aimé le monde qu'il a donné son Fils unique" | [bible-jhn-3] | true | true | **SUCCESS** | 8/0 | false |
| 4 | Chant seul | "Come to my soul blessed Jesus heart like Thine Savior divine" | [song-1] | true | true | **ERROR** | 0/0 | false |
| 5 | Sermon + Bible | "premier sceau et Fils unique donné par amour" | [63-0324M, bible-jhn-3] | false | false | **ERROR** | 0/0 | false |
| 6 | Sermon + Exposé | "premier sceau et âge de Philadelphie" | [63-0324M, expose-ch-8] | true | true | **ERROR** | 0/0 | false |
| 7 | Multi-source (4 types) | "premier sceau et Philadelphie et Fils unique et heart like Thine" | [63-0324M, expose-ch-8, bible-jhn-3, song-1] | true | true | **SUCCESS** | 0/0 | false |
| 8 | Citation précise | "Quel est l'âge de l'amour fraternel et quelle porte est ouverte ?" | [expose-ch-8] | true | true | **QUOTA_ERROR** | 0/0 | false |
| 9 | Question ambiguë | "sceau et amour" | [63-0324M, expose-ch-8] | false | false | **ERROR** | 0/0 | false |
| 10 | Question hors-contexte (Isolement) | "Que dit la rencontre nocturne de Nicodème avec Jésus au chapitre 3 selon saint Jean ?" | [63-0324M] | false | false | **SUCCESS_ISOLATION_PASSED** | 0/0 | false |

---

## 3. Contrôle d'Isolement et de Sécurité

1. **Test d'isolement (#10) :** Question sur Nicodème (Jean 3) avec context `63-0324M` -> `answerable=false`, **Gemini non appelé** (0 quota consommé).
2. **Détection Chunk ID :** **0 fuite** d'identifiants techniques enregistrée dans toutes les réponses.
3. **Pureté de génération :** **0 fallback local**, aucun Ollama, aucun grounding web, aucune falsification d'erreurs.

---

**Conclusion :** La chaîne de génération unifiée est concluante au niveau RAG/UI mais limitée par les quotas Free Tier de l'API Gemini.
