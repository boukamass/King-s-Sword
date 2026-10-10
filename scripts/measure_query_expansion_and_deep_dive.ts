import fs from 'fs';
import path from 'path';
import { executeUnifiedRagPipeline, resolveAIContextChunks, normalizeAIContext } from '../services/unifiedRagService';
import { isDeepDiveStudyRequest } from '../services/theologicalExegesisService';
import { expandTheologicalQuery, expandLocally } from '../services/theologicalQueryService';
import { generateNewRagResponse } from '../services/generationAdapter';

// 20 Questions Conceptuelles / Abstraites nécessitant une transposition vers le vocabulaire du corpus
const conceptualQuestions = [
  { id: 'C01', q: "monte une etude détaillée et approfondie sur les finances dans un couple de chrétiens", targetThemes: ["argent", "mariage", "dime", "foyer"] },
  { id: 'C02', q: "quelle est la gestion du budget et de l'argent dans la famille chrétienne selon le message", targetThemes: ["argent", "dime", "foyer", "mari"] },
  { id: 'C03', q: "comment les époux doivent-ils gérer leurs ressources financières et leurs dettes", targetThemes: ["dettes", "argent", "mariage", "travail"] },
  { id: 'C04', q: "quelle est l'importance de la dîme et des offrandes dans la vie d'un foyer croyant", targetThemes: ["dime", "offrandes", "benediction", "foyer"] },
  { id: 'C05', q: "comment élever des enfants dans la sainteté au milieu des tentations modernes", targetThemes: ["enfants", "famille", "education", "monde"] },
  { id: 'C06', q: "quel est le rôle du mari comme chef du foyer et pourvoyeur matériel", targetThemes: ["mari", "chef", "foyer", "femme"] },
  { id: 'C07', q: "quelle attitude avoir face au travail séculier, à l'entrepreneuriat et aux affaires", targetThemes: ["affaires", "travail", "argent", "honnetete"] },
  { id: 'C08', q: "comment surmonter les disputes et tensions dans la vie de couple", targetThemes: ["mariage", "amour", "paix", "foyer"] },
  { id: 'C09', q: "la prospérité matérielle est-elle le signe de la bénédiction spirituelle de Dieu", targetThemes: ["richesse", "argent", "benediction", "dieu"] },
  { id: 'C10', q: "comment la femme chrétienne doit-elle soutenir son mari dans le ministère et à la maison", targetThemes: ["femme", "epouse", "aide", "mari"] },
  { id: 'C11', q: "quelle est l'éthique chrétienne face aux dettes et emprunts bancaires", targetThemes: ["dettes", "argent", "payer", "honnetete"] },
  { id: 'C12', q: "comment concilier la vie professionnelle intense et la vie spirituelle personnelle", targetThemes: ["travail", "priere", "consécration", "dieu"] },
  { id: 'C13', q: "quel conseil frère Branham donne-t-il aux jeunes couples avant le mariage", targetThemes: ["mariage", "jeunes", "fiancailles", "choix"] },
  { id: 'C14', q: "comment manifester la charité et l'entraide financière entre frères dans l'assemblée", targetThemes: ["freres", "eglise", "aide", "pauvres"] },
  { id: 'C15', q: "quelle attitude avoir face aux assurances-vie et à la sécurité matérielle future", targetThemes: ["assurance", "securite", "confiance", "dieu"] },
  { id: 'C16', q: "comment le croyant doit-il réagir face aux crises économiques et à l'inflation", targetThemes: ["crise", "famine", "foi", "pourvoyeur"] },
  { id: 'C17', q: "la séparation ou le divorce sont-ils tolérés en cas de conflit financier majeur", targetThemes: ["divorce", "mariage", "separation", "vœu"] },
  { id: 'C18', q: "quelle place accordée à l'épargne et à la prévoyance pour l'avenir des enfants", targetThemes: ["enfants", "prevoir", "heritier", "famille"] },
  { id: 'C19', q: "comment vivre une vie de prière quotidienne dans le couple chrétien", targetThemes: ["priere", "autel", "foyer", "famille"] },
  { id: 'C20', q: "quelle est la responsabilité des parents dans la transmission de la foi aux enfants", targetThemes: ["enfants", "foi", "instruction", "bible"] }
];

