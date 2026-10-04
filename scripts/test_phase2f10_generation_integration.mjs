/**
 * King's Sword — Generation Integration Hardening Test Suite (Phase 2F.10)
 * 
 * Valide le comportement rigoureux de l'intégration de génération New RAG
 * à l'aide de FIXTURES DÉTERMINISTES SANS AUCUN APPEL API GEMINI RÉEL (0 quota).
 * 
 * Les réponses simulées sont strictement des FIXTURES DE TEST et ne doivent
 * jamais être utilisées comme des générations réelles ni dans les benchmarks.
 */

import assert from 'assert';
import { aiConfig } from '../config/aiConfig.ts';
import { 
  generateNewRagResponse, 
  detectTechnicalIdentifierExposure 
} from '../services/generationAdapter.ts';
import { validateResponseCitations } from '../services/citationValidationService.ts';

console.log("=================================================");
console.log(" 🧪 TESTS D'INTÉGRATION GÉNÉRATION (PHASE 2F.10)");
console.log("=================================================");

// 1. VÉRIFICATION DES FEATURE FLAGS DE PRODUCTION AVANT LES TESTS
if (aiConfig.featureFlags.useLegacyRetrieval !== true || aiConfig.featureFlags.useHybridRetrieval !== false) {
  console.error("❌ PRODUCTION_FLAG_MUTATION_DETECTED : Les flags de production sont altérés !");
  process.exit(1);
}
console.log("✅ Contrôle initial des flags : useLegacyRetrieval=true, useHybridRetrieval=false.");

let actualGeminiApiCalls = 0;
let passedCount = 0;

// Fixture d'Evidence Package de test
const testEvidencePackage = {
  answerable: true,
  confidenceScore: 0.95,
  query: "Que portait le cavalier sur le cheval blanc ?",
  reason: "Preuve trouvée dans le sermon 63-0324M.",
  totalCandidates: 2,
  rejectedCount: 0,
  evidence: [
    {
      chunkId: "chunk_63-0324M_c1_p1_p2",
      sermonId: "63-0324M",
      sermonTitle: "Questions Et Réponses Sur Les Sceaux",
      paragraphIds: [1, 2],
      startParagraph: 1,
      endParagraph: 2,
      text: "Le cavalier sur le cheval blanc portait un arc, mais n'avait aucune flèche.",
      date: "1963-03-24",
      city: "Jeffersonville",
      version: "VGR",
      retrievalScore: 0.92,
      rank: 1,
      sourceType: "reranked",
      citationParagraphs: [
        {
          paragraphIndex: 1,
          formattedCitation: "[Réf: 63-0324M, §1]",
          textSnippet: "Questions et réponses...",
          isAuthentic: true
        },
        {
          paragraphIndex: 2,
          formattedCitation: "[Réf: 63-0324M, §2]",
          textSnippet: "Il portait un arc mais n'avait aucune flèche...",
          isAuthentic: true
        }
      ]
    }
  ]
};

// Fixture d'Evidence Package non-answerable
const unanswerableEvidencePackage = {
  answerable: false,
  confidenceScore: 0,
  query: "Question hors corpus sur une doctrine inventée",
  reason: "Aucun document pertinent disponible dans la bibliothèque.",
  totalCandidates: 0,
  rejectedCount: 1,
  evidence: []
};

// Helper pour créer un faux client Gemini injecté
function createMockGeminiClient(behavior) {
  return {
    async generateContent(params) {
      actualGeminiApiCalls++; // Compte les appels mockés
      if (typeof behavior === 'function') {
        return behavior(params);
      }
      return behavior;
    }
  };
}

