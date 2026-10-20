import fs from 'fs';
import path from 'path';
import { executeExposeRagPipeline } from '../services/exposeDocumentService';

async function runNonRegressionTest() {
  console.log("================================================================================");
  console.log("   TEST DE NON-RÉGRESSION : 10 REQUÊTES FIXES (MÊMES TOP-10 QU'AVANT)");
  console.log("================================================================================\n");

  const baselinePath = path.resolve('.baseline_10_queries.json');
  if (!fs.existsSync(baselinePath)) {
    console.error("❌ Fichier de baseline .baseline_10_queries.json introuvable !");
    process.exit(1);
  }

  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const queries = Object.keys(baseline);

  console.log(`Nombre de requêtes de test à évaluer : ${queries.length}\n`);

  let totalQueries = queries.length;
  let passedQueries = 0;
  let totalComparisons = 0;
  let matchingComparisons = 0;

  for (let qIdx = 0; qIdx < queries.length; qIdx++) {
    const q = queries[qIdx];
    const expectedHits = baseline[q] || [];
    
    console.log(`[${qIdx + 1}/${totalQueries}] Test requête : "${q}"`);
    const currentRes = await executeExposeRagPipeline(q, { topK: 10, maxEvidenceCount: 10 });
    const currentHits = (currentRes.evidence || []).map((e, idx) => ({
      rank: idx + 1,
      chunkId: e.chunkId,
      citation: e.citationParagraphs?.[0]?.formattedCitation || e.chunkId
    }));

    let queryMatch = true;
    const maxK = Math.max(expectedHits.length, currentHits.length);

    console.log(`   • Attendu : ${expectedHits.length} résultats | Obtenu : ${currentHits.length} résultats`);

    for (let i = 0; i < maxK; i++) {
      totalComparisons++;
      const exp = expectedHits[i];
      const cur = currentHits[i];

      const expCit = exp ? exp.citation : 'VIDE';
      const curCit = cur ? cur.citation : 'VIDE';

      if (expCit === curCit) {
        matchingComparisons++;
      } else {
        queryMatch = false;
        console.log(`     ⚠️ Rang #${i + 1} différent : Attendu "${expCit}" vs Obtenu "${curCit}"`);
      }
    }

    if (queryMatch) {
      passedQueries++;
      console.log(`   ✅ CONCORDANCE 100% (Top ${currentHits.length} strictement identique)\n`);
    } else {
      console.log(`   ❌ Divergence constatée sur cette requête.\n`);
    }
  }

  const concordanceRate = Math.round((matchingComparisons / Math.max(1, totalComparisons)) * 100);

  console.log("================================================================================");
  console.log("   RÉSULTAT GLOBAL DU TEST DE NON-RÉGRESSION");
  console.log("================================================================================");
  console.log(`• Requêtes 100% identiques : ${passedQueries} / ${totalQueries} (${Math.round((passedQueries / totalQueries) * 100)}%)`);
  console.log(`• Taux de concordance rang par rang : ${matchingComparisons} / ${totalComparisons} (${concordanceRate}%)`);
  console.log("================================================================================\n");

  if (passedQueries === totalQueries) {
    console.log("🎉 SUCCÈS TOTAL : Aucune régression. La recherche renvoie rigoureusement les mêmes résultats !");
    process.exit(0);
  } else {
    console.error("❌ Échec : des divergences ont été constatées.");
    process.exit(1);
  }
}

runNonRegressionTest().catch(err => {
  console.error("Erreur test non-régression:", err);
  process.exit(1);
});
