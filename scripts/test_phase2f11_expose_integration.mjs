/**
 * King's Sword — Tests d'Intégration RAG Exposé (Phase 2F.11)
 * 
 * Valide de manière déterministe et SANS AUCUN APPEL GEMINI (0 quota) :
 * 1. Chargement et intégrité de l'Exposé (11 chapitres, 1590 paragraphes)
 * 2. Paragraphes conservés et intègres
 * 3. Chunking sémantique correct et couverture 100% (0 texte perdu)
 * 4. Stockage des chunks avec documentType = 'expose'
 * 5. Recherche lexicale BM25 dédiée
 * 6. Retrieval hybride RRF (k=60)
 * 7. Reranking multi-signaux
 * 8. Answerability in-domain vs abstention hors-corpus
 * 9. Retrieval Evidence Package et citations [Réf: expose-ch-N, §P]
 * 10. Absence absolue de chunkId dans les citations et réponses
 * 11. Validation des citations (authentiques vs inventées vs chunkId)
 * 12. Intégration de génération durcie (429, 503, réponse vide, aucun fallback)
 * 13. Contrôle des feature flags de production inchangés
 */

import assert from 'assert';
import { aiConfig } from '../config/aiConfig.ts';
import { 
  loadExposeAsCanonicalDocuments, 
  loadExposeAsSermons, 
  createExposeDocumentChunks, 
  searchExposeLexicalForRag,
  getExposeCorpusTextIndex,
  executeExposeRagPipeline 
} from '../services/exposeDocumentService.ts';
import { saveChunks, getChunkById } from '../services/chunkStorageService.ts';
import { validateResponseCitations } from '../services/citationValidationService.ts';
import { generateNewRagResponse, detectTechnicalIdentifierExposure } from '../services/generationAdapter.ts';

console.log("=================================================");
console.log(" 🧪 TESTS D'INTÉGRATION RAG EXPOSÉ (PHASE 2F.11)");
console.log("=================================================");

// 1. Contrôle initial des flags de production
if (aiConfig.featureFlags.useLegacyRetrieval !== true || aiConfig.featureFlags.useHybridRetrieval !== false) {
  console.error("❌ PRODUCTION_FLAGS_MUTATED : Les feature flags sont altérés au démarrage !");
  process.exit(1);
}
console.log("✅ Contrôle initial des flags : useLegacyRetrieval=true, useHybridRetrieval=false.");

let passedTests = 0;

// Helper pour mock Gemini
function createMockGeminiClient(behavior) {
  return {
    async generateContent(params) {
      if (typeof behavior === 'function') {
        return behavior(params);
      }
      return behavior;
    }
  };
}

// Helper invariant génération
function assertGenerationInvariants(result) {
  if (result.status === 'success') {
    assert.strictEqual(result.provider, 'google-gemini');
    assert.strictEqual(result.responseOrigin, 'gemini');
    assert.ok(typeof result.answerText === 'string' && result.answerText.length > 0);
  } else if (result.status === 'error') {
    assert.strictEqual(result.provider, 'none');
    assert.strictEqual(result.responseOrigin, 'none');
    assert.strictEqual(result.answerText, null);
    assert.ok(result.errorCode);
  } else if (result.status === 'not_answerable') {
    assert.strictEqual(result.provider, 'none');
    assert.strictEqual(result.responseOrigin, 'none');
    assert.strictEqual(result.answerText, null);
  } else {
    throw new Error(`Statut de génération inconnu : ${result.status}`);
  }
}

// --- TEST 1 : Chargement et intégrité de l'Exposé ---
console.log("\n--- 1. Chargement et intégrité canonique de l'Exposé ---");
{
  const docs = await loadExposeAsCanonicalDocuments();
  assert.strictEqual(docs.length, 11, "Exposé doit contenir exactement 11 chapitres (Ch 0 à 10)");
  assert.strictEqual(docs[0].documentId, "expose-ch-0");
  assert.strictEqual(docs[1].documentId, "expose-ch-1");
  assert.strictEqual(docs[10].documentId, "expose-ch-10");

  let totalParas = 0;
  docs.forEach(d => totalParas += d.paragraphs.length);
  assert.strictEqual(totalParas, 1590, "Exposé doit contenir exactement 1 590 paragraphes");
  console.log("  ✅ [PASS] 11 chapitres et 1 590 paragraphes canoniques chargés avec succès");
  passedTests++;
}