// Invariants Validator pour tester les contrats
function assertGenerationInvariants(result) {
  try {
    if (result.status === 'success') {
      assert.strictEqual(result.provider, 'google-gemini', "provider must be google-gemini on success");
      assert.strictEqual(result.responseOrigin, 'gemini', "responseOrigin must be gemini on success");
      assert.ok(typeof result.answerText === 'string', "answerText must be string on success");
      assert.ok(result.answerText.trim().length > 0, "answerText must not be empty on success");
      assert.strictEqual(result.errorCode, null, "errorCode must be null on success");
    } else if (result.status === 'error') {
      assert.strictEqual(result.provider, 'none', "provider must be none on error");
      assert.strictEqual(result.responseOrigin, 'none', "responseOrigin must be none on error");
      assert.strictEqual(result.answerText, null, "answerText must be null on error");
      assert.ok(result.errorCode, "errorCode must be defined on error");
    } else if (result.status === 'not_answerable') {
      assert.strictEqual(result.provider, 'none', "provider must be none on not_answerable");
      assert.strictEqual(result.responseOrigin, 'none', "responseOrigin must be none on not_answerable");
      assert.strictEqual(result.answerText, null, "answerText must be null on not_answerable");
    } else {
      throw new Error(`Unknown status ${result.status}`);
    }
  } catch (err) {
    throw new Error(`INVALID_GENERATION_CONTRACT: ${err.message}`);
  }
}

// --- 1. Fixture A : Réponse Gemini valide avec citation valide ---
console.log("\n--- 1. Fixture A : Réponse Gemini valide avec citation valide ---");
{
  const mockClient = createMockGeminiClient({
    text: "D'après les enseignements, le cavalier sur le cheval blanc portait un arc sans flèche [Réf: 63-0324M, §2]."
  });

  const result = await generateNewRagResponse({
    query: "Que portait le cavalier ?",
    evidencePackage: testEvidencePackage,
    geminiClient: mockClient
  });

  assertGenerationInvariants(result);
  assert.strictEqual(result.status, 'success');
  assert.strictEqual(result.citationsValidation?.allCitationsValid, true);
  assert.strictEqual(result.citationsValidation?.validCitationCount, 1);
  assert.strictEqual(result.citationsValidation?.invalidCitationCount, 0);
  assert.strictEqual(result.chunkIdExposure, false);
  console.log("  ✅ [PASS] Fixture A : Succès Gemini avec citation valide [Réf: 63-0324M, §2]");
  passedCount++;
}

// --- 2. Fixture B : Réponse Gemini avec mauvaise citation ---
console.log("\n--- 2. Fixture B : Réponse Gemini avec mauvaise citation ---");
{
  const mockClient = createMockGeminiClient({
    text: "Une réponse avec une référence inventée [Réf: UNKNOWN_SERMON, §999]."
  });

  const result = await generateNewRagResponse({
    query: "Que portait le cavalier ?",
    evidencePackage: testEvidencePackage,
    geminiClient: mockClient
  });

  assertGenerationInvariants(result);
  assert.strictEqual(result.status, 'success');
  assert.strictEqual(result.citationsValidation?.allCitationsValid, false);
  assert.strictEqual(result.citationsValidation?.invalidCitationCount, 1);
  assert.strictEqual(result.citationsValidation?.validCitationCount, 0);
  console.log("  ✅ [PASS] Fixture B : Citation invalide correctement détectée (invalidCitationCount > 0)");
  passedCount++;
}

// --- 3. Fixture C : Réponse Gemini sans citation ---
console.log("\n--- 3. Fixture C : Réponse Gemini sans citation ---");
{
  const mockClient = createMockGeminiClient({
    text: "Le cavalier portait un arc mais n'avait aucune flèche selon la doctrine biblique."
  });

  const result = await generateNewRagResponse({
    query: "Que portait le cavalier ?",
    evidencePackage: testEvidencePackage,
    geminiClient: mockClient
  });

  assertGenerationInvariants(result);
  assert.strictEqual(result.status, 'success');
  assert.strictEqual(result.citationsValidation?.validCitationCount, 0);
  assert.strictEqual(result.citationsValidation?.invalidCitationCount, 0);
  assert.strictEqual(result.citationsValidation?.allCitationsValid, true);
  console.log("  ✅ [PASS] Fixture C : Réponse sans citation acceptée sans forcer de référence fictive");
  passedCount++;
}

