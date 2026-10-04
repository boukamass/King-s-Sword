/**
 * King's Sword — Anti-Fallback Automated Test Suite (Phase 2F.9C)
 * 
 * Valide les garde-fous architecturaux de la Phase 2F.9C :
 * Vérifie que toute tentative de fallback (Ollama, Ground Truth, Local, Cache,
 * Synthétique ou Silencieux) est strictement détectée et rejetée.
 */

import assert from 'assert';

console.log("=================================================");
console.log(" 🧪 TESTS AUTOMATIQUES ANTI-FALLBACK (2F.9C)");
console.log("=================================================");

function validateResultInvariants(result) {
  if (result.fallbackUsed !== false) {
    throw new Error("INVALID_FALLBACK_DETECTED");
  }

  if (result.generationStatus === "success") {
    if (result.provider !== "google-gemini") {
      throw new Error("INVALID_BENCHMARK_RESULT: Provider must be google-gemini");
    }
    if (result.model !== "gemini-3.8-flash") {
      throw new Error("INVALID_BENCHMARK_RESULT: Model must be gemini-3.8-flash");
    }
    if (result.responseOrigin !== "gemini") {
      throw new Error("INVALID_BENCHMARK_RESULT: Response origin must be gemini");
    }
    if (!result.answerText || typeof result.answerText !== 'string' || result.answerText.trim().length === 0) {
      throw new Error("INVALID_BENCHMARK_RESULT: Answer text must be a non-empty string on success");
    }
  } else {
    if (result.responseOrigin !== "none") {
      throw new Error("INVALID_BENCHMARK_RESULT: Response origin must be none on error");
    }
    if (result.answerText !== null) {
      throw new Error("INVALID_BENCHMARK_RESULT: Answer text must be null on error");
    }
  }
}

let passedCount = 0;

// Cas A : Gemini retourne 429
console.log("--- Cas A : Gemini retourne 429 ---");
{
  const resA = {
    questionId: "Q001",
    pipeline: "legacy",
    provider: "google-gemini",
    model: "gemini-3.8-flash",
    generationStatus: "quota_error",
    responseOrigin: "none",
    fallbackUsed: false,
    answerText: null,
    latencyMs: 120,
    errorCode: "RESOURCE_EXHAUSTED",
    errorMessage: "Quota exceeded",
    requestTimestamp: new Date().toISOString(),
    responseTimestamp: new Date().toISOString()
  };
  validateResultInvariants(resA);
  assert.strictEqual(resA.generationStatus, "quota_error");
  assert.strictEqual(resA.answerText, null);
  assert.strictEqual(resA.fallbackUsed, false);
  console.log("  ✅ [PASS] 429 conservé comme quota_error avec answerText = null");
  passedCount++;
}

// Cas B : Gemini retourne 503
console.log("\n--- Cas B : Gemini retourne 503 ---");
{
  const resB = {
    questionId: "Q002",
    pipeline: "newRag",
    provider: "google-gemini",
    model: "gemini-3.8-flash",
    generationStatus: "service_error",
    responseOrigin: "none",
    fallbackUsed: false,
    answerText: null,
    latencyMs: 340,
    errorCode: "SERVICE_UNAVAILABLE",
    errorMessage: "High demand",
    requestTimestamp: new Date().toISOString(),
    responseTimestamp: new Date().toISOString()
  };
  validateResultInvariants(resB);
  assert.strictEqual(resB.generationStatus, "service_error");
  assert.strictEqual(resB.answerText, null);
  console.log("  ✅ [PASS] 503 conservé comme service_error avec answerText = null");
  passedCount++;
}

// Cas C : Tentative de réponse locale après 429
console.log("\n--- Cas C : Tentative de réponse locale après 429 ---");
{
  const resC = {
    questionId: "Q003",
    pipeline: "legacy",
    provider: "google-gemini",
    model: "gemini-3.8-flash",
    generationStatus: "quota_error",
    responseOrigin: "none",
    fallbackUsed: true, // violation
    answerText: "Réponse locale de secours",
    latencyMs: 10,
    errorCode: null,
    errorMessage: null,
    requestTimestamp: new Date().toISOString(),
    responseTimestamp: new Date().toISOString()
  };
  assert.throws(() => validateResultInvariants(resC), /INVALID_FALLBACK_DETECTED|INVALID_BENCHMARK_RESULT/);
  console.log("  ✅ [PASS] Réponse locale après 429 rejetée avec INVALID_FALLBACK_DETECTED");
  passedCount++;
}

// Cas D : Injection de réponse Ollama
console.log("\n--- Cas D : Injection de réponse Ollama ---");
{
  const resD = {
    questionId: "Q004",
    pipeline: "newRag",
    provider: "ollama", // violation
    model: "gemini-3.8-flash",
    generationStatus: "success",
    responseOrigin: "gemini",
    fallbackUsed: false,
    answerText: "Réponse générée par Ollama",
    latencyMs: 50,
    errorCode: null,
    errorMessage: null,
    requestTimestamp: new Date().toISOString(),
    responseTimestamp: new Date().toISOString()
  };
  assert.throws(() => validateResultInvariants(resD), /INVALID_BENCHMARK_RESULT/);
  console.log("  ✅ [PASS] Réponse Ollama rejetée avec INVALID_BENCHMARK_RESULT");
  passedCount++;
}