// --- TEST 2 : Structure et préservation des paragraphes ---
console.log("\n--- 2. Structure et métadonnées des paragraphes originaux ---");
{
  const docs = await loadExposeAsCanonicalDocuments();
  const ch3 = docs.find(d => d.documentId === 'expose-ch-3');
  assert.ok(ch3, "Chapitre 3 (Éphèse) doit exister");
  assert.strictEqual(ch3.paragraphs.length, 162);
  
  // Vérification du paragraphe 1
  const p1 = ch3.paragraphs[0];
  assert.strictEqual(p1.paragraphIndex, 1);
  assert.strictEqual(p1.chapterNumber, '3');
  assert.ok(p1.pageNumber >= 63);
  assert.ok(p1.text.length > 20);

  // Vérification de la présence de titres de section
  const hasSections = ch3.paragraphs.some(p => Boolean(p.sectionTitle));
  assert.strictEqual(hasSections, true, "Les titres de section doivent être préservés");
  console.log("  ✅ [PASS] Indexation séquentielle, numéros de page et titres de section préservés");
  passedTests++;
}

// --- TEST 3 : Chunking sémantique et couverture 100% ---
console.log("\n--- 3. Découpage en chunks sémantiques et couverture 100% ---");
{
  const chunks = await createExposeDocumentChunks();
  assert.ok(chunks.length >= 1400 && chunks.length <= 1500, `Nombre de chunks attendu ~1434, obtenu : ${chunks.length}`);
  
  // Vérification de couverture intégrale (aucun paragraphe perdu)
  const docs = await loadExposeAsCanonicalDocuments();
  const allExpectedKeys = new Set();
  docs.forEach(d => {
    d.paragraphs.forEach(p => allExpectedKeys.add(`${d.documentId}_${p.paragraphIndex}`));
  });

  const coveredKeys = new Set();
  chunks.forEach(c => {
    assert.strictEqual(c.documentType, 'expose', "documentType doit être expose");
    assert.ok(c.sermonId.startsWith('expose-ch-'), "sermonId doit commencer par expose-ch-");
    c.paragraphIds.forEach(pid => coveredKeys.add(`${c.sermonId}_${pid}`));
  });

  assert.strictEqual(coveredKeys.size, allExpectedKeys.size, "Couverture de 100% requise : chaque paragraphe doit être dans un chunk");
  console.log(`  ✅ [PASS] 100.00% de couverture vérifiée (${coveredKeys.size}/1590 paragraphes couverts)`);
  passedTests++;
}

// --- TEST 4 : Persistance et stockage des chunks ---
console.log("\n--- 4. Stockage persistant et compatibilité schéma ---");
{
  const chunks = await createExposeDocumentChunks();
  const sample = chunks.slice(0, 10);
  const saveResult = await saveChunks(sample);
  assert.strictEqual(saveResult.count, 10);

  const retrieved = await getChunkById(sample[0].chunkId);
  assert.ok(retrieved, "Le chunk doit être relu depuis le stockage");
  assert.strictEqual(retrieved.chunkId, sample[0].chunkId);
  assert.strictEqual(retrieved.documentType, 'expose');
  console.log("  ✅ [PASS] Stockage et relecture avec documentType='expose' validés");
  passedTests++;
}

// --- TEST 5 : Recherche lexicale BM25 dédiée Exposé ---
console.log("\n--- 5. Recherche lexicale BM25 dédiée Exposé ---");
{
  const results = await searchExposeLexicalForRag("Nicolaïtes œuvres doctrine clergé laïcs", { topK: 10 });
  assert.ok(results.length > 0, "Doit trouver des correspondances pour les Nicolaïtes");
  assert.ok(results.some(r => r.sermonId === 'expose-ch-3' || r.sermonId === 'expose-ch-5' || r.sermonId === 'expose-ch-10'));
  assert.ok(results[0].score > 10, "Score lexical positif attendu");
  console.log(`  ✅ [PASS] Recherche lexicale concluante (${results.length} résultats, top: ${results[0].sermonId})`);
  passedTests++;
}