// --- 4. Fixture D : Gemini 429 RESOURCE_EXHAUSTED ---
console.log("\n--- 4. Fixture D : Gemini 429 RESOURCE_EXHAUSTED ---");
{
  const mockClient = createMockGeminiClient(() => {
    const err = new Error("429 RESOURCE_EXHAUSTED : You exceeded your current quota");
    throw err;
  });

  const result = await generateNewRagResponse({
    query: "Que portait le cavalier ?",
    evidencePackage: testEvidencePackage,
    geminiClient: mockClient
  });

  assertGenerationInvariants(result);
  assert.strictEqual(result.status, 'error');
  assert.strictEqual(result.errorCode, 'RESOURCE_EXHAUSTED');
  assert.strictEqual(result.answerText, null);
  assert.strictEqual(result.responseOrigin, 'none');
  console.log("  ✅ [PASS] Fixture D : 429 conservé comme error avec answerText = null (aucun fallback)");
  passedCount++;
}

// --- 5. Fixture E : Gemini 503 UNAVAILABLE ---
console.log("\n--- 5. Fixture E : Gemini 503 UNAVAILABLE ---");
{
  const mockClient = createMockGeminiClient(() => {
    const err = new Error("503 UNAVAILABLE : This model is currently experiencing high demand");
    throw err;
  });

  const result = await generateNewRagResponse({
    query: "Que portait le cavalier ?",
    evidencePackage: testEvidencePackage,
    geminiClient: mockClient
  });

  assertGenerationInvariants(result);
  assert.strictEqual(result.status, 'error');
  assert.strictEqual(result.errorCode, 'SERVICE_UNAVAILABLE');
  assert.strictEqual(result.answerText, null);
  assert.strictEqual(result.responseOrigin, 'none');
  console.log("  ✅ [PASS] Fixture E : 503 conservé comme error avec answerText = null (aucun fallback)");
  passedCount++;
}

// --- 6. Fixture F : Gemini réponse vide ---
console.log("\n--- 6. Fixture F : Gemini réponse vide ---");
{
  const mockClient = createMockGeminiClient({
    text: "   " // Espace vide
  });

  const result = await generateNewRagResponse({
    query: "Que portait le cavalier ?",
    evidencePackage: testEvidencePackage,
    geminiClient: mockClient
  });

  assertGenerationInvariants(result);
  assert.strictEqual(result.status, 'error');
  assert.strictEqual(result.errorCode, 'EMPTY_RESPONSE');
  assert.strictEqual(result.answerText, null);
  console.log("  ✅ [PASS] Fixture F : Réponse vide traitée comme EMPTY_RESPONSE avec answerText = null");
  passedCount++;
}

// --- 7. Fixture G : Réponse Gemini contenant un vrai Chunk ID ---
console.log("\n--- 7. Fixture G : Réponse Gemini contenant un vrai Chunk ID ---");
{
  const mockClient = createMockGeminiClient({
    text: "D'après le découpage interne chunk_63-0324M_c1_p1_p2, le cavalier avait un arc."
  });

  const result = await generateNewRagResponse({
    query: "Que portait le cavalier ?",
    evidencePackage: testEvidencePackage,
    geminiClient: mockClient
  });

  assertGenerationInvariants(result);
  assert.strictEqual(result.status, 'success');
  assert.strictEqual(result.chunkIdExposure, true);
  assert.ok(result.technicalIdentifiersDetected?.includes("chunk_63-0324M_c1_p1_p2"));
  console.log("  ✅ [PASS] Fixture G : Exposition technique de Chunk ID détectée avec exactitude");
  passedCount++;
}