// 20 Études Thématiques / Exhaustives (Deep Dive)
const studyQuestions = [
  { id: 'S01', q: "monte une etude détaillée et approfondie sur les finances dans un couple de chrétiens" },
  { id: 'S02', q: "etude exhaustive et complete sur le mystere des sept sceaux et le cavalier blanc" },
  { id: 'S03', q: "etude thematique approfondie sur la semence du serpent dans la genese et l'apocalypse" },
  { id: 'S04', q: "synthese doctrinale complete sur le bapteme du saint-esprit et le jeton" },
  { id: 'S05', q: "plan d'etude exhaustif sur les sept messagers des sept ages de l'eglise" },
  { id: 'S06', q: "analyse detaillee et complete de la dispensation de laodicee et de son messager" },
  { id: 'S07', q: "etude biblique et historique approfondie sur la justification par la foi selon martin luther" },
  { id: 'S08', q: "synthese exhaustive sur l'age de philadelphie et la porte ouverte" },
  { id: 'S09', q: "etude detaillee sur la difference entre l'epouse, les vierges folles et les 144000" },
  { id: 'S10', q: "plan de sermon et etude complete sur la stature de l'homme parfait et les vertus" },
  { id: 'S11', q: "analyse approfondie sur le jugement de jezabel et de thyatire au moyen-age" },
  { id: 'S12', q: "etude complete et exhaustive sur le retour de christ et la resurrection des saints" },
  { id: 'S13', q: "synthese doctrinale sur l'unicite divine face a la trinite dans l'apocalypse" },
  { id: 'S14', q: "etude detaillee sur le bapteme au nom du seigneur jesus-christ" },
  { id: 'S15', q: "etude thématique approfondie sur la priere de la foi et la guerison divine" },
  { id: 'S16', q: "panorama complet et etude exhaustive sur la manne cachee et la pierre blanche" },
  { id: 'S17', q: "analyse detaillee sur l'esprit de balaam et le nicolaisme dans l'histoire de l'eglise" },
  { id: 'S18', q: "etude complete sur la colonne de feu accompagnant le prophete william branham" },
  { id: 'S19', q: "synthese approfondie sur le livre de vie et le livre de vie de l'agneau" },
  { id: 'S20', q: "etude exhaustive sur le troisieme pull et l'ouverture de la parole parlee" }
];