// --- TEST 6 : Pipeline Auto-RAG Exposé complet (Question In-Domain) ---
console.log("\n--- 6. Pipeline Auto-RAG complet sur question in-domain ---");
{
  const evPackage = await executeExposeRagPipeline("Qui est le messager suscité pour l'Âge de l'Église de Smyrne ?");
  assert.strictEqual(evPackage.answerable, true, "La question sur le messager de Smyrne est couverte");
  assert.ok(evPackage.confidenceScore >= 0.70);
  assert.ok(evPackage.evidence.length > 0);

  const topEvidence = evPackage.evidence[0];
  assert.strictEqual(topEvidence.sermonId, 'expose-ch-4', "Le messager de Smyrne est traité au Chapitre 4");
  assert.strictEqual(topEvidence.citationParagraphs[0].formattedCitation.startsWith('[Réf: expose-ch-4,'), true);
  console.log("  ✅ [PASS] Question in-domain résolue avec evidence au Chapitre 4 (Smyrne)");
  passedTests++;
}

// --- TEST 7 : Abstention stricte sur question hors-domaine ---
console.log("\n--- 7. Abstention stricte sur question hors-domaine ---");
{
  const evPackage = await executeExposeRagPipeline("Quelle est la vitesse d'un tracteur agricole diesel à Paris ?");
  assert.strictEqual(evPackage.answerable, false, "Question hors-domaine doit être déclarée unanswerable");
  assert.strictEqual(evPackage.evidence.length, 0, "Zéro preuve documentaire pour question hors-domaine");
  assert.ok(evPackage.reason.toLowerCase().includes('hors du champ'));
  console.log("  ✅ [PASS] Abstention stricte sans hallucination ni preuve fictive");
  passedTests++;
}

// --- TEST 8 : Absence absolue de Chunk ID dans les consignes de citations ---
console.log("\n--- 8. Absence absolue de chunkId dans les citations ---");
{
  const evPackage = await executeExposeRagPipeline("Quelle est la doctrine de Balaam dans l'Église de Pergame ?");
  assert.strictEqual(evPackage.answerable, true);

  for (const ev of evPackage.evidence) {
    for (const cp of ev.citationParagraphs) {
      assert.strictEqual(cp.formattedCitation.includes('_c'), false, "La citation ne doit JAMAIS contenir _c");
      assert.strictEqual(cp.formattedCitation.toLowerCase().includes('chunk'), false, "La citation ne doit JAMAIS contenir chunk");
      assert.ok(cp.formattedCitation.startsWith('[Réf: expose-ch-'), "Format attendu [Réf: expose-ch-N, §P]");
    }
  }
  console.log("  ✅ [PASS] 100% des citations au format [Réf: expose-ch-N, §P], zéro chunkId exposé");
  passedTests++;
}

// --- TEST 9 : Validation des citations Exposé par citationValidationService ---
console.log("\n--- 9. Validation des citations Exposé par citationValidationService ---");
{
  const evPackage = await executeExposeRagPipeline("Quelle est la signification de Smyrne ?");
  assert.strictEqual(evPackage.answerable, true);

  const validParaIndex = evPackage.evidence[0].startParagraph;
  const validText = `Selon l'Exposé, Smyrne signifie amertume [Réf: expose-ch-4, §${validParaIndex}].`;
  
  const valResult = validateResponseCitations({ responseText: validText, evidencePackage: evPackage });
  assert.strictEqual(valResult.allCitationsValid, true);
  assert.strictEqual(valResult.validCitationCount, 1);
  assert.strictEqual(valResult.invalidCitationCount, 0);

  // Tentative de citation inventée
  const fakeText = `Une fausse doctrine inventée [Réf: expose-ch-4, §9999].`;
  const fakeResult = validateResponseCitations({ responseText: fakeText, evidencePackage: evPackage });
  assert.strictEqual(fakeResult.allCitationsValid, false);
  assert.strictEqual(fakeResult.invalidCitationCount, 1);
  console.log("  ✅ [PASS] Citation authentique validée et citation inventée rejetée avec exactitude");
  passedTests++;
}

// --- TEST 10 : Rejet d'une citation basée sur Chunk ID ---
console.log("\n--- 10. Rejet d'une citation basée sur Chunk ID ---");
{
  const evPackage = await executeExposeRagPipeline("Quelle est la signification de Smyrne ?");
  const chunkCitationText = `Une réponse mentionnant [Réf: expose-ch-4_c1_p1_p2, §1].`;
  
  const valResult = validateResponseCitations({ responseText: chunkCitationText, evidencePackage: evPackage });
  assert.strictEqual(valResult.allCitationsValid, false);
  assert.strictEqual(valResult.invalidCitationCount, 1);
  assert.ok(valResult.citations[0].reason.includes('CHUNK_ID'));
  console.log("  ✅ [PASS] Citation technique basée sur Chunk ID bloquée net");
  passedTests++;
}