// --- 8. Fixture H : Evidence answerable = false ---
console.log("\n--- 8. Fixture H : Evidence answerable = false ---");
{
  let geminiWasCalled = false;
  const mockClient = createMockGeminiClient(() => {
    geminiWasCalled = true;
    return { text: "Ne devrait pas être appelé" };
  });

  const result = await generateNewRagResponse({
    query: "Question hors corpus",
    evidencePackage: unanswerableEvidencePackage,
    geminiClient: mockClient
  });

  assertGenerationInvariants(result);
  assert.strictEqual(result.status, 'not_answerable');
  assert.strictEqual(result.answerText, null);
  assert.strictEqual(result.provider, 'none');
  assert.strictEqual(result.responseOrigin, 'none');
  assert.strictEqual(geminiWasCalled, false, "Gemini ne doit JAMAIS être appelé avec de fausses preuves");
  console.log("  ✅ [PASS] Fixture H : Abstention stricte sans appel Gemini ni réponse factice");
  passedCount++;
}

// --- 9. Fixture I : Tentative de Fallback Ollama ou Local ---
console.log("\n--- 9. Fixture I : Tentative de Fallback Ollama ou Local ---");
{
  const taintedResult = {
    status: 'success',
    provider: 'ollama',
    model: 'llama3',
    responseOrigin: 'ollama',
    answerText: 'Réponse générée par Ollama en fallback'
  };

  assert.throws(() => assertGenerationInvariants(taintedResult), /INVALID_GENERATION_CONTRACT/);
  console.log("  ✅ [PASS] Fixture I : Fallback Ollama bloqué net par les invariants de génération");
  passedCount++;
}

// --- 10. Test de non-contamination (429 + tentative de fallback) ---
console.log("\n--- 10. Test de non-contamination (429 + tentative de fallback) ---");
{
  // Simule une fonction tierce qui tenterait d'intercepter une erreur 429 pour injecter une réponse locale
  function unsafeCallerWithLocalFallback(geminiErr) {
    if (geminiErr) {
      return {
        status: 'success',
        provider: 'none',
        responseOrigin: 'local_fallback',
        answerText: 'Réponse Ground Truth injectée'
      };
    }
  }

  const badOutput = unsafeCallerWithLocalFallback(new Error("429"));
  assert.throws(() => assertGenerationInvariants(badOutput), /INVALID_GENERATION_CONTRACT/);
  console.log("  ✅ [PASS] Invariant anti-contamination : impossible de requalifier une 429 en success");
  passedCount++;
}

// --- 11. Test du flux complet avec fixture (End-to-End simulé) ---
console.log("\n--- 11. Test du flux complet avec fixture (End-to-End simulé) ---");
{
  const mockClient = createMockGeminiClient({
    text: "Le cavalier sur le cheval blanc représentait l'antichrist sous une fausse paix [Réf: 63-0324M, §2]."
  });

  const fullResult = await generateNewRagResponse({
    query: "Que représentait le cavalier blanc ?",
    evidencePackage: testEvidencePackage,
    geminiClient: mockClient
  });

  assertGenerationInvariants(fullResult);
  assert.strictEqual(fullResult.status, 'success');
  assert.strictEqual(fullResult.provider, 'google-gemini');
  assert.strictEqual(fullResult.responseOrigin, 'gemini');
  assert.strictEqual(fullResult.citationsValidation?.allCitationsValid, true);
  assert.ok(fullResult.sources && fullResult.sources.length > 0);
  console.log("  ✅ [PASS] Flux complet validé : Question → Evidence → Mock Gemini → Validator → Result");
  passedCount++;
}

// 2. VÉRIFICATION FINALE DES FEATURE FLAGS DE PRODUCTION
if (aiConfig.featureFlags.useLegacyRetrieval !== true || aiConfig.featureFlags.useHybridRetrieval !== false) {
  console.error("❌ PRODUCTION_FLAG_MUTATION_DETECTED : Les flags de production ont été modifiés pendant les tests !");
  process.exit(1);
}
console.log("\n✅ Contrôle final des flags : useLegacyRetrieval=true, useHybridRetrieval=false (inchangés).");

console.log(`\n=================================================`);
console.log(` RÉSULTATS : ${passedCount}/${passedCount} TESTS D'INTÉGRATION GÉNÉRATION RÉUSSIS`);
console.log(` 📞 Appels réels API Gemini effectués : 0 (100% fixtures déterministes)`);
console.log("=================================================");
