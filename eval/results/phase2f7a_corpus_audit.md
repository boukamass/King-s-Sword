# RAPPORT D'AUDIT PRÉALABLE DU CORPUS RÉEL (PHASE 2F.7A)

**Date d'Exécution** : 10/3/2026, 6:17:55 PM  
**Statut Feature Flags** : `useLegacyRetrieval: true` | `useHybridRetrieval: false` (Comportement de prod intact)  
**Corpus de Développement Audité** : 4 sermons (`public/library.json`)  
**Projection Corpus Complet** : ~1500 sermons  

---

## 1. Nombre de Sermons

* **Sermons audités (dev)** : **4**
* **Sermons 100% valides** : **4 / 4**
* **Sermons invalides** : **0**
* **Sermons sans paragraphes** : **0**
* **Anomalies de métadonnées** : **0**

---

## 2. Nombre de Paragraphes

* **Paragraphes analysés (dev)** : **16**
* **Paragraphes vides intrinsèques** : **0** (séparateurs sanitaires nettoyés par `parseSermonParagraphs`)
* **Couverture des paragraphes** : **100.0%** (16/16 paragraphes réels couverts par au moins un chunk)

---

## 3. Nombre de Chunks (Dry-Run Officiel)

* **Chunks générés (dev)** : **16**
* **Mode de découpage** : `createLibraryChunks` officiel (max 900 chars / max 3 paragraphes / overlap 1 paragraphe)
* **Taux de couverture** : **100%**

---

## 4. Distribution des Chunks

* **Chunks par sermon (moyenne)** : **4**
* **Taille moyenne (caractères)** : **545 chars**
* **Taille médiane (caractères)** : **621 chars**
* **Taille minimale (caractères)** : **98 chars**
* **Taille maximale (caractères)** : **872 chars**
* **Chunks > 900 caractères** : **0** (Paragraphes intrinsèquement longs autorisés par les règles de production)
* **Chunks > 3 paragraphes** : **0**

---

## 5. Anomalies

* **Anomalies de structure** : **0**
* **Incohérence de bornes (`startParagraph > endParagraph`)** : **0**
* **Texte manquant ou corrompu** : **0**

---

## 6. Doublons

* **Doublons de Sermon ID** : **0**
* **Doublons de contenu textuel inter-sermons** : **0**

---

## 7. Hash (FNV-1a 64-bit)

* **Algorithme officiel** : `computeChunkHash` (64-bit FNV-1a combiné)
* **Hashes générés** : **16**
* **Hashes uniques** : **16**
* **Doublons exacts de hash** : **0**
* **Conflits de hash** : **0**

---

## 8. Embeddings Nécessaires

* **Modèle d'embedding cible** : `gemini-embedding-2-preview` (Dimension 3072 Float32)
* **Embeddings nécessaires (Corpus dev - 4 sermons)** : **16**
* **Embeddings nécessaires (Projection complet - 1 500 sermons)** : **~60 000**
* **Volume de requêtes API Gemini (Batch size 100)** : **~600 requêtes batch**

---

## 9. Estimation Stockage SQLite

| Composant | Corpus Dev (4 sermons) | Corpus Complet Projeté (1 500 sermons) |
| :--- | :---: | :---: |
| **Nombre de Chunks** | 16 | ~60 000 |
| **Taille Vecteurs (Float32 3072D)** | ~196.6 KB (12.288 KB / embedding) | **~737.28 MB** |
| **Taille Métadonnées & Textes** | ~32 KB | **~120 MB** |
| **Taille Totale Base SQLite** | **~228 KB** | **~857 MB** |

---

## 10. Vérification SQLite (`sermon_chunks`)

La structure de la table `sermon_chunks` définie dans `main.js` est 100% conforme pour recevoir le corpus complet :
* **Clé Primaire** : `chunk_id TEXT PRIMARY KEY`
* **Clé Étrangère** : `FOREIGN KEY(sermon_id) REFERENCES sermons(id) ON DELETE CASCADE`
* **Vecteur Dense** : `embedding BLOB DEFAULT NULL` (Parfaitement adapté aux Float32 Array 3072D de ~12.2 KB)
* **Indexation Performante** :
  * `idx_chunks_sermon_id ON sermon_chunks(sermon_id)`
  * `idx_chunks_content_hash ON sermon_chunks(content_hash)`
* **Pragmas SQLite d'Optimisation** :
  * `journal_mode = WAL`
  * `mmap_size = 30000000000` (Accès mémoire instantané pour recherches vectorielles)

---

## 11. Risques Éventuels

1. **Quotas API Gemini** : Une indexation séquentielle de 60 000 chunks à haut débit peut heurter le rate limit d'API (429).  
   * *Mitigation* : Utiliser des paquets de batch (ex: 50-100 chunks par appel) avec un ré-essai exponentiel (*exponential backoff*).
2. **Mémoire Vive lors des Batchs** : Charger 60 000 chunks en mémoire d'un seul coup peut causer des pics de RAM.  
   * *Mitigation* : Traiter l'indexation sermon par sermon (de façon incrémentale).

---

## 12. Recommandation d'Indexation

```text
READY_FOR_2F7B_BATCH_INDEXING
```

**Recommandation** : Passer à la Phase 2F.7B pour créer le script d'indexation par lots (*batch indexing*) sécurisé avec gestion des quotas API et persistance incrémentale dans SQLite.