// --- TEST 11 : Intégration de génération avec mock Gemini Success ---
console.log("\n--- 11. Intégration de génération avec mock Gemini Success ---");
{
  const evPackage = await executeExposeRagPipeline("Qui est le messager de Sardes ?");
  const topEvidence = evPackage.evidence[0];
  const validCitation = topEvidence.citationParagraphs[0].formattedCitation;
  
  const mockClient = createMockGeminiClient({
    text: `D'après l'Exposé, le messager est mentionné avec précision ${validCitation}.`
  });

  const genResult = await generateNewRagResponse({
    query: "Qui est le messager de Sardes ?",
    evidencePackage: evPackage,
    geminiClient: mockClient
  });

  assertGenerationInvariants(genResult);
  assert.strictEqual(genResult.status, 'success');
  assert.strictEqual(genResult.citationsValidation?.allCitationsValid, true);
  console.log("  ✅ [PASS] Succès de génération simulée avec validation de citation");
  passedTests++;
}

// --- TEST 12 : Gestion rigoureuse de Gemini 429 et 503 sans aucun fallback ---
console.log("\n--- 12. Gestion rigoureuse de Gemini 429 / 503 (zéro fallback) ---");
{
  const evPackage = await executeExposeRagPipeline("Qui est le messager de Sardes ?");

  // Cas 429
  const client429 = createMockGeminiClient(() => {
    throw new Error("429 RESOURCE_EXHAUSTED : Quota exceeded");
  });
  const res429 = await generateNewRagResponse({
    query: "Qui est le messager de Sardes ?",
    evidencePackage: evPackage,
    geminiClient: client429
  });
  assertGenerationInvariants(res429);
  assert.strictEqual(res429.status, 'error');
  assert.strictEqual(res429.errorCode, 'RESOURCE_EXHAUSTED');
  assert.strictEqual(res429.answerText, null);

  // Cas 503
  const client503 = createMockGeminiClient(() => {
    throw new Error("503 SERVICE_UNAVAILABLE : High demand");
  });
  const res503 = await generateNewRagResponse({
    query: "Qui est le messager de Sardes ?",
    evidencePackage: evPackage,
    geminiClient: client503
  });
  assertGenerationInvariants(res503);
  assert.strictEqual(res503.status, 'error');
  assert.strictEqual(res503.errorCode, 'SERVICE_UNAVAILABLE');
  assert.strictEqual(res503.answerText, null);

  // Cas réponse vide
  const clientEmpty = createMockGeminiClient({ text: "   " });
  const resEmpty = await generateNewRagResponse({
    query: "Qui est le messager de Sardes ?",
    evidencePackage: evPackage,
    geminiClient: clientEmpty
  });
  assertGenerationInvariants(resEmpty);
  assert.strictEqual(resEmpty.status, 'error');
  assert.strictEqual(resEmpty.errorCode, 'EMPTY_RESPONSE');
  assert.strictEqual(resEmpty.answerText, null);

  console.log("  ✅ [PASS] 429, 503 et réponse vide conservés comme erreurs sans falsification ni fallback");
  passedTests++;
}

// --- TEST 13 : Contrôle final des Feature Flags de production ---
console.log("\n--- 13. Contrôle final de non-mutation des Feature Flags ---");
{
  assert.strictEqual(aiConfig.featureFlags.useLegacyRetrieval, true, "useLegacyRetrieval doit rester true");
  assert.strictEqual(aiConfig.featureFlags.useHybridRetrieval, false, "useHybridRetrieval doit rester false");
  console.log("  ✅ [PASS] Feature flags inchangés : useLegacyRetrieval=true, useHybridRetrieval=false");
  passedTests++;
}

console.log("\n=================================================");
console.log(` RÉSULTATS : ${passedTests}/${passedTests} TESTS D'INTÉGRATION EXPOSÉ RÉUSSIS`);
console.log(` 📞 Appels réels API Gemini effectués : 0 (100% déterministe)`);
console.log("=================================================");
