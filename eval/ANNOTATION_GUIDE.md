# Guide d'Annotation du Jeu d'Évaluation (50 Requêtes) — Étape 10

Ce guide explique pas à pas comment annoter le fichier `eval/queries.json` avant de lancer la métrologie et le calibrage de l'answerability sur votre machine locale.

---

### 1. Règle d'or de l'annotation

- **Ne jamais modifier les champs `id`, `set` (`dev` / `test`), `category` et `query`**.
- Pour chaque requête :
  - Si la réponse existe dans le corpus, renseignez **`expectedAnswerable: true`** et complétez la liste **`expectedRefs`**.
  - Si la question est un piège voisin ou hors-corpus, renseignez **`expectedAnswerable: false`** et laissez **`expectedRefs: []`**.

---

### 2. Format du champ `expectedRefs`

Chaque entrée de `expectedRefs` doit désigner un paragraphe authentique du corpus :

```json
"expectedRefs": [
  { "docId": "63-0324M", "paragraphIndex": 2 },
  { "docId": "expose-ch-4", "paragraphIndex": 15 }
]
```

#### Règles pour `expectedRefs` :
1. **Plusieurs paragraphes acceptables** : si une réponse est couverte par 2 ou 3 paragraphes distincts (ex. dans un sermon ou dans l'Exposé), vous pouvez ajouter les 2 ou 3 objets dans la liste. Le système considérera le rappel comme un **succès (Recall=1.0)** dès qu'au moins un des paragraphes attendus se retrouve dans le top 10.
2. **Identifiants de documents (`docId`)** :
   - Sermons : l'identifiant canonique (ex: `63-0324M`, `64-0802`, `65-1204`).
   - Exposé des Sept Âges : `expose-ch-0` à `expose-ch-10`.
   - Bible : `bible-jhn-3` ou `bible-psa-23`.
   - Cantiques : `song-12` ou `song-crois-seulement`.
3. **Index de paragraphe (`paragraphIndex`)** : le numéro exact du paragraphe (1-indexé) tel qu'affiché dans le lecteur King's Sword.

---

### 3. Règle spéciale pour les Paraphrases (Propagations automatiques & zéro doublon)

Chaque requête de catégorie `"paraphrase"` (`Q16`, `Q17`, `Q18`, `Q19`, `Q20`, `Q41`, `Q42`, `Q43`) est rattachée à sa requête d'origine via le champ `"pairedWith"` (ex: `Q16` est liée à `Q01`).

Une paraphrase vise à mesurer la robustesse sémantique du moteur pour une **même intention d'information**. Par conséquent :
- **La paraphrase et sa requête d'origine DOIVENT partager EXACTEMENT les mêmes références attendues (`expectedRefs`)**.

👉 **Procédure d'annotation accélérée :**
1. Annotez d'abord la requête originale (`Q01`, `Q02`, `Q03`, `Q04`, `Q10`, `Q31`, `Q32`, `Q37`).
2. Copiez-collez simplement son bloc `expectedRefs` dans la requête paraphrase correspondante.
Cela évite tout double travail d'annotation et garantit que la métrique mesure la seule variation sémantique de la recherche.

---

### 4. Exemples d'annotation complète

#### Exemple A : Question factuelle directe (Corpus présent)
```json
{
  "id": "Q01",
  "set": "dev",
  "category": "factuelle_directe",
  "sourceType": "sermon",
  "query": "Que révèle le premier sceau sur le cavalier du cheval blanc ?",
  "scope": null,
  "expectedRefs": [
    { "docId": "63-0324M", "paragraphIndex": 2 },
    { "docId": "63-0324M", "paragraphIndex": 3 }
  ],
  "expectedAnswerable": true,
  "notes": "Paragraphes 2 et 3 du Premier Sceau récapitulant l'arc sans flèche."
}
```

#### Exemple B : Question piège ou hors-corpus (Réponse absente)
```json
{
  "id": "Q30",
  "set": "dev",
  "category": "hors_corpus",
  "sourceType": "none",
  "query": "Quelle est la recette traditionnelle de la quiche lorraine au four ?",
  "scope": null,
  "expectedRefs": [],
  "expectedAnswerable": false,
  "notes": "Question culinaire hors-corpus. RAG doit refuser."
}
```

---

### 5. Étapes de lancement des scripts sur votre machine

Une fois les 50 requêtes annotées dans `eval/queries.json` :

#### Étape A : Métrologie de base (Baseline)
```bash
npx tsx eval/run_eval.ts
```
*(Génère `eval/results_<date>.json` et affiche le tableau des métriques Recall@10, MRR@5, NDCG@10, Vrais Négatifs et Faux Refus)*.

#### Étape B : Calibrage du seuil d'Answerability sur le jeu Dev (30 requêtes)
```bash
npx tsx eval/calibrate_answerability.ts
```
*(Balaye le seuil de 0,10 à 0,40 par pas de 0,02 sur les 30 requêtes Dev, trace le compromis Faux Refus vs Fausses Réponses, propose le seuil optimal et le vérifie 1 seule fois sur le jeu Test blind)*.

#### Étape C : Étude d'ablation des composants
```bash
npx tsx eval/run_ablation.ts
```
*(Compare BM25 seul, Vectoriel seul, RRF 1.0/1.0 et RRF filtré pour mesurer l'apport exact de chaque composante)*.