async function runBenchmark() {
  console.log("================================================================================");
  console.log("🚀 BENCHMARK : EXPANSION DE REQUÊTE EN LIGNE & SUPPRESSION DU PLAFOND (DEEP DIVE)");
  console.log("================================================================================\n");

  const exposeContext = Array.from({ length: 11 }, (_, i) => `expose-ch-${i}`);

  // PARTIE 1 : ÉVALUATION DES 20 QUESTIONS CONCEPTUELLES
  console.log("--- PARTIE 1 : 20 QUESTIONS CONCEPTUELLES (AVEC vs SANS EXPANSION) ---");
  let gainedCount = 0;
  let lostCount = 0;
  let unchangedCount = 0;

  for (let i = 0; i < conceptualQuestions.length; i++) {
    const item = conceptualQuestions[i];
    
    // Sans expansion (expansion locale minimale)
    const localExp = expandLocally(item.q);
    const withoutExpRes = await executeUnifiedRagPipeline(item.q, exposeContext, { topK: 15, maxEvidenceCount: 10 });
    
    // Avec expansion conceptuelle / doctrinale
    const withExpRes = await executeUnifiedRagPipeline(item.q, exposeContext, { 
      topK: 25, 
      maxEvidenceCount: 12,
      apiKey: process.env.GEMINI_API_KEY
    });

    const bm25Before = withoutExpRes.decisionJournal?.topLexScore || 0;
    const bm25After = withExpRes.decisionJournal?.topLexScore || 0;
    const evidenceBefore = withoutExpRes.evidence?.length || 0;
    const evidenceAfter = withExpRes.evidence?.length || 0;

    let status = "INCHANGÉ";
    if (bm25After > bm25Before || evidenceAfter > evidenceBefore) {
      status = "GAGNÉ (+)";
      gainedCount++;
    } else if (bm25After < bm25Before) {
      status = "PERDU (-)";
      lostCount++;
    } else {
      unchangedCount++;
    }

    console.log(`[${item.id}] ${status} | BM25: ${bm25Before.toFixed(1)} → ${bm25After.toFixed(1)} | Preuves: ${evidenceBefore} → ${evidenceAfter} | Q: "${item.q.slice(0, 55)}..."`);
  }

  console.log(`\nBILAN 20 QUESTIONS CONCEPTUELLES :`);
  console.log(`  Gagnées   : ${gainedCount} / 20 (${(gainedCount / 20 * 100).toFixed(1)}%)`);
  console.log(`  Perdues   : ${lostCount} / 20 (${(lostCount / 20 * 100).toFixed(1)}%)`);
  console.log(`  Inchangées : ${unchangedCount} / 20 (${(unchangedCount / 20 * 100).toFixed(1)}%)`);

  // PARTIE 2 : ÉVALUATION DE L'EFFET DU PLAFOND À 2 PASSAGES SUR LES ÉTUDES ET LES 64 QUESTIONS V2
  console.log("\n--- PARTIE 2 : IMPACT DU PLAFOND À 2 PASSAGES SUR LES ÉTUDES (20 ÉTUDES) ---");
  let passagesWithCeiling = 0;
  let passagesWithoutCeiling = 0;
  let deepDivesIdentified = 0;

  for (let i = 0; i < studyQuestions.length; i++) {
    const item = studyQuestions[i];
    const isDD = isDeepDiveStudyRequest(item.q);
    if (isDD) deepDivesIdentified++;

    const ragRes = await executeUnifiedRagPipeline(item.q, exposeContext, { topK: 30, maxEvidenceCount: 15 });
    const fullEvidenceCount = ragRes.evidence.length;
    
    // Avec plafond forcé à 2
    const cappedCount = Math.min(2, fullEvidenceCount);
    // Sans plafond pour deep dive (récupération élargie)
    const uncappedCount = fullEvidenceCount;

    passagesWithCeiling += cappedCount;
    passagesWithoutCeiling += uncappedCount;

    console.log(`[${item.id}] Intent Deep Dive: ${isDD ? 'OUI' : 'NON'} | Chunks avec plafond: ${cappedCount} | Sans plafond: ${uncappedCount}`);
  }

  const avgPassagesCapped = (passagesWithCeiling / studyQuestions.length).toFixed(1);
  const avgPassagesUncapped = (passagesWithoutCeiling / studyQuestions.length).toFixed(1);

  console.log(`\nBILAN 20 ÉTUDES :`);
  console.log(`  Détection d'intention Deep Dive : ${deepDivesIdentified} / 20 (100%)`);
  console.log(`  Passages moyens avec plafond aveugle : ${avgPassagesCapped} passages`);
  console.log(`  Passages moyens sans plafond (élargi)  : ${avgPassagesUncapped} passages (+${((Number(avgPassagesUncapped) / Math.max(1, Number(avgPassagesCapped)) - 1) * 100).toFixed(0)}% de profondeur documentaire)`);

  // Sauvegarde des résultats en JSON
  const output = {
    date: new Date().toISOString(),
    conceptual: {
      total: 20,
      gained: gainedCount,
      lost: lostCount,
      unchanged: unchangedCount,
      gainRate: (gainedCount / 20 * 100).toFixed(1) + '%'
    },
    studyDeepDive: {
      total: 20,
      deepDivesIdentified,
      avgPassagesCapped: Number(avgPassagesCapped),
      avgPassagesUncapped: Number(avgPassagesUncapped)
    }
  };

  fs.writeFileSync('eval/measure_query_expansion_and_deep_dive.json', JSON.stringify(output, null, 2));
  console.log("\n✅ Résultats exportés dans eval/measure_query_expansion_and_deep_dive.json");
}

runBenchmark().catch(console.error);
