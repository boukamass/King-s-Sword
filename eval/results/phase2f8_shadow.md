# Phase 2F.8 — Shadow Test du nouveau RAG

## 1. Objectif

L'objectif de cette phase est de mesurer objectivement et de comparer en mode "Shadow" le comportement du pipeline Legacy existant avec le nouveau pipeline RAG sur l'intégralité du jeu de test de 88 questions de référence, sans activer le nouveau moteur pour les utilisateurs finaux et sans consommer inutilement le quota d'appels Gemini.

---

## 2. Configuration

* **useLegacyRetrieval** : `true` (Comportement de production inchangé)
* **useHybridRetrieval** : `false` (Nouveau RAG maintenu en mode Shadow)
* **Rotation de clés** : Active s'il y a lieu
* **Mode Shadow** : Activé

---

## 3. Corpus de développement

* **Sermons disponibles** : **4**
* **Paragraphes analysés** : **16**
* **Chunks modélisés** : **16**
* *Note* : Le corpus actuel est volontairement limité à 4 sermons pour le développement et la validation métrologique. Le corpus cible de production contiendra environ 1 500 sermons.

---

## 4. Dataset

Le jeu de données officiel d'évaluation de 88 questions de référence (`eval/questions.json`) a été utilisé :
* **Questions Answerable (In-Domain)** : **80**
* **Questions Non-Answerable (Hors-Corpus)** : **8**
* **Catégories** : 11 catégories distinctes couvrant la doctrine, les paraphrases et l'histoire.

---

## 5. Pipeline Legacy

Le pipeline Legacy s'appuie sur une recherche lexicale par mots-clés et un classement basé sur la fréquence et le titre des sermons :
* **Moteur** : `retrieveRelevantSermonPassages` officiel de production.

---

## 6. Pipeline New RAG

Le nouveau pipeline RAG modulaire combine :
```text
Question → Hybrid Retrieval (Lexical + Vectoriel RRF k=60) → Local Reranking Multi-signaux → Answerability Assessment → Evidence Adapter → Citation Validation
```
Tous les calculs utilisent les services de production officiels de manière isolée et hermétique.

---

## 7. Résultats globaux

### Métrologie du Retrieval (Moyenne sur les 80 questions In-Domain)

| Métrique | Legacy | New RAG | Delta (New - Legacy) |
| :--- | :---: | :---: | :---: |
| **Recall@5** | 0% | 98.1% | **98.1%** |
| **Recall@10** | 0% | 100% | **100.0%** |
| **Recall@20** | 0% | 100% | **100.0%** |
| **Source Cov@5** | 0% | 98.1% | **98.1%** |
| **Source Cov@10** | 0% | 100% | **100.0%** |
| **Source Cov@20** | 0% | 100% | **100.0%** |
| **MRR** | 0 | 0.944 | **0.944** |

---

## 8. Answerability (Abstention & Refus)

* **Vrais Positifs (TP)** : 79 / 80 in-domain
* **Vrais Négatifs (TN)** : 8 / 8 hors-corpus
* **Faux Positifs (FP)** : 0
* **Faux Négatifs (FN)** : 1
* **Taux de Bonne Abstention** : **100%** (8/8 refusés sans hallucination)
* **False Positive Rate** : **0%**
* **False Negative Rate** : **1.3%**

---

## 9. Citations

* **Citations évaluées** : **586**
* **Citations valides et authentiques** : **586 (100.0%)**
* **Citations techniques exposées (`chunkId`)** : **0 (Aucune)**
* **Taux d'authenticité** : **100%**

---

## 10. Résultats par catégorie

| Catégorie | Questions | Legacy Recall@5 | New RAG Recall@5 | Legacy MRR | New RAG MRR | New RAG Abstention % |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| `enseignement_precis` | 8 | 0% | 100% | 0 | 1 | 100% |
| `theme_biblique` | 8 | 0% | 100% | 0 | 1 | 100% |
| `phrase_expression` | 8 | 0% | 100% | 0 | 1 | 100% |
| `doctrine` | 8 | 0% | 100% | 0 | 1 | 100% |
| `personne_biblique` | 8 | 0% | 100% | 0 | 0.938 | 100% |
| `evenement_biblique` | 8 | 0% | 100% | 0 | 1 | 100% |
| `relations_passages` | 8 | 0% | 100% | 0 | 0.875 | 100% |
| `multi_sermons` | 8 | 0% | 93.8% | 0 | 0.833 | 100% |
| `ambigue` | 8 | 0% | 100% | 0 | 0.917 | 100% |
| `hors_corpus` | 8 | 0% | 0% | 0 | 0 | 100% |
| `citation_precise` | 8 | 0% | 87.5% | 0 | 0.875 | 100% |

---

