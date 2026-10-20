import fs from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';
import { performHybridSearch } from '../services/hybridRetrievalService';
import { buildRetrievalEvidencePackage } from '../services/retrievalEvidenceService';
import { loadExposeAsCanonicalDocuments } from '../services/exposeDocumentService';
import { getSermonsMetadata } from '../services/db';

interface QueryAnnotation {
  id: string;
  set: 'dev' | 'test';
  category: 'factuelle_directe' | 'doctrinale_multiparagraphe' | 'paraphrase' | 'filtree' | 'piege_voisin' | 'hors_corpus';
  sourceType: 'sermon' | 'expose' | 'bible' | 'song' | 'none';
  query: string;
  scope?: any;
  expectedRefs: Array<{ docId: string; paragraphIndex: number }>;
  expectedAnswerable: boolean;
  notes?: string;
}

async function main() {
  console.log("=========================================================================================================");
  console.log("  KINGS' SWORD — ÉVALUATION METROLOGIQUE DU MOTEUR RAG (ÉTAPE 10)");
  console.log("=========================================================================================================\n");

  const queriesPath = path.join(process.cwd(), 'eval', 'queries.json');
  if (!fs.existsSync(queriesPath)) {
    console.error(`❌ ERREUR : Le fichier ${queriesPath} n'existe pas.`);
    process.exit(1);
  }

  const queriesData: QueryAnnotation[] = JSON.parse(fs.readFileSync(queriesPath, 'utf8'));

  // Vérification préalable de la présence des annotations manuelles
  const annotatedAnswerableCount = queriesData.filter(q => q.expectedAnswerable && q.expectedRefs.length > 0).length;
  if (annotatedAnswerableCount === 0) {
    console.warn("⚠️  ATTENTION : Le fichier eval/queries.json contient un gabarit de 50 requêtes avec des champs expectedRefs VIDES.");
    console.warn("   Conformément aux consignes de l'Étape 10, aucune évaluation ou métrique ne sera exécutée sur des données de simulation.");
    console.warn("\n📌 INSTRUCTIONS POUR L'UTILISATEUR :");
    console.warn("   1. Veuillez ouvrir le fichier eval/queries.json.");
    console.warn("   2. Consultez le guide d'annotation : eval/ANNOTATION_GUIDE.md.");
    console.raw ? console.raw("   3. Remplissez les paragraphes attendus pour chaque requête [ { \"docId\": \"...\", \"paragraphIndex\": N } ].");
    console.warn("   4. Relancez ensuite cette commande : npx tsx eval/run_eval.ts\n");
    process.exit(0);
  }

  console.log(`Chargement de ${queriesData.length} requêtes annotées depuis eval/queries.json...`);
  console.log(`- Requêtes Dev : ${queriesData.filter(q => q.set === 'dev').length}`);
  console.log(`- Requêtes Test (Blind) : ${queriesData.filter(q => q.set === 'test').length}\n`);

  // Initialisation des données locales SQLite / Sermons
  const exposeDocs = await loadExposeAsCanonicalDocuments();
  const sermonsMeta = await getSermonsMetadata();

  const evalResults: any[] = [];
  let answerableTotal = 0;
  let recall10Hits = 0;
  let mrrSum = 0;
  let ndcgSum = 0;

  let trueNegativesCount = 0;
  let totalNegativesExpected = 0;
  let falseRefusalCount = 0;

  for (let i = 0; i < queriesData.length; i++) {
    const q = queriesData[i];
    const t0 = performance.now();

    // Exécution du moteur de recherche hybride RAG
    const searchRes = await performHybridSearch(q.query, {
      topK: 10,
      scope: q.scope
    });

    const evidencePkg = await buildRetrievalEvidencePackage(q.query, searchRes, {
      topK: 10,
      confidenceThreshold: 0.18
    });

    const latMs = Math.round(performance.now() - t0);

    // Extraction du top 10 des résultats
    const top10Hits = (searchRes.hits || []).slice(0, 10).map((h, idx) => ({
      rank: idx + 1,
      docId: h.sermonId || (h as any).documentId,
      paragraphIndex: h.startParagraph || (h as any).paragraphIndex || 1,
      scoreBM25: h.lexicalScore || 0,
      scoreVector: h.vectorScore || 0,
      scoreRRF: h.rrfScore || 0
    }));

    // Évaluation des métriques si expectedAnswerable === true
    let hitFoundRank = -1;
    if (q.expectedAnswerable) {
      answerableTotal++;

      // Vérification du Recall@10
      for (const ref of q.expectedRefs) {
        const found = top10Hits.find(h => h.docId?.toLowerCase() === ref.docId.toLowerCase() && h.paragraphIndex === ref.paragraphIndex);
        if (found) {
          if (hitFoundRank === -1 || found.rank < hitFoundRank) {
            hitFoundRank = found.rank;
          }
        }
      }

      // Calcul exact du DCG@10, IDCG@10 et NDCG@10 (DCG / IDCG)
      let dcg10 = 0;
      top10Hits.forEach(h => {
        const isRel = q.expectedRefs.some(ref =>
          h.docId?.toLowerCase() === ref.docId.toLowerCase() && h.paragraphIndex === ref.paragraphIndex
        );
        if (isRel) {
          dcg10 += 1 / Math.log2(h.rank + 1);
        }
      });

      const maxRelCount = Math.min(q.expectedRefs.length, 10);
      let idcg10 = 0;
      for (let j = 1; j <= maxRelCount; j++) {
        idcg10 += 1 / Math.log2(j + 1);
      }

      const queryNdcg10 = idcg10 > 0 ? (dcg10 / idcg10) : 0;
      ndcgSum += queryNdcg10;

      // Vérification du taux de Faux Refus
      if (!evidencePkg.answerable) {
        falseRefusalCount++;
      }
    } else {
      // Pour les pièges et hors-corpus
      totalNegativesExpected++;
      if (!evidencePkg.answerable) {
        trueNegativesCount++;
      }
    }

    evalResults.push({
      id: q.id,
      set: q.set,
      category: q.category,
      sourceType: q.sourceType,
      query: q.query,
      expectedAnswerable: q.expectedAnswerable,
      expectedRefs: q.expectedRefs,
      actualAnswerable: evidencePkg.answerable,
      confidenceScore: evidencePkg.confidenceScore,
      latencyMs: latMs,
      hitFoundRank: hitFoundRank !== -1 ? hitFoundRank : "ABSENT",
      top10Hits
    });
  }

  // Calcul des métriques globales (Formules explicites)
  const recall10 = answerableTotal > 0 ? (recall10Hits / answerableTotal) : 0;
  const mrr5 = answerableTotal > 0 ? (mrrSum / answerableTotal) : 0;
  const ndcg10 = answerableTotal > 0 ? (ndcgSum / answerableTotal) : 0;
  const trueNegativeRate = totalNegativesExpected > 0 ? (trueNegativesCount / totalNegativesExpected) : 0;
  const falseRefusalRate = answerableTotal > 0 ? (falseRefusalCount / answerableTotal) : 0;

  console.log("---------------------------------------------------------------------------------------------------------");
  console.log("  RÉSULTATS DES MÉTRIQUES METROLOGIQUES (CURRENT BASELINE) :");
  console.log(`  - Recall@10 (A au moins 1 bonne réf dans top 10)  : ${(recall10 * 100).toFixed(1)}% (${recall10Hits}/${answerableTotal})`);
  console.log(`  - MRR@5 (Mean Reciprocal Rank sur top 5)           : ${mrr5.toFixed(3)}`);
  console.log(`  - NDCG@10 (Normalized Discounted Cumulative Gain)  : ${ndcg10.toFixed(3)}`);
  console.log(`  - Taux de Vrais Négatifs (Pièges/Hors-corpus refusés): ${(trueNegativeRate * 100).toFixed(1)}% (${trueNegativesCount}/${totalNegativesExpected})`);
  console.log(`  - Taux de Faux Refus (Answerable refusés à tort)   : ${(falseRefusalRate * 100).toFixed(1)}% (${falseRefusalCount}/${answerableTotal})`);
  console.log("---------------------------------------------------------------------------------------------------------\n");

  // Enregistrement des résultats JSON horodatés
  const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = path.join(process.cwd(), 'eval', `results_${dateStr}.json`);
  fs.writeFileSync(outputPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    metrics: {
      recall10,
      mrr5,
      ndcg10,
      trueNegativeRate,
      falseRefusalRate,
      answerableTotal,
      totalNegativesExpected
    },
    results: evalResults
  }, null, 2), 'utf8');

  console.log(`💾 Résultats détaillés enregistrés dans : ${outputPath}`);
}

main().catch(err => {
  console.error("Fatal eval error:", err);
  process.exit(1);
});
