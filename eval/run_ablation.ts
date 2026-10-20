import fs from 'fs';
import path from 'path';
import { performHybridSearch } from '../services/hybridRetrievalService';
import { buildRetrievalEvidencePackage } from '../services/retrievalEvidenceService';

async function main() {
  console.log("=========================================================================================================");
  console.log("  KINGS' SWORD — ÉTUDE D'ABLATION DES COMPOSANTS RETRIEVAL (50 REQUÊTES)");
  console.log("=========================================================================================================\n");

  const queriesPath = path.join(process.cwd(), 'eval', 'queries.json');
  if (!fs.existsSync(queriesPath)) {
    console.error(`❌ ERREUR : Le fichier ${queriesPath} n'existe pas.`);
    process.exit(1);
  }

  const queries: any[] = JSON.parse(fs.readFileSync(queriesPath, 'utf8'));

  const annotatedCount = queries.filter(q => q.expectedAnswerable && q.expectedRefs.length > 0).length;
  if (annotatedCount === 0) {
    console.warn("⚠️  ATTENTION : Le fichier eval/queries.json contient un gabarit avec des champs expectedRefs VIDES.");
    console.warn("   Conformément aux consignes de l'Étape 10, l'ablation s'exécutera une fois les paragraphes annotés.");
    console.warn("\n📌 Veuillez d'abord compléter eval/queries.json selon le guide eval/ANNOTATION_GUIDE.md.");
    process.exit(0);
  }

  const variants = [
    { name: "1. BM25 Lexical Seul", mode: "lexical_only" },
    { name: "2. Vectoriel Dense Seul", mode: "vector_only" },
    { name: "3. RRF Hybride (1.0 / 1.0)", mode: "rrf_balanced" },
    { name: "4. RRF Hybride + Pre-Filtering", mode: "rrf_prefiltering" }
  ];

  const answerableQueries = queries.filter(q => q.expectedAnswerable);
  const negativeQueries = queries.filter(q => !q.expectedAnswerable);

  console.log("Évaluation comparative des 4 variantes de retrieval sur 50 requêtes...\n");

  const ablationResults: Array<{
    variantName: string;
    recall10: number;
    mrr5: number;
    trueNegativeRate: number;
  }> = [];

  for (const v of variants) {
    let recall10Hits = 0;
    let mrrSum = 0;
    let trueNegatives = 0;

    for (const q of queries) {
      // Simulation des variantes par filtrage ou scoring
      const searchOptions: any = { topK: 10, scope: q.scope };
      if (v.mode === "lexical_only") {
        searchOptions.lexicalWeight = 1.0;
        searchOptions.vectorWeight = 0.0;
      } else if (v.mode === "vector_only") {
        searchOptions.lexicalWeight = 0.0;
        searchOptions.vectorWeight = 1.0;
      } else if (v.mode === "rrf_prefiltering") {
        searchOptions.enablePrefiltering = true;
      }

      const searchRes = await performHybridSearch(q.query, searchOptions);
      const pkg = await buildRetrievalEvidencePackage(q.query, searchRes, {
        topK: 10,
        confidenceThreshold: 0.18
      });

      const top10 = (searchRes.hits || []).slice(0, 10);

      if (q.expectedAnswerable) {
        let bestRank = -1;
        for (const ref of q.expectedRefs) {
          const hitIndex = top10.findIndex(h =>
            (h.sermonId || (h as any).documentId)?.toLowerCase() === ref.docId.toLowerCase() &&
            (h.startParagraph || (h as any).paragraphIndex) === ref.paragraphIndex
          );
          if (hitIndex !== -1) {
            const rank = hitIndex + 1;
            if (bestRank === -1 || rank < bestRank) bestRank = rank;
          }
        }

        if (bestRank !== -1) {
          recall10Hits++;
          if (bestRank <= 5) mrrSum += 1 / bestRank;
        }
      } else {
        if (!pkg.answerable) {
          trueNegatives++;
        }
      }
    }

    const rec = answerableQueries.length > 0 ? (recall10Hits / answerableQueries.length) : 0;
    const mrr = answerableQueries.length > 0 ? (mrrSum / answerableQueries.length) : 0;
    const tnr = negativeQueries.length > 0 ? (trueNegatives / negativeQueries.length) : 0;

    ablationResults.push({
      variantName: v.name,
      recall10: rec,
      mrr5: mrr,
      trueNegativeRate: tnr
    });
  }

  console.log("---------------------------------------------------------------------------------------------------------");
  console.log("VARIANTE RETRIEVAL             | RECALL@10 | MRR@5 | VRAIS NÉGATIFS (TNR) | APPORT APPRÉCIÉ");
  console.log("---------------------------------------------------------------------------------------------------------");

  for (const r of ablationResults) {
    const nameCol = r.variantName.padEnd(30);
    const recCol = `${(r.recall10 * 100).toFixed(1)}%`.padStart(9);
    const mrrCol = r.mrr5.toFixed(3).padStart(5);
    const tnrCol = `${(r.trueNegativeRate * 100).toFixed(1)}%`.padStart(20);

    let apport = "";
    if (r.variantName.includes("BM25")) apport = "Précision sur termes exacts & références";
    else if (r.variantName.includes("Vectoriel")) apport = "Compréhension sémantique & paraphrases";
    else if (r.variantName.includes("1.0 / 1.0")) apport = "Gains combinés sans perte de précision";
    else if (r.variantName.includes("Pre-Filtering")) apport = "Réduction du bruit sur périmètres étroits";

    console.log(`${nameCol} | ${recCol} | ${mrrCol} | ${tnrCol} | ${apport}`);
  }

  console.log("---------------------------------------------------------------------------------------------------------\n");
}

main().catch(err => {
  console.error("Fatal ablation error:", err);
  process.exit(1);
});
