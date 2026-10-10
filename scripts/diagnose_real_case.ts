import { executeUnifiedRagAssistantFlow } from '../services/unifiedRagIntegrationService';
import { executeUnifiedRagPipeline, resolveAIContextChunks, normalizeAIContext } from '../services/unifiedRagService';
import { isDeepDiveStudyRequest, detectExhaustiveStudyIntent } from '../services/theologicalExegesisService';
import { expandTheologicalQuery } from '../services/theologicalQueryService';
import { getCorpusTermIdf } from '../services/corpusVocabularyService';

async function runDiagnostic() {
  const query = "monte une etude détaillée et approfondie sur les finances dans un couple de chrétiens";
  console.log("==================================================================");
  console.log("🔍 DIAGNOSTIC REQUÊTE :", query);
  console.log("==================================================================\n");

  // 1. Détection d'intention
  const isDeepDive = isDeepDiveStudyRequest(query);
  const isExhaustive = await detectExhaustiveStudyIntent(query);
  console.log("--- 1. INTENTION DÉTECTÉE ---");
  console.log(`isDeepDiveStudyRequest: ${isDeepDive}`);
  console.log(`detectExhaustiveStudyIntent: ${isExhaustive}`);

  // 2. Expansion de la requête
  const expansion = await expandTheologicalQuery(query);
  console.log("\n--- 2. EXPANSION DOCTRINALE ---");
  console.log("Requête originale :", expansion.originalQuery);
  console.log("Requête enrichie  :", expansion.expandedQuery);
  console.log("Mots-clés doctrinaux :", expansion.doctrinalKeywords);
  console.log("Sous-requêtes multi-hop :", expansion.subQueries);

  // 3. Test CAS A : Scope Exposé uniquement (Installation neuve ou sermons non indexés)
  console.log("\n--- 3. CAS A : SCOPE EXPOSÉ UNIQUEMENT (11 Chapitres) ---");
  const exposeContext = Array.from({ length: 11 }, (_, i) => `expose-ch-${i}`);
  const normalizedExposeCtx = normalizeAIContext(exposeContext);
  const exposeChunks = await resolveAIContextChunks(normalizedExposeCtx);
  console.log(`Documents dans le scope : Exposé (11 chapitres)`);
  console.log(`Nombre de chunks résolus : ${exposeChunks.length}`);

  const exposeRagRes = await executeUnifiedRagPipeline(query, exposeContext, {
    topK: 20,
    maxEvidenceCount: 15
  });

  console.log(`Answerable : ${exposeRagRes.answerable}`);
  console.log(`Confidence Score : ${exposeRagRes.confidenceScore}`);
  console.log(`Raison du portier : ${exposeRagRes.reason}`);
  console.log(`Zone de décision : ${exposeRagRes.decisionJournal?.zone}`);
  console.log(`Top Vector Cosine : ${exposeRagRes.decisionJournal?.topVectorScore}`);
  console.log(`Top BM25/Lexical : ${exposeRagRes.decisionJournal?.topLexScore}`);

  console.log("\nTOP-20 CANDIDATS (EXPOSÉ) :");
  const topExpose = ((exposeRagRes.decisionJournal as any)?.rankedCandidates || []).slice(0, 20);
  topExpose.forEach((c: any, i: number) => {
    console.log(`  ${(i + 1).toString().padStart(2, ' ')}. [${c.sourceId}] BM25 Rank: ${c.bm25Rank} (score: ${c.bm25Score.toFixed(2)}) | E5 Rank: ${c.vectorRank} (score: ${c.vectorScore.toFixed(4)}) | RRF: ${c.rrfScore.toFixed(5)}`);
  });

  // 4. Test CAS B : Scope avec Sermons (Corpus complet avec sermons dev/test)
  console.log("\n--- 4. CAS B : TEST AVEC SERMONS DANS LE SCOPE ---");
  // Charger les sermons du dataset dev/test s'ils existent
  let sampleSermonsContext: string[] = [];
  try {
    const fs = await import('fs');
    if (fs.existsSync('eval/sermons_sampled_dev_24.json')) {
      const devSermons = JSON.parse(fs.readFileSync('eval/sermons_sampled_dev_24.json', 'utf8'));
      sampleSermonsContext = devSermons.map((s: any) => s.id);
      console.log(`Chargé ${sampleSermonsContext.length} sermons d'évaluation`);
    }
  } catch (e) {}

  const fullContext = [...exposeContext, ...sampleSermonsContext];
  const normalizedFullCtx = normalizeAIContext(fullContext);
  const fullChunks = await resolveAIContextChunks(normalizedFullCtx);
  console.log(`Nombre total de chunks résolus (Exposé + Sermons) : ${fullChunks.length}`);

  const fullRagRes = await executeUnifiedRagPipeline(query, fullContext, {
    topK: 20,
    maxEvidenceCount: 15
  });

  console.log(`Answerable avec sermons : ${fullRagRes.answerable}`);
  console.log(`Confidence Score : ${fullRagRes.confidenceScore}`);
  console.log(`Raison : ${fullRagRes.reason}`);
  console.log(`Zone de décision : ${fullRagRes.decisionJournal?.zone}`);
  console.log(`Nombre de preuves retenues : ${fullRagRes.evidence.length}`);

  console.log("\nTOP-20 CANDIDATS (GLOBAL) :");
  const topGlobal = ((fullRagRes.decisionJournal as any)?.rankedCandidates || []).slice(0, 20);
  topGlobal.forEach((c: any, i: number) => {
    console.log(`  ${(i + 1).toString().padStart(2, ' ')}. [${c.sourceId}] BM25 Rank: ${c.bm25Rank} (score: ${c.bm25Score.toFixed(2)}) | E5 Rank: ${c.vectorRank} (score: ${c.vectorScore.toFixed(4)}) | RRF: ${c.rrfScore.toFixed(5)}`);
  });

  console.log("\n==================================================================");
  console.log("🏁 FIN DU DIAGNOSTIC");
  console.log("==================================================================");
}

runDiagnostic().catch(console.error);
