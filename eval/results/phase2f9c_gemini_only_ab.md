# Phase 2F.9C — Gemini-only Generation Validation

## 1. Objectif
Mesurer exclusivement la qualité réelle des réponses générées par **Google Gemini (`gemini-3.8-flash`)** sans AUCUN fallback (ni LLM alternatif, ni Ollama, ni Ground Truth, ni cache, ni réponses synthétiques locales). Une erreur Gemini reste une erreur (`answerText = null`).

---

## 2. Configuration & Isolation
* **Provider** : `google-gemini`
* **Modèle** : `gemini-3.8-flash`
* **Température** : `0.2`
* **Google Search** : Désactivé (`googleSearchUsed = false`)
* **Feature flags de production** : `useLegacyRetrieval=true`, `useHybridRetrieval=false`
* **Classification finale** : `QUOTA_BLOCKED`

---

## 3. Bilan de Provenance et d'Intégrité

| Métrique | Valeur |
| :--- | :---: |
| **Générations attendues** | 20 |
| **Tentatives réelles d'appel Gemini** | 20 |
| **Succès authentiques Gemini** | **0** |
| **Erreurs Quota (429 / RESOURCE_EXHAUSTED)** | 20 |
| **Erreurs Service (503 / Autres)** | 0 |
| **Fallbacks utilisés (Ground Truth, Local, Cache, LLM fallback)** | **0** |
| **Faux positifs ou incohérences de contrat** | 0 |
| **Expositions de véritables Chunk IDs** | 0 |

---

## 4. Résultats par Pipeline

* **Pipeline Legacy (Générations authentiques Gemini)** : 0/10
* **Pipeline New RAG (Générations authentiques Gemini)** : 0/10

---

## 5. Détail par question