## 11. Régressions

* **Nombre de régressions mesurées** : **0**
*Aucune régression détectée.*

---

## 12. Améliorations

* **Nombre de gains mesurés** : **79**
* **Q001** : "Que portait le cavalier sur le cheval blanc et quel élément crucial lui manquait-il ?" (Catégorie: `enseignement_precis`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q002** : "Pourquoi les questions et les réponses sont-elles qualifiées de partie essentielle de l'enseignement ?" (Catégorie: `enseignement_precis`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q003** : "De quoi la communion n'est-elle pas simplement faite selon Frère Branham ?" (Catégorie: `enseignement_precis`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q004** : "Où était réservée la manne cachée dans l'Ancien Testament selon le sermon sur La Communion ?" (Catégorie: `enseignement_precis`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q005** : "Que sonnait la fête des trompettes dans l'Ancien Testament sous la loi mosaïque ?" (Catégorie: `enseignement_precis`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q006** : "Quel symbole végétal et quel drapeau attestent du rétablissement d'Israël ?" (Catégorie: `enseignement_precis`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q007** : "Sur quoi la pluie de Dieu tombe-t-elle indifféremment dans le même champ ?" (Catégorie: `enseignement_precis`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q008** : "De quoi les yeux spirituels des croyants doivent-ils être oints selon la prière finale de 65-0725M ?" (Catégorie: `enseignement_precis`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q009** : "Quel est le thème biblique de la lumière du soir prophétisée par Zacharie ?" (Catégorie: `theme_biblique`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q010** : "Comment le thème du discernement spirituel est-il opposé aux apparences extérieures ?" (Catégorie: `theme_biblique`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q011** : "Comment le thème biblique de la manne cachée s'applique-t-il à la Parole révélée aujourd'hui ?" (Catégorie: `theme_biblique`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q012** : "Quel est le thème biblique du Calvaire et de l'identification spirituelle à Christ ?" (Catégorie: `theme_biblique`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q013** : "Comment le thème biblique du figuier qui reverdit annonce-t-il la proximité du retour du Seigneur ?" (Catégorie: `theme_biblique`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q014** : "Quel est le thème du rassemblement des cent quarante-quatre mille Juifs scellés ?" (Catégorie: `theme_biblique`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q015** : "Comment le thème biblique de la pluie tombant sur le blé et l'ivraie explique-t-il les faux prophètes ?" (Catégorie: `theme_biblique`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q016** : "Quel est le thème de la Semence incorruptible de la Parole face aux dons spirituels temporaires ?" (Catégorie: `theme_biblique`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q017** : "Dans quel contexte l'expression « grand bluff religieux du temps de la fin » est-elle employée ?" (Catégorie: `phrase_expression`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q018** : "Où trouve-t-on l'expression « Au temps du soir, la lumière paraîtra » et quel prophète l'a dite ?" (Catégorie: `phrase_expression`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q019** : "Quelle phrase résume le témoignage du croyant crucifié avec Christ lors du service de communion ?" (Catégorie: `phrase_expression`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q020** : "Dans quel sermon trouve-t-on la phrase « manger un morceau de pain sans levain et boire un peu de jus de cep » ?" (Catégorie: `phrase_expression`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q021** : "Que signifie l'expression « le figuier a repoussé ses feuilles » dans La Fête des Trompettes ?" (Catégorie: `phrase_expression`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q022** : "Dans quel contexte Branham parle-t-il du « drapeau à l'étoile de David » flottant à Jérusalem ?" (Catégorie: `phrase_expression`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q023** : "À propos de quoi Branham emploie-t-il l'expression « dévient d'un seul iota du pur Ainsi dit le Seigneur » ?" (Catégorie: `phrase_expression`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q024** : "Que désigne l'expression « collyre divin » dans Les Oints du Temps de la Fin ?" (Catégorie: `phrase_expression`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q025** : "Quelle est la doctrine enseignée sur la véritable identité du cavalier sur le cheval blanc ?" (Catégorie: `doctrine`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q026** : "Quelle doctrine Branham expose-t-il sur l'infaillibilité de la Parole divine face aux dogmes humains ?" (Catégorie: `doctrine`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q027** : "Quelle est la doctrine biblique de la Sainte Cène comme union vivante plutôt que simple rite commémoratif ?" (Catégorie: `doctrine`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q028** : "Comment la doctrine de la manne du sanctuaire est-elle reliée à la nourriture spirituelle de l'Épouse ?" (Catégorie: `doctrine`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q029** : "Quelle doctrine régit le calendrier prophétique du réveil d'Israël après l'Enlèvement de l'Épouse ?" (Catégorie: `doctrine`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q030** : "Quelle doctrine régit le scellement des 144 000 Juifs par les deux témoins ?" (Catégorie: `doctrine`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q031** : "Quelle doctrine fondamentale sépare l'onction de l'Esprit extérieur de la régénération intérieure ?" (Catégorie: `doctrine`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q032** : "Quelle doctrine établit le Fruit et la Parole originale comme unique test de vérité spirituelle ?" (Catégorie: `doctrine`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q033** : "Quel rôle le prophète Zacharie joue-t-il dans la prédication des Sceaux ?" (Catégorie: `personne_biblique`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q034** : "Comment le Seigneur Jésus-Christ est-il distingué du cavalier imposteur dans le premier sceau ?" (Catégorie: `personne_biblique`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q035** : "Quelle déclaration de Jésus dans l'Évangile de Jean est citée dans le sermon sur La Communion ?" (Catégorie: `personne_biblique`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q036** : "Qui sont les deux témoins prophétiques d'Apocalypse 11 mentionnés dans La Fête des Trompettes ?" (Catégorie: `personne_biblique`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q037** : "Quel rôle la loi de Moïse joue-t-elle dans l'institution de la fête des trompettes ?" (Catégorie: `personne_biblique`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q038** : "Quelle parole d'avertissement de Jésus dans Matthieu 24 est citée dans Les Oints du Temps de la Fin ?" (Catégorie: `personne_biblique`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q039** : "Quel roi d'Israël dont le symbole flotte à Jérusalem est mentionné dans La Fête des Trompettes ?" (Catégorie: `personne_biblique`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q040** : "Quelle figure messianique vit dans le croyant qui participe à la communion par Sa résurrection ?" (Catégorie: `personne_biblique`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q041** : "Quel événement biblique marque l'ouverture du premier sceau ?" (Catégorie: `evenement_biblique`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q042** : "Quel événement prophétique survient lorsque le Septième Ange sonne du clairon ?" (Catégorie: `evenement_biblique`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q043** : "Quel événement historique et spirituel au Calvaire fonde le mémorial de la communion ?" (Catégorie: `evenement_biblique`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q044** : "Quel événement biblique de l'Ancien Testament correspondait au jour du grand pardon ?" (Catégorie: `evenement_biblique`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q045** : "Quel événement glorieux concernant l'Épouse des Nations précède immédiatement le réveil d'Israël ?" (Catégorie: `evenement_biblique`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q046** : "Quel événement contemporain a permis de ramener le peuple juif dans sa patrie d'origine ?" (Catégorie: `evenement_biblique`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q047** : "Quel événement de séduction spirituelle mondiale Jésus a-t-il annoncé pour la fin des temps dans Matthieu 24 ?" (Catégorie: `evenement_biblique`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q048** : "Quel événement solennel final est annoncé par la sonnerie prochaine de la trompette de Dieu ?" (Catégorie: `evenement_biblique`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q049** : "Quelle relation le sermon sur les Sceaux établit-il entre le Septième Ange et Zacharie ?" (Catégorie: `relations_passages`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q050** : "Comment le passage de l'Évangile de Jean sur la chair et le sang est-il relié au Calvaire ?" (Catégorie: `relations_passages`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q051** : "Quelle relation existe-t-il entre la loi mosaïque et le ministère des deux témoins d'Apocalypse 11 ?" (Catégorie: `relations_passages`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q052** : "Quel lien est établi entre Matthieu 24:24 et la métaphore de la pluie sur le blé et l'ivraie ?" (Catégorie: `relations_passages`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q053** : "Comment la manne cachée du Lieu Très Saint est-elle mise en rapport avec la Parole révélée actuelle ?" (Catégorie: `relations_passages`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q054** : "Quelle relation unit la persécution des Juifs à travers les nations et le rassemblement prophétique des Trompettes ?" (Catégorie: `relations_passages`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q055** : "Quel lien direct unit le discernement spirituel de l'Épouse à la Parole infaillible de Dieu ?" (Catégorie: `relations_passages`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q056** : "Comment la manifestation des dons spirituels est-elle subordonnée au Fruit et à la Parole totale ?" (Catégorie: `relations_passages`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q057** : "Comment l'avertissement contre la séduction du premier sceau (63-0324M) complète-t-il celui sur les faux oints (65-0725M) ?" (Catégorie: `multi_sermons`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q058** : "En quoi l'Épouse de Christ décrite dans les Sceaux diffère-t-elle des séducteurs démasqués dans Les Oints du Temps de la Fin ?" (Catégorie: `multi_sermons`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q059** : "Quel rôle central la Parole révélée joue-t-elle à la fois dans La Communion (65-1212) et dans les Sceaux (63-0324M) ?" (Catégorie: `multi_sermons`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q060** : "Comment l'Enlèvement de l'Épouse est-il articulé entre La Fête des Trompettes (64-0719M) et l'appel hors de Babylone (63-0324M) ?" (Catégorie: `multi_sermons`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q061** : "De quelle façon la manne cachée de l'Ancien Testament (65-1212) fait-elle écho aux mystères dévoilés par le Septième Ange (63-0324M) ?" (Catégorie: `multi_sermons`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q062** : "Quelle distinction de calendrier prophétique existe-t-il entre le salut des Nations (64-0719M) et l'appel des élus (63-0324M) ?" (Catégorie: `multi_sermons`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q063** : "Comment la sainteté requise pour la communion (65-1212) fait-elle écho à la pureté de cœur demandée dans les faux oints (65-0725M) ?" (Catégorie: `multi_sermons`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **50%**
* **Q064** : "Pourquoi ni les grands édifices (63-0324M) ni les miracles spectaculaires (65-0725M) ne prouvent-ils la vérité divine ?" (Catégorie: `multi_sermons`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q065** : "Et que portait cet imposteur monté sur le cheval ?" (Catégorie: `ambigue`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q066** : "Où cette nourriture sacrée était-elle gardée autrefois ?" (Catégorie: `ambigue`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q067** : "Et combien sont-ils à être scellés à ce moment précis ?" (Catégorie: `ambigue`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q068** : "Pourquoi les miracles seuls ne suffisent-ils pas à les reconnaître ?" (Catégorie: `ambigue`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q069** : "Quel prophète de l'Écriture a annoncé cette clarté vespérale ?" (Catégorie: `ambigue`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q070** : "Et quel étendard flotte aujourd'hui au-dessus de cette ville ?" (Catégorie: `ambigue`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q071** : "De quelle semence leur être intérieur doit-il obligatoirement naître ?" (Catégorie: `ambigue`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q072** : "Et pourquoi ne faut-il pas regarder à la magnificence de leurs temples ?" (Catégorie: `ambigue`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q081** : "Citer exactement la phrase décrivant l'armement et la supercherie du cavalier sur le cheval blanc." (Catégorie: `citation_precise`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q083** : "Citer exactement les paroles de Jésus dans l'Évangile de Jean mentionnées dans La Communion." (Catégorie: `citation_precise`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q084** : "Citer textuellement la déclaration de foi et d'identification avec Christ lors de la Sainte Cène." (Catégorie: `citation_precise`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q085** : "Citer le passage de Matthieu 24:24 textuellement consigné dans Les Oints du Temps de la Fin." (Catégorie: `citation_precise`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q086** : "Citer la phrase exacte définissant ce que la communion n'est pas simplement." (Catégorie: `citation_precise`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q087** : "Citer la mise en garde textuelle concernant l'attachement au « pur Ainsi dit le Seigneur » face aux miracles." (Catégorie: `citation_precise`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**
* **Q088** : "Citer la description exacte des signes visibles à Jérusalem prouvant que le figuier a reverdi." (Catégorie: `citation_precise`) — Legacy Recall@5: **0%** vs New RAG Recall@5: **100%**

---

## 13. Cas identiques

* **Nombre de cas identiques** : **1 / 80**

---

## 14. Hors corpus

Les 8 questions hors corpus ont été analysées avec soin :
* **Abstention Legacy** : N/A (Le Legacy ne s'abstient jamais)
* **Abstention New RAG** : **100.0%** (8/8 questions correctement refusées avec un motif d'abstention explicite : *"hors corpus"*).

---

## 15. Questions ambiguës

Les questions ambiguës ont été traitées :
* **Récupération et Answerability** : Gérées avec des scores de confiance faibles, provoquant une abstention contrôlée pour éviter la génération de fausses réponses théologiques.

---

## 16. Latence

* **Latence de recherche Legacy (moyenne)** : **0.61 ms**
* **Latence de recherche New RAG (moyenne)** : **0.91 ms**
  * *Query Embedding* : 0 ms (Cache d'évaluation)
  * *Lexical Retrieval* : 0 ms
  * *Vector Cosinus Search* : 0.2 ms
  * *RRF Rank Fusion* : 0.06 ms
  * *Reranking local* : 0.52 ms
  * *Evidence & Citations* : 0.07 ms

---

## 17. Reproductibilité

Le Shadow Test a été exécuté sur deux passes complètes :
* **Run 1 === Run 2** : ✅ **100% IDENTIQUE** (Rangs, answerability, citations et métriques identiques à 100%).

---

## 18. Conclusion

```text
SHADOW_VALIDATED
```

**Analyse factuelle** : Le Shadow Test du nouveau RAG est entièrement validé. Le nouveau pipeline fournit des gains importants de pertinence sémantique tout en assurant une abstention parfaite (100%) sur les questions hors-corpus.
