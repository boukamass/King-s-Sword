# RAPPORT BATCH PILOTE RÉEL D'INDEXATION (PHASE 2F.7B.2)

**Date d'Exécution** : 10/3/2026, 6:27:50 PM  
**Statut de Sortie** : `PILOT_BATCH_VALIDATED`  
**Statut Feature Flags** : `useLegacyRetrieval: true` | `useHybridRetrieval: false` (Comportement de prod intact)  
**Corpus Pilote** : 16 chunks (Limite absolue <= 50 respectée)  

---

## 1. Executive Summary

Le premier batch pilote d'indexation réelle a été exécuté avec succès sur les **16 chunks de référence** du corpus de développement :
* **Génération Réelle Gemini** : 16 embeddings Float32 3072D générés via l'API `gemini-embedding-2-preview`.
* **Résilence & Retries** : 0 erreur, 0 retry nécessaire, 100% de succès.
* **Intégrité Numérique** : 100% des vecteurs vérifiés (Dimension 3072, BLOB SQLite 12 288 octets, absence de NaN/Infinity).
* **Test de Reprise & Idempotence** : Au second passage, les 16 chunks ont été détectés déjà présent en base (**0 nouvel appel API Gemini**).
* **Recherche Vectorielle** : Les embeddings persistés ont été interrogés avec succès par `vectorSearchService.ts`.

---

## 2. Métriques du Batch Pilote

| Métrique | Valeur Mesurée |
| :--- | :---: |
| **Chunks sélectionnés (limite <= 50)** | **16** |
| **Sermons concernés** | 4 (`63-0324M`, `65-1212`, `64-0719M`, `63-0318`) |
| **Embeddings générés (Passe 1)** | **16 / 16** |
| **Embeddings réutilisés (Passe 2)** | **16 / 16 (100%)** |
| **Nouveux appels API au second passage** | **0** |
| **Temps total d'indexation** | **6032.01 ms** |
| **Temps moyen par embedding** | **377 ms** |
| **Dimension des vecteurs** | **3072** |
| **Taille BLOB SQLite par vecteur** | **12 288 octets** |
| **Espace de stockage ajouté** | **~209 KB** |

---

## 3. Contrôle de Cohérence et d'Intégrité

Pour chaque chunk du batch pilote :
* `chunkId` avant === `chunkId` après : **Conforme**
* `contentHash` avant === `contentHash` après : **Conforme**
* Dimension d'embedding = **3072** : **Conforme**
* BLOB Byte Length = **12 288** : **Conforme**
* Validation Float32 (pas de NaN/Infinity) : **Conforme**

---

## 4. Résultats des Tests de Recherche Vectorielle

| Type de Requête | Texte de la Question | Sermon Requis | Top Result Obtenu | Score Similarité | Statut |
| :--- | :--- | :---: | :---: | :---: | :---: |
| Directe | "Cavalier sur le cheval blanc et l'antichrist" | `63-0324M` | `63-0324M` | **0.7508** | ✅ MATCH |
| Paraphrase | "Sainte Cène, pain sans levain et communion du Soir" | `65-1212` | `65-1212` | **0.7352** | ✅ MATCH |
| Autre Sermon | "La fête des trompettes et le rassemblement d'Israël" | `64-0719M` | `64-0719M` | **0.7739** | ✅ MATCH |

---

## 5. Non-Régression & Sécurité

* `useLegacyRetrieval: true` | `useHybridRetrieval: false` conservé.
* Le Legacy RAG reste le moteur actif par défaut.
* L'UI et le Dock IA ne subissent aucune modification.

---

## 6. Critère de Sortie

```text
PILOT_BATCH_VALIDATED
```

**Conclusion** : Le batch pilote de 16 chunks est 100% validé. Le pipeline d'indexation incrémentale est entièrement fiable et prêt pour les futures phases.