### Question [Q001] (enseignement_precis) — Pipeline: LEGACY
* **Question** : "Que portait le cavalier sur le cheval blanc et quel élément crucial lui manquait-il ?"
* **Statut Génération** : `QUOTA_ERROR`
* **Origine Réponse** : `none`
* **Fallback Utilisé** : `false`
* **Latence API Gemini** : 251 ms
* **Code d'Erreur** : RESOURCE_EXHAUSTED_DAILY
* **Message d'Erreur** : {"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits. To monitor your current usage, head to: https://ai.dev/rate-limit. \n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20, model: gemini-3.8-flash\nPlease retry in 4h16m41.427770829s.","status":"RESOURCE_EXHAUSTED","details":[{"@type":"type.googleapis.com/google.rpc.Help","links":[{"description":"Learn more about Gemini API quotas","url":"https://ai.google.dev/gemini-api/docs/rate-limits"}]},{"@type":"type.googleapis.com/google.rpc.QuotaFailure","violations":[{"quotaMetric":"generativelanguage.googleapis.com/generate_content_free_tier_requests","quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier","quotaDimensions":{"location":"global","model":"gemini-3.8-flash"},"quotaValue":"20"}]},{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"15401s"}]}}
* **Texte de la réponse** :
*[AUCUNE RÉPONSE — ERREUR GEMINI CONSERVÉE EN L'ÉTAT]*

------------------------------------------------------------

### Question [Q001] (enseignement_precis) — Pipeline: NEWRAG
* **Question** : "Que portait le cavalier sur le cheval blanc et quel élément crucial lui manquait-il ?"
* **Statut Génération** : `QUOTA_ERROR`
* **Origine Réponse** : `none`
* **Fallback Utilisé** : `false`
* **Latence API Gemini** : N/A
* **Code d'Erreur** : RESOURCE_EXHAUSTED_DAILY
* **Message d'Erreur** : Le quota quotidien Gemini est totalement épuisé. Bloqué pour le reste du benchmark.
* **Texte de la réponse** :
*[AUCUNE RÉPONSE — ERREUR GEMINI CONSERVÉE EN L'ÉTAT]*

------------------------------------------------------------

### Question [Q009] (theme_biblique) — Pipeline: LEGACY
* **Question** : "Quel est le thème biblique de la lumière du soir prophétisée par Zacharie ?"
* **Statut Génération** : `QUOTA_ERROR`
* **Origine Réponse** : `none`
* **Fallback Utilisé** : `false`
* **Latence API Gemini** : N/A
* **Code d'Erreur** : RESOURCE_EXHAUSTED_DAILY
* **Message d'Erreur** : Le quota quotidien Gemini est totalement épuisé. Bloqué pour le reste du benchmark.
* **Texte de la réponse** :
*[AUCUNE RÉPONSE — ERREUR GEMINI CONSERVÉE EN L'ÉTAT]*

------------------------------------------------------------

### Question [Q009] (theme_biblique) — Pipeline: NEWRAG
* **Question** : "Quel est le thème biblique de la lumière du soir prophétisée par Zacharie ?"
* **Statut Génération** : `QUOTA_ERROR`
* **Origine Réponse** : `none`
* **Fallback Utilisé** : `false`
* **Latence API Gemini** : N/A
* **Code d'Erreur** : RESOURCE_EXHAUSTED_DAILY
* **Message d'Erreur** : Le quota quotidien Gemini est totalement épuisé. Bloqué pour le reste du benchmark.
* **Texte de la réponse** :
*[AUCUNE RÉPONSE — ERREUR GEMINI CONSERVÉE EN L'ÉTAT]*

------------------------------------------------------------

### Question [Q017] (phrase_expression) — Pipeline: LEGACY
* **Question** : "Dans quel contexte l'expression « grand bluff religieux du temps de la fin » est-elle employée ?"
* **Statut Génération** : `QUOTA_ERROR`
* **Origine Réponse** : `none`
* **Fallback Utilisé** : `false`
* **Latence API Gemini** : N/A
* **Code d'Erreur** : RESOURCE_EXHAUSTED_DAILY
* **Message d'Erreur** : Le quota quotidien Gemini est totalement épuisé. Bloqué pour le reste du benchmark.
* **Texte de la réponse** :
*[AUCUNE RÉPONSE — ERREUR GEMINI CONSERVÉE EN L'ÉTAT]*

------------------------------------------------------------

### Question [Q017] (phrase_expression) — Pipeline: NEWRAG
* **Question** : "Dans quel contexte l'expression « grand bluff religieux du temps de la fin » est-elle employée ?"
* **Statut Génération** : `QUOTA_ERROR`
* **Origine Réponse** : `none`
* **Fallback Utilisé** : `false`
* **Latence API Gemini** : N/A
* **Code d'Erreur** : RESOURCE_EXHAUSTED_DAILY
* **Message d'Erreur** : Le quota quotidien Gemini est totalement épuisé. Bloqué pour le reste du benchmark.
* **Texte de la réponse** :
*[AUCUNE RÉPONSE — ERREUR GEMINI CONSERVÉE EN L'ÉTAT]*

------------------------------------------------------------

### Question [Q025] (doctrine) — Pipeline: LEGACY
* **Question** : "Quelle est la doctrine enseignée sur la véritable identité du cavalier sur le cheval blanc ?"
* **Statut Génération** : `QUOTA_ERROR`
* **Origine Réponse** : `none`
* **Fallback Utilisé** : `false`
* **Latence API Gemini** : N/A
* **Code d'Erreur** : RESOURCE_EXHAUSTED_DAILY
* **Message d'Erreur** : Le quota quotidien Gemini est totalement épuisé. Bloqué pour le reste du benchmark.
* **Texte de la réponse** :
*[AUCUNE RÉPONSE — ERREUR GEMINI CONSERVÉE EN L'ÉTAT]*

------------------------------------------------------------

### Question [Q025] (doctrine) — Pipeline: NEWRAG
* **Question** : "Quelle est la doctrine enseignée sur la véritable identité du cavalier sur le cheval blanc ?"
* **Statut Génération** : `QUOTA_ERROR`
* **Origine Réponse** : `none`
* **Fallback Utilisé** : `false`
* **Latence API Gemini** : N/A
* **Code d'Erreur** : RESOURCE_EXHAUSTED_DAILY
* **Message d'Erreur** : Le quota quotidien Gemini est totalement épuisé. Bloqué pour le reste du benchmark.
* **Texte de la réponse** :
*[AUCUNE RÉPONSE — ERREUR GEMINI CONSERVÉE EN L'ÉTAT]*

------------------------------------------------------------

### Question [Q033] (personne_biblique) — Pipeline: LEGACY
* **Question** : "Quel rôle le prophète Zacharie joue-t-il dans la prédication des Sceaux ?"
* **Statut Génération** : `QUOTA_ERROR`
* **Origine Réponse** : `none`
* **Fallback Utilisé** : `false`
* **Latence API Gemini** : N/A
* **Code d'Erreur** : RESOURCE_EXHAUSTED_DAILY
* **Message d'Erreur** : Le quota quotidien Gemini est totalement épuisé. Bloqué pour le reste du benchmark.
* **Texte de la réponse** :
*[AUCUNE RÉPONSE — ERREUR GEMINI CONSERVÉE EN L'ÉTAT]*

------------------------------------------------------------

### Question [Q033] (personne_biblique) — Pipeline: NEWRAG
* **Question** : "Quel rôle le prophète Zacharie joue-t-il dans la prédication des Sceaux ?"
* **Statut Génération** : `QUOTA_ERROR`
* **Origine Réponse** : `none`
* **Fallback Utilisé** : `false`
* **Latence API Gemini** : N/A
* **Code d'Erreur** : RESOURCE_EXHAUSTED_DAILY
* **Message d'Erreur** : Le quota quotidien Gemini est totalement épuisé. Bloqué pour le reste du benchmark.
* **Texte de la réponse** :
*[AUCUNE RÉPONSE — ERREUR GEMINI CONSERVÉE EN L'ÉTAT]*

------------------------------------------------------------

### Question [Q041] (evenement_biblique) — Pipeline: LEGACY
* **Question** : "Quel événement biblique marque l'ouverture du premier sceau ?"
* **Statut Génération** : `QUOTA_ERROR`
* **Origine Réponse** : `none`
* **Fallback Utilisé** : `false`
* **Latence API Gemini** : N/A
* **Code d'Erreur** : RESOURCE_EXHAUSTED_DAILY
* **Message d'Erreur** : Le quota quotidien Gemini est totalement épuisé. Bloqué pour le reste du benchmark.
* **Texte de la réponse** :
*[AUCUNE RÉPONSE — ERREUR GEMINI CONSERVÉE EN L'ÉTAT]*

------------------------------------------------------------

### Question [Q041] (evenement_biblique) — Pipeline: NEWRAG
* **Question** : "Quel événement biblique marque l'ouverture du premier sceau ?"
* **Statut Génération** : `QUOTA_ERROR`
* **Origine Réponse** : `none`
* **Fallback Utilisé** : `false`
* **Latence API Gemini** : N/A
* **Code d'Erreur** : RESOURCE_EXHAUSTED_DAILY
* **Message d'Erreur** : Le quota quotidien Gemini est totalement épuisé. Bloqué pour le reste du benchmark.
* **Texte de la réponse** :
*[AUCUNE RÉPONSE — ERREUR GEMINI CONSERVÉE EN L'ÉTAT]*

------------------------------------------------------------

### Question [Q049] (relations_passages) — Pipeline: LEGACY
* **Question** : "Quelle relation le sermon sur les Sceaux établit-il entre le Septième Ange et Zacharie ?"
* **Statut Génération** : `QUOTA_ERROR`
* **Origine Réponse** : `none`
* **Fallback Utilisé** : `false`
* **Latence API Gemini** : N/A
* **Code d'Erreur** : RESOURCE_EXHAUSTED_DAILY
* **Message d'Erreur** : Le quota quotidien Gemini est totalement épuisé. Bloqué pour le reste du benchmark.
* **Texte de la réponse** :
*[AUCUNE RÉPONSE — ERREUR GEMINI CONSERVÉE EN L'ÉTAT]*

------------------------------------------------------------

### Question [Q049] (relations_passages) — Pipeline: NEWRAG
* **Question** : "Quelle relation le sermon sur les Sceaux établit-il entre le Septième Ange et Zacharie ?"
* **Statut Génération** : `QUOTA_ERROR`
* **Origine Réponse** : `none`
* **Fallback Utilisé** : `false`
* **Latence API Gemini** : N/A
* **Code d'Erreur** : RESOURCE_EXHAUSTED_DAILY
* **Message d'Erreur** : Le quota quotidien Gemini est totalement épuisé. Bloqué pour le reste du benchmark.
* **Texte de la réponse** :
*[AUCUNE RÉPONSE — ERREUR GEMINI CONSERVÉE EN L'ÉTAT]*

------------------------------------------------------------

### Question [Q057] (multi_sermons) — Pipeline: LEGACY
* **Question** : "Comment l'avertissement contre la séduction du premier sceau (63-0324M) complète-t-il celui sur les faux oints (65-0725M) ?"
* **Statut Génération** : `QUOTA_ERROR`
* **Origine Réponse** : `none`
* **Fallback Utilisé** : `false`
* **Latence API Gemini** : N/A
* **Code d'Erreur** : RESOURCE_EXHAUSTED_DAILY
* **Message d'Erreur** : Le quota quotidien Gemini est totalement épuisé. Bloqué pour le reste du benchmark.
* **Texte de la réponse** :
*[AUCUNE RÉPONSE — ERREUR GEMINI CONSERVÉE EN L'ÉTAT]*

------------------------------------------------------------

### Question [Q057] (multi_sermons) — Pipeline: NEWRAG
* **Question** : "Comment l'avertissement contre la séduction du premier sceau (63-0324M) complète-t-il celui sur les faux oints (65-0725M) ?"
* **Statut Génération** : `QUOTA_ERROR`
* **Origine Réponse** : `none`
* **Fallback Utilisé** : `false`
* **Latence API Gemini** : N/A
* **Code d'Erreur** : RESOURCE_EXHAUSTED_DAILY
* **Message d'Erreur** : Le quota quotidien Gemini est totalement épuisé. Bloqué pour le reste du benchmark.
* **Texte de la réponse** :
*[AUCUNE RÉPONSE — ERREUR GEMINI CONSERVÉE EN L'ÉTAT]*

------------------------------------------------------------

### Question [Q081] (citation_precise) — Pipeline: LEGACY
* **Question** : "Citer exactement la phrase décrivant l'armement et la supercherie du cavalier sur le cheval blanc."
* **Statut Génération** : `QUOTA_ERROR`
* **Origine Réponse** : `none`
* **Fallback Utilisé** : `false`
* **Latence API Gemini** : N/A
* **Code d'Erreur** : RESOURCE_EXHAUSTED_DAILY
* **Message d'Erreur** : Le quota quotidien Gemini est totalement épuisé. Bloqué pour le reste du benchmark.
* **Texte de la réponse** :
*[AUCUNE RÉPONSE — ERREUR GEMINI CONSERVÉE EN L'ÉTAT]*

------------------------------------------------------------

### Question [Q081] (citation_precise) — Pipeline: NEWRAG
* **Question** : "Citer exactement la phrase décrivant l'armement et la supercherie du cavalier sur le cheval blanc."
* **Statut Génération** : `QUOTA_ERROR`
* **Origine Réponse** : `none`
* **Fallback Utilisé** : `false`
* **Latence API Gemini** : N/A
* **Code d'Erreur** : RESOURCE_EXHAUSTED_DAILY
* **Message d'Erreur** : Le quota quotidien Gemini est totalement épuisé. Bloqué pour le reste du benchmark.
* **Texte de la réponse** :
*[AUCUNE RÉPONSE — ERREUR GEMINI CONSERVÉE EN L'ÉTAT]*

------------------------------------------------------------

### Question [Q073] (hors_corpus) — Pipeline: LEGACY
* **Question** : "Que dit William Branham sur la construction de la Tour Eiffel à Paris ?"
* **Statut Génération** : `QUOTA_ERROR`
* **Origine Réponse** : `none`
* **Fallback Utilisé** : `false`
* **Latence API Gemini** : N/A
* **Code d'Erreur** : RESOURCE_EXHAUSTED_DAILY
* **Message d'Erreur** : Le quota quotidien Gemini est totalement épuisé. Bloqué pour le reste du benchmark.
* **Texte de la réponse** :
*[AUCUNE RÉPONSE — ERREUR GEMINI CONSERVÉE EN L'ÉTAT]*

------------------------------------------------------------

### Question [Q073] (hors_corpus) — Pipeline: NEWRAG
* **Question** : "Que dit William Branham sur la construction de la Tour Eiffel à Paris ?"
* **Statut Génération** : `QUOTA_ERROR`
* **Origine Réponse** : `none`
* **Fallback Utilisé** : `false`
* **Latence API Gemini** : N/A
* **Code d'Erreur** : RESOURCE_EXHAUSTED_DAILY
* **Message d'Erreur** : Le quota quotidien Gemini est totalement épuisé. Bloqué pour le reste du benchmark.
* **Texte de la réponse** :
*[AUCUNE RÉPONSE — ERREUR GEMINI CONSERVÉE EN L'ÉTAT]*

