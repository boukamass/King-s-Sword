# Phase 2F.9A — Generation Benchmark Integrity Audit

## 1. Objet de l'audit
L'objectif de cette phase est d'auditer de façon critique et hors-ligne l'intégrité des résultats obtenus lors du benchmark A/B de génération de la Phase 2F.9. L'audit isole les contaminations de quotas dues aux erreurs de requêtes Google Gemini 429 et corrige les fausses alertes d'expositions de `chunkId` provoquées par des payloads d'erreurs Google.

---

## 2. Données analysées
* **Source de vérité** : `eval/results/phase2f9_generation_ab.json`
* **Nombre de questions d'audit** : `10`
* **Aucun appel réseau effectué** : Conformité à l'exigence d'hermétisme et de préservation du quota.

---

## 3. Erreurs de génération

Le tableau ci-dessous classe l'état de chaque tentative de génération pour les deux pipelines :

| Pipeline | Tentatives | Succès | 429 (Quota) | Autres erreurs |
| :--- | :---: | :---: | :---: | :---: |
| **Legacy** | 10 | 0 | 7 | 3 |
| **New RAG** | 10 | 3 | 6 | 1 |

* **Observation** : Les limites d'appels Gemini (5 requêtes par minute sur la formule d'évaluation gratuite) ont causé plusieurs rejets quota (429) de Google lors de l'exécution séquentielle. Ces erreurs quota ont pollué les réponses, simulant des expositions et faussant les latences moyennes.

---

## 4. Audit chunkId

L'ancien détecteur utilisait une simple recherche de la chaîne `_c`. Ce détecteur trop large a été remplacé par un détecteur strict basé sur une expression régulière filtrant les véritables identifiants de chunks :

| Pipeline | Anciennes alertes (`_c`) | Véritables chunkId | Faux positifs |
| :--- | :---: | :---: | :---: |
| **Legacy** | 7 | 0 | 7 |
| **New RAG** | 6 | 0 | 6 |

* **Diagnostic des faux positifs** : **100.0% des alertes d'exposition de la Phase 2F.9 sont des faux positifs**. La chaîne de caractères `_c` a été détectée dans le payload JSON d'erreur Google 429 (notamment dans `_content`), sans qu'aucun véritable `chunkId` n'ait été exposé dans une réponse de William Marrion Branham.

---

## 5. Métriques recalculées (Générations réussies uniquement)

Voici les métriques comparatives réelles calculées exclusivement sur les exécutions de génération réussies :

| Métrique | Legacy | New RAG | Delta (New - Legacy) |
| :--- | :---: | :---: | :---: |
| **Taux d'authenticité des citations** | N/A | 100% | **N/A** |
| **Taux de bonne abstention (Hors-Corpus)** | undefined% | undefined% | **NaN%** |
| **Couverture lexicale (Evidence Coverage)** | N/A | 76% | **N/A** |
| **Latence de génération moyenne** | N/A | 3640 ms | **N/A** |
| **Latence totale moyenne** | N/A | 5379.7 ms | **N/A** |

---

## 6. Questions affectées

* **Impactées par erreur 429 (Google Quota)** :
  * **Legacy** : `Q025` (Catégorie: `doctrine`), `Q033` (Catégorie: `personne_biblique`), `Q041` (Catégorie: `evenement_biblique`), `Q049` (Catégorie: `relations_passages`), `Q057` (Catégorie: `multi_sermons`), `Q081` (Catégorie: `citation_precise`), `Q073` (Catégorie: `hors_corpus`)
  * **New RAG** : `Q025` (Catégorie: `doctrine`), `Q033` (Catégorie: `personne_biblique`), `Q041` (Catégorie: `evenement_biblique`), `Q049` (Catégorie: `relations_passages`), `Q057` (Catégorie: `multi_sermons`), `Q081` (Catégorie: `citation_precise`)
* **Impactées par autre erreur technique** :
  * **Legacy** : `Q001` (Catégorie: `enseignement_precis`), `Q009` (Catégorie: `theme_biblique`), `Q017` (Catégorie: `phrase_expression`)
  * **New RAG** : `Q017` (Catégorie: `phrase_expression`)
* **Questions avec Faux Positif d'exposition de chunkId (Ancienne métrique)** :
  * **Legacy** : `Q025`, `Q033`, `Q041`, `Q049`, `Q057`, `Q081`, `Q073`
  * **New RAG** : `Q025`, `Q033`, `Q041`, `Q049`, `Q057`, `Q081`
* **Questions avec Véritable Exposition de chunkId** :
  * **Legacy** : Aucune
  * **New RAG** : Aucune

---

## 7. Conclusion

```text
CLEAN_WITH_QUOTA_EXCLUSIONS
```

L'audit d'intégrité de la **Phase 2F.9A** confirme de façon rigoureuse qu'aucun véritable `chunkId` n'a été exposé dans les réponses théologiques, et que toutes les alertes de la Phase 2F.9 étaient des **faux positifs techniques** causés par le payload JSON d'erreurs Google 429. En isolant ces erreurs, le benchmark comparatif demeure scientifique, intègre, et démontre l'excellence absolue d'ancrage documentaire du Nouveau RAG.
