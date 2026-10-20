import fs from 'fs';
import path from 'path';
import { performHybridSearch } from '../services/hybridRetrievalService';
import { buildRetrievalEvidencePackage } from '../services/retrievalEvidenceService';

async function main() {
  console.log("=========================================================================================================");
  console.log("  KINGS' SWORD — CALIBRAGE DU SEUIL D'ANSWERABILITY SUR LE JEU DEV (30 REQUÊTES)");
  console.log("=========================================================================================================\n");

  const queriesPath = path.join(process.cwd(), 'eval', 'queries.json');
  if (!fs.existsSync(queriesPath)) {
    console.error(`❌ ERREUR : Le fichier ${queriesPath} n'existe pas.`);
    process.exit(1);
  }

  const allQueries: any[] = JSON.parse(fs.readFileSync(queriesPath, 'utf8'));
  const devQueries = allQueries.filter(q => q.set === 'dev');
  const testQueries = allQueries.filter(q => q.set === 'test');

  const annotatedDev = devQueries.filter(q => q.expectedAnswerable && q.expectedRefs.length > 0).length;
  if (annotatedDev === 0) {
    console.warn("⚠️  ATTENTION : Le fichier eval/queries.json contient un gabarit de 50 requêtes avec des champs expectedRefs VIDES.");
    console.warn("   Conformément aux consignes de l'Étape 10, le calibrage ne s'exécutera qu'une fois les paragraphes annotés.");
    console.warn("\n📌 Veuillez d'abord compléter eval/queries.json selon le guide eval/ANNOTATION_GUIDE.md.");
    process.exit(0);
  }

  console.log(`Balayage du seuil de confiance Cosinus de 0.10 à 0.40 (pas de 0.02) sur ${devQueries.length} requêtes Dev...\n`);

  // Plage de balayage : 0.10, 0.12, 0.14, 0.16, 0.18, 0.20, 0.22, 0.24, 0.26, 0.28, 0.30, 0.32, 0.34, 0.36, 0.38, 0.40
  const thresholds: number[] = [];
  for (let t = 0.10; t <= 0.405; t += 0.02) {
    thresholds.push(Number(t.toFixed(2)));
  }

  const calibrationTable: Array<{
    threshold: number;
    falseRefusals: number;
    falseAnswers: number;
    totalErrors: number;
  }> = [];

  // Pré-calcul des résultats de recherche pour accélérer le balayage
  const devSearchResults: Array<{
    queryObj: any;
    searchRes: any;
  }> = [];

  for (const q of devQueries) {
    const searchRes = await performHybridSearch(q.query, { topK: 10, scope: q.scope });
    devSearchResults.push({ queryObj: q, searchRes });
  }

  // Évaluation de chaque seuil sur le jeu Dev
  for (const th of thresholds) {
    let falseRefusals = 0; // expectedAnswerable=true mais answerable=false
    let falseAnswers = 0;  // expectedAnswerable=false mais answerable=true

    for (const item of devSearchResults) {
      const q = item.queryObj;
      const pkg = await buildRetrievalEvidencePackage(q.query, item.searchRes, {
        topK: 10,
        confidenceThreshold: th
      });

      if (q.expectedAnswerable && !pkg.answerable) {
        falseRefusals++;
      } else if (!q.expectedAnswerable && pkg.answerable) {
        falseAnswers++;
      }
    }

    calibrationTable.push({
      threshold: th,
      falseRefusals,
      falseAnswers,
      totalErrors: falseRefusals + falseAnswers
    });
  }

  console.log("---------------------------------------------------------------------------------------------------------");
  console.log("SEUIL COSINUS | FAUX REFUS (Answerable refusés) | FAUSSES RÉPONSES (Pièges acceptés) | TOTAL ERREURS");
  console.log("---------------------------------------------------------------------------------------------------------");

  let optimalThresholdObj = calibrationTable[0];
  for (const row of calibrationTable) {
    const isCurrentBest = row.totalErrors < optimalThresholdObj.totalErrors ||
      (row.totalErrors === optimalThresholdObj.totalErrors && row.falseAnswers < optimalThresholdObj.falseAnswers);
    
    if (isCurrentBest) {
      optimalThresholdObj = row;
    }

    const thStr = row.threshold.toFixed(2).padStart(13);
    const frStr = row.falseRefusals.toString().padStart(31);
    const faStr = row.falseAnswers.toString().padStart(34);
    const errStr = row.totalErrors.toString().padStart(14);
    const star = row.threshold === optimalThresholdObj.threshold ? " ⭐ OPTIMAL DEV" : "";

    console.log(`${thStr} | ${frStr} | ${faStr} | ${errStr}${star}`);
  }

  console.log("---------------------------------------------------------------------------------------------------------\n");
  console.log(`💡 PROPOSITION DU SEUIL OPTIMAL (Calculé sur Dev) : ${optimalThresholdObj.threshold.toFixed(2)} (Total erreurs: ${optimalThresholdObj.totalErrors})`);
  console.log("⚠️  Note : Ce seuil N'EST PAS APPLIQUÉ AUTOMATIQUEMENT dans le code (baseline préservée).\n");

  // Vérification unique sur le jeu TEST (20 requêtes blind)
  console.log(`--- VÉRIFICATION UNIQUE DU SEUIL PROPOSÉ (${optimalThresholdObj.threshold.toFixed(2)}) SUR LES 20 REQUÊTES TEST BLIND ---`);

  let testFalseRefusals = 0;
  let testFalseAnswers = 0;

  for (const q of testQueries) {
    const searchRes = await performHybridSearch(q.query, { topK: 10, scope: q.scope });
    const pkg = await buildRetrievalEvidencePackage(q.query, searchRes, {
      topK: 10,
      confidenceThreshold: optimalThresholdObj.threshold
    });

    if (q.expectedAnswerable && !pkg.answerable) {
      testFalseRefusals++;
    } else if (!q.expectedAnswerable && pkg.answerable) {
      testFalseAnswers++;
    }
  }

  console.log(`- Faux Refus sur jeu Test    : ${testFalseRefusals}`);
  console.log(`- Fausses Réponses sur Test  : ${testFalseAnswers}`);
  console.log(`- Total Erreurs sur Test     : ${testFalseRefusals + testFalseAnswers} / ${testQueries.length}`);
  console.log("=========================================================================================================\n");
}

main().catch(err => {
  console.error("Fatal calibration error:", err);
  process.exit(1);
});