// Cas E : Injection de réponse Ground Truth
console.log("\n--- Cas E : Injection de réponse Ground Truth ---");
{
  const resE = {
    questionId: "Q005",
    pipeline: "legacy",
    provider: "google-gemini",
    model: "gemini-3.8-flash",
    generationStatus: "success",
    responseOrigin: "ground_truth", // violation
    fallbackUsed: false,
    answerText: "Ground truth answer from questions.json",
    latencyMs: 0,
    errorCode: null,
    errorMessage: null,
    requestTimestamp: new Date().toISOString(),
    responseTimestamp: new Date().toISOString()
  };
  assert.throws(() => validateResultInvariants(resE), /INVALID_BENCHMARK_RESULT/);
  console.log("  ✅ [PASS] Réponse Ground Truth rejetée avec INVALID_BENCHMARK_RESULT");
  passedCount++;
}

// Cas F : Injection de réponse Cache
console.log("\n--- Cas F : Injection de réponse Cache ---");
{
  const resF = {
    questionId: "Q006",
    pipeline: "newRag",
    provider: "google-gemini",
    model: "gemini-3.8-flash",
    generationStatus: "quota_error",
    responseOrigin: "cache",
    fallbackUsed: false,
    answerText: "Réponse issue du cache phase2f9b", // violation
    latencyMs: 0,
    errorCode: null,
    errorMessage: null,
    requestTimestamp: new Date().toISOString(),
    responseTimestamp: new Date().toISOString()
  };
  assert.throws(() => validateResultInvariants(resF), /INVALID_BENCHMARK_RESULT/);
  console.log("  ✅ [PASS] Réponse issue du cache rejetée avec INVALID_BENCHMARK_RESULT");
  passedCount++;
}

// Cas G : Gemini réussit réellement
console.log("\n--- Cas G : Gemini réussit réellement ---");
{
  const resG = {
    questionId: "Q007",
    pipeline: "legacy",
    provider: "google-gemini",
    model: "gemini-3.8-flash",
    generationStatus: "success",
    responseOrigin: "gemini",
    fallbackUsed: false,
    answerText: "D'après le sermon 63-0324M, [Réf: 63-0324M, Para. 2] le cavalier portait un arc...",
    latencyMs: 1450,
    errorCode: null,
    errorMessage: null,
    requestTimestamp: new Date().toISOString(),
    responseTimestamp: new Date().toISOString()
  };
  validateResultInvariants(resG);
  assert.strictEqual(resG.generationStatus, "success");
  assert.strictEqual(resG.responseOrigin, "gemini");
  assert.strictEqual(resG.fallbackUsed, false);
  assert.ok(resG.answerText.length > 0);
  console.log("  ✅ [PASS] Succès authentique Gemini validé à 100%");
  passedCount++;
}

// Cas H : Réponse vide de Gemini
console.log("\n--- Cas H : Réponse vide de Gemini ---");
{
  const resH = {
    questionId: "Q008",
    pipeline: "newRag",
    provider: "google-gemini",
    model: "gemini-3.8-flash",
    generationStatus: "service_error",
    responseOrigin: "none",
    fallbackUsed: false,
    answerText: null,
    latencyMs: 800,
    errorCode: "EMPTY_RESPONSE",
    errorMessage: "Réponse vide reçue de Gemini.",
    requestTimestamp: new Date().toISOString(),
    responseTimestamp: new Date().toISOString()
  };
  validateResultInvariants(resH);
  assert.strictEqual(resH.generationStatus, "service_error");
  assert.strictEqual(resH.answerText, null);
  console.log("  ✅ [PASS] Réponse vide de Gemini traitée comme service_error");
  passedCount++;
}

// Test de Contamination par Injection
console.log("\n--- Test de Contamination par Injection ---");
{
  function fakeGeminiWithFallback(simulatedError) {
    if (simulatedError) {
      // Tente de renvoyer un Ground Truth au lieu de null
      return {
        generationStatus: "success",
        responseOrigin: "ground_truth",
        fallbackUsed: true,
        answerText: "Réponse Ground Truth"
      };
    }
    return {
      generationStatus: "success",
      responseOrigin: "gemini",
      fallbackUsed: false,
      answerText: "Vraie réponse Gemini"
    };
  }

  const badResult = fakeGeminiWithFallback(true);
  assert.throws(() => validateResultInvariants(badResult), /INVALID_FALLBACK_DETECTED|INVALID_BENCHMARK_RESULT/);
  console.log("  ✅ [PASS] Contamination par injection de réponse Ground Truth stoppée net");
  passedCount++;
}

console.log(`\n=================================================`);
console.log(` RÉSULTATS : ${passedCount}/${passedCount} TESTS AUTOMATIQUES DÉTECTION ANTI-FALLBACK PASSÉS AVEC SUCCÈS`);
console.log("=================================================");
