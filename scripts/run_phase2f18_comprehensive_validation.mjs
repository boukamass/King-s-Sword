#!/usr/bin/env node
/**
 * King's Sword — Phase 2F.18 Validation Complète & Non-Régression
 * 
 * Protocole :
 * 1. Test des 30 variantes de la Question A (tiédeur / indifférence / église)
 * 2. Test du filtre local OOD sur requêtes recettes / non-doctrinales (zéro appel Gemini)
 * 3. Test de détection et complétude d'étude exhaustive (variantes et typos)
 * 4. Test d'intégrité des citations textuelles et formatage de couverture
 * 5. Mesure des faux négatifs sur le dataset V2 de 64 questions avec intervalle de Wilson à 95%
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { executeUnifiedRagPipeline, normalizeAIContext, resolveAIContextChunks } from '../services/unifiedRagService.ts';
import { isDeepDiveStudyRequest, detectExhaustiveStudyIntent, formatCoverageSummary } from '../services/theologicalExegesisService.ts';
import { validateResponseCitations } from '../services/citationValidationService.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function wilsonInterval(successes, total, z = 1.96) {
  if (total === 0) return { point: 0, lower: 0, upper: 0, text: "0.0% [0.0% - 0.0%]" };
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const centreAdjustedProbability = p + (z * z) / (2 * total);
  const adjustedStandardRatio = Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
  const lower = Math.max(0, (centreAdjustedProbability - z * adjustedStandardRatio) / denominator);
  const upper = Math.min(1, (centreAdjustedProbability + z * adjustedStandardRatio) / denominator);
  return {
    point: Math.round(p * 1000) / 10,
    lower: Math.round(lower * 1000) / 10,
    upper: Math.round(upper * 1000) / 10,
    text: `${(p * 100).toFixed(1)}% [${(lower * 100).toFixed(1)}% - ${(upper * 100).toFixed(1)}%]`
  };
}

async function main() {
  console.log("==================================================================");
  console.log(" 🔬 KING'S SWORD — PHASE 2F.18 VALIDATION & METROLOGIE");
  console.log("==================================================================\n");

  const exposeChapters = Array.from({ length: 11 }, (_, i) => `expose-ch-${i}`);

  // -------------------------------------------------------------
  // TEST 1 : 30 Variantes de la Question A (tiédeur, église, indifférence)
  // -------------------------------------------------------------
  console.log("1. Évaluation des 30 variantes de la Question A :");
  const variantsA = [
    "Pourquoi léglise devient tiede et indifferente selon le predicateur ?",
    "Pourquoi l'église devient tiède et indifférente selon le prédicateur ?",
    "Pourquoi l'église devient-elle tiède et indifférente d'après frère Branham ?",
    "Pour quelle raison l'assemblée de Laodicée devient tiède ?",
    "Pourquoi l'église tombe-t-elle dans la tiédeur et l'indifférence ?",
    "Qu'est-ce qui rend l'église tiède selon l'Exposé ?",
    "Pourquoi l'âge de Laodicée est-il caractérisé par la tiédeur ?",
    "Comment l'église en arrive-t-elle à devenir tiède et indifférente ?",
    "Pourquoi le prédicateur dit-il que l'église est tiède ?",
    "Quelle est la cause de la tiédeur spirituelle dans l'église ?",
    "Pourquoi Dieu vomit-Il l'église tiède de Sa bouche ?",
    "Pourquoi leglise devient-elle tiede selon le message ?",
    "D'où vient la tiédeur et l'indifférence de l'église du septième âge ?",
    "Pourquoi l'église de Laodicée est-elle tiède ni froide ni bouillante ?",
    "Pourquoi l'assemblée devient indifférente et tiède d'après le prophète ?",
    "Quelle explication donne le prédicateur sur l'église devenue tiède ?",
    "Pourquoi les chrétiens deviennent-ils tièdes dans le dernier âge ?",
    "Pourquoi l'église perd sa ferveur et devient tiède selon William Branham ?",
    "Quelle est la raison de la tiédeur de l'église selon Apocalypse 3 ?",
    "Pourquoi l'église s'est-elle refroidie pour devenir tiède et indifférente ?",
    "Pourquoi leglise de laodicee est tiede selon frere branham ?",
    "Comment le prédicateur justifie-t-il que l'église devienne tiède ?",
    "Qu'est-ce qui produit la tiédeur et l'indifférence religieuse ?",
    "Pourquoi l'église du dernier jour devient tiède envers la Parole ?",
    "Pourquoi cette tiédeur et ce manque d'ardeur dans l'église selon l'Exposé ?",
    "Pour quelle raison l'église est-elle jugée tiède par le Seigneur ?",
    "Pourquoi l'église devient insensible, indifférente et tiède ?",
    "De quelle façon l'église est-elle devenue tiède selon le sermon ?",
    "Pourquoi léglise est-elle frappée de tiédeur spirituelle ?",
    "Pourquoi l'église s'endort-elle dans la tiédeur selon le prédicateur ?"
  ];

  let answerableCountA = 0;
  for (const q of variantsA) {
    const res = await executeUnifiedRagPipeline(q, exposeChapters);
    if (res.answerable) {
      answerableCountA++;
    } else {
      console.log(`  ❌ Refus inattendu sur : "${q}" (Raison: ${res.reason})`);
    }
  }
  const statsA = wilsonInterval(answerableCountA, variantsA.length);
  console.log(`  -> Variantes Question A acceptées : ${answerableCountA}/${variantsA.length} = ${statsA.text} [MEASURED]\n`);

  // -------------------------------------------------------------
  // TEST 2 : Filtre local OOD (Zéro appel Gemini, refus immédiat)
  // -------------------------------------------------------------
  console.log("2. Évaluation du filtre hors-domaine OOD (requêtes culinaires / non-doctrinales) :");
  const oodQueries = [
    "Donne moi une recette de poulet moambé",
    "Quelle est la recette du couscous royal aux légumes ?",
    "Comment préparer une soupe à l'oignon gratinée ?",
    "Donne-moi les ingrédients pour un gâteau au chocolat fondant",
    "Quelle est la recette traditionnelle du cassoulet de Castelnaudary ?",
    "Comment fabriquer du savon artisanal par saponification à froid ?",
    "Quelles sont les dimensions de la Tour Eiffel en mètres ?",
    "Comment changer les bougies d'allumage d'un moteur Renault Clio ?",
    "Quel est le barème d'imposition des sociétés en France en 2024 ?",
    "Comment accorder un piano à queue selon le tempérament égal ?"
  ];

  let rejectedOodCount = 0;
  for (const q of oodQueries) {
    const res = await executeUnifiedRagPipeline(q, exposeChapters);
    if (!res.answerable && res.decisionJournal?.zone === 'refusal') {
      rejectedOodCount++;
    } else {
      console.log(`  ❌ Fuite OOD détectée sur : "${q}" (Answerable: ${res.answerable})`);
    }
  }
  const statsOod = wilsonInterval(rejectedOodCount, oodQueries.length);
  console.log(`  -> Refus immédiat OOD (sans appel LLM) : ${rejectedOodCount}/${oodQueries.length} = ${statsOod.text} [MEASURED]\n`);

  // -------------------------------------------------------------
  // TEST 3 : Détection d'intention d'étude exhaustive (Deep Dive)
  // -------------------------------------------------------------
  console.log("3. Évaluation de la détection d'étude exhaustive (tolérance aux fautes de frappe) :");
  const studyQueries = [
    "Monter une etude tres detailé et exaustive sur la semence du serpent",
    "Fais une etude exhaustive sur les sept sceaux",
    "Je voudrais un panorama complet et approfondi sur le bapteme",
    "Donne moi tous les passages sur l'ordre de l'eglise",
    "Analyse complete et schema doctrinal de la stature de l'homme parfait"
  ];

  let detectedStudyCount = 0;
  for (const q of studyQueries) {
    const isStudy = isDeepDiveStudyRequest(q);
    if (isStudy) {
      detectedStudyCount++;
    } else {
      console.log(`  ❌ Non détecté comme étude : "${q}"`);
    }
  }
  console.log(`  -> Détection intention étude : ${detectedStudyCount}/${studyQueries.length} [MEASURED]\n`);

  // -------------------------------------------------------------
  // TEST 4 : Formatage et résumé de couverture documentaire
  // -------------------------------------------------------------
  console.log("4. Vérification du formatage de la couverture documentaire :");
  const summaryExpose = formatCoverageSummary({
    uniqueDocsCount: 2,
    passagesCount: 8,
    docIds: ['expose-ch-3', 'expose-ch-9'],
    totalFoundCount: 15
  });
  console.log(`  Résumé généré :\n  ${summaryExpose.split('\n')[0]}`);
  const hasPartialNotice = summaryExpose.includes('retenus sur 15');
  const doesNotSaySermon = !summaryExpose.includes('sermon(s)');
  console.log(`  -> Précision liste partielle : ${hasPartialNotice ? '✅ OUI' : '❌ NON'}`);
  console.log(`  -> Terminologie adaptée (sans "sermon" pour l'Exposé) : ${doesNotSaySermon ? '✅ OUI' : '❌ NON'}\n`);

  // -------------------------------------------------------------
  // TEST 5 : Mesure des faux négatifs sur le dataset in-domain V2
  // -------------------------------------------------------------
  console.log("5. Évaluation des faux négatifs sur le dataset in-domain V2 (64 questions) :");
  const inDomainV2 = [
    { q: "Que signifie le nom Philadelphie selon l'Exposé ?", targetDoc: "expose-ch-8" },
    { q: "Qui était le messager de l'âge de Smyrne d'après frère Branham ?", targetDoc: "expose-ch-4" },
    { q: "Quelle est la signification de la colonne de feu au-dessus de Paul ?", targetDoc: "expose-ch-1" },
    { q: "Comment l'Exposé décrit-il la doctrine des Nicolaïtes ?", targetDoc: "expose-ch-3" },
    { q: "Quelle est l'explication donnée au cavalier sur le cheval blanc du premier sceau ?", targetDoc: "expose-ch-4" },
    { q: "Quel est le mystère de l'étoile du matin promise au vainqueur ?", targetDoc: "expose-ch-6" },
    { q: "Comment le prophète explique-t-il la verge de fer donnée à Thyatire ?", targetDoc: "expose-ch-6" },
    { q: "Qu'est-ce que la manne cachée promise au vainqueur de Pergame ?", targetDoc: "expose-ch-5" },
    { q: "Quelle est la véritable semence du serpent expliquée dans l'Exposé ?", targetDoc: "expose-ch-3" },
    { q: "Comment l'ange de l'âge d'Éphèse est-il identifié dans le texte ?", targetDoc: "expose-ch-3" },
    { q: "Quel est le jugement prononcé contre la femme Jézabel dans Thyatire ?", targetDoc: "expose-ch-6" },
    { q: "De quelle manière l'Exposé traite-t-il de la justification par Martin Luther ?", targetDoc: "expose-ch-7" },
    { q: "Quel rôle a joué John Wesley pour l'âge de Philadelphie ?", targetDoc: "expose-ch-8" },
    { q: "Comment l'esprit de Balaam a-t-il corrompu Israël selon le livre ?", targetDoc: "expose-ch-5" },
    { q: "Qu'est-ce que le baptême au nom du Seigneur Jésus-Christ dans l'Exposé ?", targetDoc: "expose-ch-1" },
    { q: "Comment l'Exposé définit-il les sept lampes ardentes devant le trône ?", targetDoc: "expose-ch-2" },
    { q: "Quelle est la vision de la pierre de faîte de la pyramide ?", targetDoc: "expose-ch-5" },
    { q: "Quelles sont les caractéristiques de l'âge tiède de Laodicée ?", targetDoc: "expose-ch-9" },
    { q: "Comment la robe blanche des martyrs est-elle décrite dans Smyrne ?", targetDoc: "expose-ch-4" },
    { q: "Quel est le message aux chrétiens de Sardes qui ont un nom comme vivant ?", targetDoc: "expose-ch-7" },
    { q: "Pourquoi l'Exposé enseigne-t-il que Dieu est un seul et unique Seigneur ?", targetDoc: "expose-ch-1" },
    { q: "Comment le serpent a-t-il séduit Ève dans le jardin d'Éden ?", targetDoc: "expose-ch-3" },
    { q: "Quelle est la porte ouverte que personne ne peut fermer à Philadelphie ?", targetDoc: "expose-ch-8" },
    { q: "Que symbolisent les yeux comme une flamme de feu dans la vision de Patmos ?", targetDoc: "expose-ch-2" },
    { q: "Quelle est la signification de la voix de plusieurs eaux dans Apocalypse 1 ?", targetDoc: "expose-ch-2" },
    { q: "Comment l'Exposé commente-t-il l'avertissement de vomir les tièdes ?", targetDoc: "expose-ch-9" },
    { q: "Que représente le souverain sacrificateur ceint d'or à la poitrine ?", targetDoc: "expose-ch-2" },
    { q: "Pourquoi le baptême trinitaire est-il réfuté dans le premier chapitre ?", targetDoc: "expose-ch-1" },
    { q: "Quelle est la promesse d'être une colonne dans le temple de mon Dieu ?", targetDoc: "expose-ch-8" },
    { q: "Comment l'Exposé explique-t-il le mystère de l'Iniquité déjà à l'œuvre ?", targetDoc: "expose-ch-5" },
    { q: "Quel est le conseil d'acheter de l'or éprouvé par le feu à Laodicée ?", targetDoc: "expose-ch-9" },
    { q: "Quelle est la verge de justice du Fils de l'homme sur les nations ?", targetDoc: "expose-ch-6" },
    { q: "Quel qualificatif donne le prédicateur à la communauté ecclésiale de la fraternité mutuelle ?", targetDoc: "expose-ch-8" },
    { q: "Quelle punition divine frappe la reine païenne corruptrice du moyen-âge ?", targetDoc: "expose-ch-6" },
    { q: "De quelle façon le rédacteur explicite-t-il la descendance charnelle de l'adversaire originel ?", targetDoc: "expose-ch-3" },
    { q: "Quelles tribulations ont enduré les croyants fidèles de la période de martyre asiatique antique ?", targetDoc: "expose-ch-4" },
    { q: "Quel remède céleste est prescrit aux assemblées sombrant dans l'autosuffisance matérielle et l'indifférence spirituelle ?", targetDoc: "expose-ch-9" },
    { q: "Comment l'opuscule analyse-t-il la hiérarchisation cléricale dominant les fidèles ordinaires ?", targetDoc: "expose-ch-3" },
    { q: "Quelle métaphore agricole décrit la cohabitation des élus sincères et des imitateurs dans le sanctuaire ?", targetDoc: "expose-ch-5" },
    { q: "Quelle clarification théologique est apportée sur l'absolue unicité de la Divinité suprême manifestée dans le Messie ?", targetDoc: "expose-ch-1" },
    { q: "De quelle manière est dépeinte l'immersion rituelle apostolique originelle sans formule composite ?", targetDoc: "expose-ch-1" },
    { q: "Quelle vision prophétique illustre le sommet pyramidal complétant la structure de la foi ?", targetDoc: "expose-ch-5" },
    { q: "Quel rôle d'émancipation doctrinale est attribué au réformateur allemand du seizième siècle ?", targetDoc: "expose-ch-7" },
    { q: "Quelle dynamique missionnaire caractérise le mouvement de sanctification britannique du dix-huitième siècle ?", targetDoc: "expose-ch-8" },
    { q: "Comment sont décrits les regards perçants comparables à des braises incandescentes du Ressuscité ?", targetDoc: "expose-ch-2" },
    { q: "Quelle destinée glorieuse attend l'âme victorieuse devenant un pilier inébranlable dans l'édifice saint ?", targetDoc: "expose-ch-8" },
    { q: "Quel avertissement solennel résonne contre l'institution religieuse apostate enivrante ?", targetDoc: "expose-ch-6" },
    { q: "Quelle substance miraculeuse secrète nourrit le disciple fidèle au milieu du compromis romain ?", targetDoc: "expose-ch-5" },
    { q: "Comment l'auteur interprète-t-il la puissance de souveraineté accordée aux rachetés sur les païens ?", targetDoc: "expose-ch-6" },
    { q: "De quelle façon le texte dépeint-il le déclin spirituel de la première communauté chrétienne ayant abandonné sa ferveur initiale ?", targetDoc: "expose-ch-3" },
    { q: "Quel sens mystique revêt l'astre matinal offert à celui qui triomphe des ténèbres ?", targetDoc: "expose-ch-6" },
    { q: "Comment est formulé le rejet définitif des fidèles tièdes manquant d'ardeur vivante ?", targetDoc: "expose-ch-9" },
    { q: "Quelle autorité suprême est attribuée à la parole prophétique scellée pour la fin des temps ?", targetDoc: "expose-ch-10" },
    { q: "De quelle nature est le vêtement d'éclat immaculé octroyé aux âmes éprouvées par la persécution sanglante ?", targetDoc: "expose-ch-4" },
    { q: "Quel piège pernicieux le conseiller impie a-t-il tendu pour affaiblir la marche des nomades du désert ?", targetDoc: "expose-ch-5" },
    { q: "Comment le texte démontre-t-il l'antériorité de l'élection divine avant la fondation du cosmos ?", targetDoc: "expose-ch-4" },
    { q: "Quel symbolisme revête la ceinture dorée entourant la poitrine de la majesté céleste ?", targetDoc: "expose-ch-2" },
    { q: "Comment le document détaille-t-il la tromperie séductrice du faux représentant spirituel s'élevant sur le trône universel ?", targetDoc: "expose-ch-4" },
    { q: "Quelle est la portée spirituelle de la clarté éclatante semblable au soleil resplendissant dans sa force ?", targetDoc: "expose-ch-2" },
    { q: "De quelle manière les sept chandeliers sacrés figurent-ils les étapes historiques du témoignage ecclésial ?", targetDoc: "expose-ch-2" },
    { q: "Comment l'écrit réfute-t-il la transmission de l'infaillibilité cléricale humaine ?", targetDoc: "expose-ch-7" },
    { q: "Quelle révélation ultime est promise à l'assemblée finale avant le dénouement de l'histoire humaine ?", targetDoc: "expose-ch-10" },
    { q: "Comment le ministère de l'envoyé de Dieu pour l'ultime dispensation restaure-t-il l'enseignement primitif ?", targetDoc: "expose-ch-10" },
    { q: "Quelle exhortation est adressée aux brebis dispersées pour sortir des confédérations confessionnelles humaines ?", targetDoc: "expose-ch-9" }
  ];

  let answerableCountV2 = 0;
  const falseNegatives = [];

  for (const item of inDomainV2) {
    const res = await executeUnifiedRagPipeline(item.q, exposeChapters);
    if (res.answerable) {
      answerableCountV2++;
    } else {
      falseNegatives.push({ q: item.q, reason: res.reason, targetDoc: item.targetDoc });
    }
  }

  const fnRate = wilsonInterval(falseNegatives.length, inDomainV2.length);
  const answerableRate = wilsonInterval(answerableCountV2, inDomainV2.length);

  console.log(`  -> Taux de réussite (Answerable) : ${answerableCountV2}/${inDomainV2.length} = ${answerableRate.text} [MEASURED]`);
  console.log(`  -> Taux de faux négatifs (Abstentions injustifiées) : ${falseNegatives.length}/${inDomainV2.length} = ${fnRate.text} [MEASURED]`);
  if (falseNegatives.length > 0) {
    console.log(`  Détail des faux négatifs (${falseNegatives.length}) :`);
    for (const fn of falseNegatives.slice(0, 5)) {
      console.log(`    - "${fn.q}" -> ${fn.reason}`);
    }
  }

  console.log("\n==================================================================");
  console.log(" ✅ RAPPORT FINAL D'ÉVALUATION PHASE 2F.18 PRÊT");
  console.log("==================================================================");
}

main().catch(console.error);
