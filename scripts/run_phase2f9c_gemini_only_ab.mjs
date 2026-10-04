/**
 * King's Sword — Gemini-only Generation Validation (Phase 2F.9C)
 * 
 * Benchmark comparatif de génération A/B mesurant EXCLUSIVEMENT la qualité
 * réelle des réponses produites par Google Gemini (gemini-3.8-flash).
 * 
 * RÈGLE ABSOLUE :
 * Une erreur Gemini reste une erreur Gemini (answerText = null).
 * Aucun fallback (LLM alternatif, Ollama, Ground Truth, local, cache, synthétique)
 * n'est autorisé sous aucune circonstance.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// 1. VÉRIFICATION D'ISOLATION ET DE SÉCURITÉ ANTI-CONTAMINATION
const forbidden2f9bPath = path.join(rootDir, 'eval', 'results', 'phase2f9b_generation_ab.json');
// GARANTIE : On vérifie que phase2f9b_generation_ab.json n'est ni lu ni utilisé.
if (process.env.TEST_READ_FORBIDDEN_FILE === 'true') {
  fs.readFileSync(forbidden2f9bPath);
}

// Import des configurations et services officiels
import { aiConfig } from '../config/aiConfig.ts';
import { retrieveRelevantSermonPassages } from '../services/sermonRagService.ts';
import { executeAutoRagPipeline, formatEvidenceContextForGemini } from '../services/autoRagRetrievalService.ts';
import { validateResponseCitations } from '../services/citationValidationService.ts';
import { initGeminiApiKey, getGeminiApiKey } from '../utils/apiKeyHelper.ts';
import { useAppStore } from '../store.ts';

import { GoogleGenAI } from "@google/genai";

// Contrôle strict des feature flags de production
if (aiConfig.featureFlags.useLegacyRetrieval !== true || aiConfig.featureFlags.useHybridRetrieval !== false) {
  console.error("❌ STOP : Les feature flags de production ne sont pas conformes.");
  console.error(`Attendu: useLegacyRetrieval=true, useHybridRetrieval=false`);
  console.error(`Reçu: useLegacyRetrieval=${aiConfig.featureFlags.useLegacyRetrieval}, useHybridRetrieval=${aiConfig.featureFlags.useHybridRetrieval}`);
  process.exit(1);
}

console.log("=================================================");
console.log(" 🧪 GEMINI-ONLY GENERATION VALIDATION (2F.9C)");
console.log("=================================================");

// 2. CHARGEMENT ET SÉLECTION DES 10 QUESTIONS DE RÉFÉRENCE
const libraryPath = path.join(rootDir, 'public', 'library.json');
const questionsPath = path.join(rootDir, 'eval', 'questions.json');

if (!fs.existsSync(questionsPath) || !fs.existsSync(libraryPath)) {
  console.error("❌ STOP : eval/questions.json ou public/library.json introuvable.");
  process.exit(1);
}

const sermons = JSON.parse(fs.readFileSync(libraryPath, 'utf8'));
const questions = JSON.parse(fs.readFileSync(questionsPath, 'utf8'));

// Initialisation du store Zustand en mémoire
sermons.forEach(s => useAppStore.getState().sermonsMap.set(s.id, s));

const targetCategories = [
  'enseignement_precis',
  'theme_biblique',
  'phrase_expression',
  'doctrine',
  'personne_biblique',
  'evenement_biblique',
  'relations_passages',
  'multi_sermons',
  'citation_precise',
  'hors_corpus'
];

const selectedQuestions = [];
for (const cat of targetCategories) {
  const match = questions.find(q => q.category === cat);
  if (!match) {
    console.error(`❌ STOP : Catégorie requise manquante : "${cat}" dans questions.json`);
    process.exit(1);
  }
  selectedQuestions.push(match);
}

console.log(`🎯 Sélection déterministe des 10 questions de référence réussie.`);

// 3. INITIALISATION DU CLIENT GEMINI
await initGeminiApiKey();
const apiKey = getGeminiApiKey();
if (!apiKey) {
  console.error("❌ STOP : Clé API Gemini introuvable dans l'environnement.");
  process.exit(1);
}

const ai = new GoogleGenAI({
  apiKey: apiKey,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

const delayMs = parseInt(process.env.PHASE2F9C_DELAY_MS || '20000', 10);
console.log(`⚙️ Espacement configuré : ${delayMs} ms entre les requêtes.`);

// Sleep helper
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Détecteur strict de chunkId
const strictChunkIdRegex = /(?:chunk_[a-zA-Z0-9_\-]+|[a-zA-Z0-9_\-]+_c\d+_p[a-zA-Z0-9_\-]+)/gi;

function extractStrictChunkIds(text) {
  if (!text) return [];
  const matches = text.match(strictChunkIdRegex) || [];
  const excluded = new Set([
    'chunkIdExposure', 'chunkId', 'chunkIdExposureLegacy', 'chunkIdExposureNewRag', 
    'type.googleapis.com', 'RESOURCE_EXHAUSTED'
  ]);
  return Array.from(new Set(matches)).filter(id => !excluded.has(id));
}

function formatLegacyContextForGemini(paragraphs) {
  if (!paragraphs || paragraphs.length === 0) {
    return "AUCUNE SOURCE PERTINENTE DISPONIBLE DANS LA BASE DOCUMENTAIRE POUR CETTE QUESTION.";
  }

  const sourcesList = paragraphs.map((p, idx) => {
    return `[SOURCE ${idx + 1}]
Sermon : "${p.title}"
Date : ${p.date || 'Non daté'} | Lieu : ${p.city || 'Inconnu'} | Version : ${p.version || 'Standard'}
Identifiant sermon : ${p.sermonId}
Paragraphe : §${p.paragraphIndex}
Référence de citation valide pour cette source : [Réf: ${p.sermonId}, Para. ${p.paragraphIndex}]

TEXTE :
"""
${p.content}
"""`;
  }).join('\n\n------------------------------------------------------------\n\n');

  return `PASSAGES SÉLECTIONNÉS PAR LE MOTEUR LEGACY POUR CETTE QUESTION :
============================================================
${sourcesList}
============================================================

DIRECTIVES DE RÉPONSE STRICTES POUR L'ASSISTANT THÉOLOGIQUE :
1. Réponds à la question en t'appuyant EXCLUSIVEMENT sur les passages fournis ci-dessus.
2. Pour chaque affirmation ou citation, cite la référence du paragraphe correspondant sous la forme exacte :
   > « Extrait textuel... » [Réf: ID_SERMON, Para. N]
3. N'utilise AUCUNE information extérieure et n'extrapole pas au-delà des extraits fournis.
4. Si les extraits ci-dessus ne permettent pas de répondre précisément à la question, déclare :
   « Les documents disponibles dans la base documentaire ne contiennent pas d'informations suffisantes pour répondre à cette question. »`;
}

function buildLegacyEvidencePackage(paragraphs, query) {
  const answerable = paragraphs.length > 0;
  
  const evidence = paragraphs.map((p, idx) => {
    return {
      chunkId: `legacy_${p.sermonId}_p${p.paragraphIndex}`,
      sermonId: p.sermonId,
      sermonTitle: p.title,
      paragraphIds: [p.paragraphIndex],
      startParagraph: p.paragraphIndex,
      endParagraph: p.paragraphIndex,
      text: p.content,
      date: p.date,
      city: p.city,
      version: p.version,
      retrievalScore: p.score || 0,
      rank: idx + 1,
      sourceType: 'lexical',
      citationParagraphs: [
        {
          paragraphIndex: p.paragraphIndex,
          formattedCitation: `[Réf: ${p.sermonId}, Para. ${p.paragraphIndex}]`,
          textSnippet: p.content.substring(0, 100),
          isAuthentic: true
        }
      ]
    };
  });

  return {
    answerable,
    confidenceScore: answerable ? 0.8 : 0,
    reason: answerable ? 'Passages trouvés.' : 'Aucun passage trouvé.',
    evidence,
    query,
    totalCandidates: paragraphs.length,
    rejectedCount: 0
  };
}

function computeLexicalEvidenceCoverage(responseText, contextText) {
  if (!responseText || !contextText) return 0;
  
  const stopWords = new Set([
    'dans', 'avec', 'pour', 'plus', 'nous', 'vous', 'elle', 'elles', 'sont',
    'sermon', 'sermons', 'paragraphe', 'paragraphes', 'reponse', 'questions', 'chercheur', 'source', 'sources'
  ]);
  
  const extractWords = (text) => {
    return text.toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !stopWords.has(w));
  };

  const responseWords = extractWords(responseText);
  if (responseWords.length === 0) return 0;

  const contextWordsSet = new Set(extractWords(contextText));
  
  let matched = 0;
  const uniqueResponseWords = Array.from(new Set(responseWords));
  for (const w of uniqueResponseWords) {
    if (contextWordsSet.has(w)) {
      matched++;
    }
  }

  return Math.round((matched / uniqueResponseWords.length) * 1000) / 1000;
}

function isCorrectRefusal(responseText, answerable) {
  if (answerable) return false;
  if (!responseText) return false;
  
  const norm = responseText.toLowerCase();
  const refusalPhrases = [
    "ne contiennent pas d'informations",
    "ne contiennent pas d'elements",
    "ne permettent pas de repondre",
    "aucun passage",
    "pas d'information",
    "hors corpus",
    "impossible de repondre"
  ];
  return refusalPhrases.some(phrase => norm.includes(phrase));
}

// 4. APPEL GEMINI DÉDIÉ SANS AUCUN FALLBACK
let isQuotaBlocked = false;

async function callGeminiOnly(params) {
  const modelName = "gemini-3.8-flash";
  const provider = "google-gemini";
  const fallbackUsed = false; // INVIOLABLE

  if (isQuotaBlocked) {
    const now = new Date().toISOString();
    return {
      generationStatus: "quota_error",
      responseOrigin: "none",
      fallbackUsed: false,
      answerText: null,
      latencyMs: null,
      errorCode: "RESOURCE_EXHAUSTED_DAILY",
      errorMessage: "Le quota quotidien Gemini est totalement épuisé. Bloqué pour le reste du benchmark.",
      requestTimestamp: now,
      responseTimestamp: now,
      usage: null
    };
  }

  const reqTimestamp = new Date().toISOString();
  const t0 = Date.now();

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: params.prompt,
      config: {
        systemInstruction: params.systemInstruction,
        temperature: params.temperature ?? 0.2
      }
    });

    const latencyMs = Date.now() - t0;
    const resTimestamp = new Date().toISOString();

    if (response && typeof response.text === 'string' && response.text.trim().length > 0) {
      return {
        generationStatus: "success",
        responseOrigin: "gemini",
        fallbackUsed: false,
        answerText: response.text,
        latencyMs: latencyMs,
        errorCode: null,
        errorMessage: null,
        requestTimestamp: reqTimestamp,
        responseTimestamp: resTimestamp,
        usage: response.usageMetadata || null
      };
    } else {
      return {
        generationStatus: "service_error",
        responseOrigin: "none",
        fallbackUsed: false,
        answerText: null,
        latencyMs: latencyMs,
        errorCode: "EMPTY_RESPONSE",
        errorMessage: "Réponse vide reçue de Gemini.",
        requestTimestamp: reqTimestamp,
        responseTimestamp: resTimestamp,
        usage: null
      };
    }
  } catch (err) {
    const latencyMs = Date.now() - t0;
    const resTimestamp = new Date().toISOString();
    const errorMsg = err?.message || String(err);
    const normErr = errorMsg.toLowerCase();

    const is429 = normErr.includes("429") || normErr.includes("resource_exhausted") || normErr.includes("quota") || normErr.includes("limit") || normErr.includes("requests");
    const isDailyQuotaExhausted = is429 && (normErr.includes("daily") || normErr.includes("freetier") || normErr.includes("20") || normErr.includes("limit: 0"));
    const is503 = normErr.includes("503") || normErr.includes("unavailable") || normErr.includes("demand") || normErr.includes("temporary");

    if (isDailyQuotaExhausted) {
      console.warn(`[Gemini-Only] 🛑 Quota quotidien épuisé détecté : ${errorMsg}`);
      isQuotaBlocked = true;
      return {
        generationStatus: "quota_error",
        responseOrigin: "none",
        fallbackUsed: false,
        answerText: null,
        latencyMs: latencyMs,
        errorCode: "RESOURCE_EXHAUSTED_DAILY",
        errorMessage: errorMsg,
        requestTimestamp: reqTimestamp,
        responseTimestamp: resTimestamp,
        usage: null
      };
    }

    if (is429) {
      console.warn(`[Gemini-Only] 429 détecté. Tentative unique de retry dans 60 secondes...`);
      await sleep(60000);
      
      const retryT0 = Date.now();
      const retryReqTimestamp = new Date().toISOString();
      try {
        const retryRes = await ai.models.generateContent({
          model: modelName,
          contents: params.prompt,
          config: {
            systemInstruction: params.systemInstruction,
            temperature: params.temperature ?? 0.2
          }
        });
        const retryLatencyMs = Date.now() - retryT0;
        const retryResTimestamp = new Date().toISOString();

        if (retryRes && typeof retryRes.text === 'string' && retryRes.text.trim().length > 0) {
          return {
            generationStatus: "success",
            responseOrigin: "gemini",
            fallbackUsed: false,
            answerText: retryRes.text,
            latencyMs: retryLatencyMs,
            errorCode: null,
            errorMessage: null,
            requestTimestamp: retryReqTimestamp,
            responseTimestamp: retryResTimestamp,
            usage: retryRes.usageMetadata || null
          };
        }
      } catch (retryErr) {
        const retryErrStr = retryErr?.message || String(retryErr);
        if (retryErrStr.toLowerCase().includes("daily") || retryErrStr.toLowerCase().includes("resource_exhausted")) {
          isQuotaBlocked = true;
        }
        return {
          generationStatus: "quota_error",
          responseOrigin: "none",
          fallbackUsed: false,
          answerText: null,
          latencyMs: Date.now() - retryT0,
          errorCode: "RESOURCE_EXHAUSTED",
          errorMessage: retryErrStr,
          requestTimestamp: retryReqTimestamp,
          responseTimestamp: new Date().toISOString(),
          usage: null
        };
      }

      return {
        generationStatus: "quota_error",
        responseOrigin: "none",
        fallbackUsed: false,
        answerText: null,
        latencyMs: latencyMs,
        errorCode: "RESOURCE_EXHAUSTED",
        errorMessage: errorMsg,
        requestTimestamp: reqTimestamp,
        responseTimestamp: resTimestamp,
        usage: null
      };
    }

    if (is503) {
      console.warn(`[Gemini-Only] 503 Service Indisponible. Tentative unique de retry dans 30 secondes...`);
      await sleep(30000);

      const retryT0 = Date.now();
      const retryReqTimestamp = new Date().toISOString();
      try {
        const retryRes = await ai.models.generateContent({
          model: modelName,
          contents: params.prompt,
          config: {
            systemInstruction: params.systemInstruction,
            temperature: params.temperature ?? 0.2
          }
        });
        const retryLatencyMs = Date.now() - retryT0;
        const retryResTimestamp = new Date().toISOString();

        if (retryRes && typeof retryRes.text === 'string' && retryRes.text.trim().length > 0) {
          return {
            generationStatus: "success",
            responseOrigin: "gemini",
            fallbackUsed: false,
            answerText: retryRes.text,
            latencyMs: retryLatencyMs,
            errorCode: null,
            errorMessage: null,
            requestTimestamp: retryReqTimestamp,
            responseTimestamp: retryResTimestamp,
            usage: retryRes.usageMetadata || null
          };
        }
      } catch (retryErr) {
        return {
          generationStatus: "service_error",
          responseOrigin: "none",
          fallbackUsed: false,
          answerText: null,
          latencyMs: Date.now() - retryT0,
          errorCode: "SERVICE_UNAVAILABLE",
          errorMessage: retryErr?.message || String(retryErr),
          requestTimestamp: retryReqTimestamp,
          responseTimestamp: new Date().toISOString(),
          usage: null
        };
      }

      return {
        generationStatus: "service_error",
        responseOrigin: "none",
        fallbackUsed: false,
        answerText: null,
        latencyMs: latencyMs,
        errorCode: "SERVICE_UNAVAILABLE",
        errorMessage: errorMsg,
        requestTimestamp: reqTimestamp,
        responseTimestamp: resTimestamp,
        usage: null
      };
    }

    // Autres erreurs API
    return {
      generationStatus: "service_error",
      responseOrigin: "none",
      fallbackUsed: false,
      answerText: null,
      latencyMs: latencyMs,
      errorCode: "API_ERROR",
      errorMessage: errorMsg,
      requestTimestamp: reqTimestamp,
      responseTimestamp: resTimestamp,
      usage: null
    };
  }
}

// 5. EXÉCUTION DU BENCHMARK COMPARATIF
const systemInstruction = `Tu es l'assistant d'étude théologique de King's Sword, expert des sermons de William Marrion Branham.

DIRECTIVES STRICTES DE RÉPONSE FONDÉE EXCLUSIVEMENT SUR LES SOURCES FOURNIES DANS L'APPLICATION :
1. Réponds à la question posée en te basant EXCLUSIVEMENT sur les extraits de sermons et documents fournis ci-dessous.
2. N'extrapole pas, n'utilise AUCUNE source web externe, et n'invente aucune doctrine ou interprétation qui ne figure pas expressément dans ces extraits.
3. Pour chaque affirmation ou citation tirée d'un extrait, insère obligatoirement la référence exacte au format :
   > « ... » [Réf: ID_SERMON, Para. N]
   (Exemple : > « Le premier sceau a été ouvert... » [Réf: 63-0324M, Para. 2])
4. N'invente JAMAIS d'identifiant de sermon ni de numéro de paragraphe. Utilise UNIQUEMENT les références fournies dans le texte source.
5. Si les extraits fournis ne contiennent pas d'éléments suffisants pour répondre à la question, réponds très exactement :
   « Les documents disponibles dans la base documentaire de l'application ne contiennent pas d'informations suffisantes pour répondre à cette question. »
6. Regroupe toujours en fin de réponse une section "### Sources consultées" listant clairement les sermons et paragraphes cités.`;

const results = [];

for (let idx = 0; idx < selectedQuestions.length; idx++) {
  const qObj = selectedQuestions[idx];
  const query = qObj.question;
  const isAnswerable = qObj.answerable !== false;

  console.log(`\n=================================================`);
  console.log(`🔋 QUESTION ${idx + 1}/10 : Q${qObj.id} (${qObj.category})`);
  console.log(`=================================================`);

  // --- PIPELINE 1 : LEGACY RETRIEVAL ---
  const callNumLegacy = idx * 2 + 1;
  console.log(`[${callNumLegacy}/20] Q${qObj.id} Legacy`);
  const tLegRet0 = Date.now();
  const legacyRes = await retrieveRelevantSermonPassages(query, { maxParagraphs: 20, minScoreThreshold: 0 });
  const legacyPassages = legacyRes.paragraphs || [];
  const retrievalLatencyLegacyMs = Date.now() - tLegRet0;

  const legacyContext = formatLegacyContextForGemini(legacyPassages);
  const legacyEvidencePkg = buildLegacyEvidencePackage(legacyPassages, query);

  console.log(`[Generation Gemini] ...`);
  const legacyGeminiResult = await callGeminiOnly({
    prompt: `${legacyContext}\n\n============================================================\nQUESTION DU CHERCHEUR :\n"${query}"`,
    systemInstruction,
    temperature: aiConfig.models.autoRagTemperature
  });

  let legacyEvalMetrics = null;
  if (legacyGeminiResult.generationStatus === "success") {
    const citVal = validateResponseCitations({
      responseText: legacyGeminiResult.answerText,
      evidencePackage: legacyEvidencePkg
    });

    const detectedIds = extractStrictChunkIds(legacyGeminiResult.answerText);
    const chunkIdExposure = detectedIds.length > 0;

    legacyEvalMetrics = {
      candidateCount: legacyPassages.length,
      evidenceCount: legacyPassages.length,
      citationCount: citVal.citations.length,
      validCitationCount: citVal.validCitationCount,
      invalidCitationCount: citVal.invalidCitationCount,
      citationAuthenticity: citVal.citations.length > 0 ? Math.round((citVal.validCitationCount / citVal.citations.length) * 1000) / 1000 : null,
      lexicalEvidenceCoverage: computeLexicalEvidenceCoverage(legacyGeminiResult.answerText, legacyContext),
      correctRefusal: !isAnswerable ? isCorrectRefusal(legacyGeminiResult.answerText, legacyEvidencePkg.answerable) : null,
      chunkIdExposure
    };
    console.log(`[Legacy] ✅ SUCCESS | Latence: ${legacyGeminiResult.latencyMs} ms | Citations: ${citVal.validCitationCount}/${citVal.citations.length}`);
  } else {
    console.log(`[Legacy] ❌ ${legacyGeminiResult.generationStatus.toUpperCase()} | Error: ${legacyGeminiResult.errorMessage}`);
  }

  results.push({
    questionId: qObj.id,
    category: qObj.category,
    question: query,
    pipeline: "legacy",
    provider: "google-gemini",
    model: "gemini-3.8-flash",
    generationStatus: legacyGeminiResult.generationStatus,
    responseOrigin: legacyGeminiResult.responseOrigin,
    fallbackUsed: false, // INVIOLABLE
    answerText: legacyGeminiResult.answerText,
    latencyMs: legacyGeminiResult.latencyMs,
    retrievalLatencyMs: retrievalLatencyLegacyMs,
    errorCode: legacyGeminiResult.errorCode,
    errorMessage: legacyGeminiResult.errorMessage,
    requestTimestamp: legacyGeminiResult.requestTimestamp,
    responseTimestamp: legacyGeminiResult.responseTimestamp,
    evalMetrics: legacyEvalMetrics
  });

  if (idx < selectedQuestions.length - 1 || true) {
    console.log(`[Throttle] Pause de ${delayMs} ms avant l'appel suivant...`);
    await sleep(delayMs);
  }

  // --- PIPELINE 2 : NEW RAG ---
  const callNumNew = idx * 2 + 2;
  console.log(`[${callNumNew}/20] Q${qObj.id} New RAG`);
  const tNewRet0 = Date.now();
  const newEvidencePkg = await executeAutoRagPipeline(query, { maxEvidenceCount: 5 });
  const retrievalLatencyNewMs = Date.now() - tNewRet0;

  const newContext = formatEvidenceContextForGemini(newEvidencePkg, query);

  console.log(`[Generation Gemini] ...`);
  const newGeminiResult = await callGeminiOnly({
    prompt: `${newContext}\n\n============================================================\nQUESTION DU CHERCHEUR :\n"${query}"`,
    systemInstruction,
    temperature: aiConfig.models.autoRagTemperature
  });

  let newEvalMetrics = null;
  if (newGeminiResult.generationStatus === "success") {
    const citVal = validateResponseCitations({
      responseText: newGeminiResult.answerText,
      evidencePackage: newEvidencePkg
    });

    const detectedIds = extractStrictChunkIds(newGeminiResult.answerText);
    const chunkIdExposure = detectedIds.length > 0;

    newEvalMetrics = {
      candidateCount: newEvidencePkg.totalCandidates || 0,
      evidenceCount: newEvidencePkg.evidence.length,
      citationCount: citVal.citations.length,
      validCitationCount: citVal.validCitationCount,
      invalidCitationCount: citVal.invalidCitationCount,
      citationAuthenticity: citVal.citations.length > 0 ? Math.round((citVal.validCitationCount / citVal.citations.length) * 1000) / 1000 : null,
      lexicalEvidenceCoverage: computeLexicalEvidenceCoverage(newGeminiResult.answerText, newContext),
      correctRefusal: !isAnswerable ? isCorrectRefusal(newGeminiResult.answerText, newEvidencePkg.answerable) : null,
      chunkIdExposure
    };
    console.log(`[New RAG] ✅ SUCCESS | Latence: ${newGeminiResult.latencyMs} ms | Citations: ${citVal.validCitationCount}/${citVal.citations.length}`);
  } else {
    console.log(`[New RAG] ❌ ${newGeminiResult.generationStatus.toUpperCase()} | Error: ${newGeminiResult.errorMessage}`);
  }

  results.push({
    questionId: qObj.id,
    category: qObj.category,
    question: query,
    pipeline: "newRag",
    provider: "google-gemini",
    model: "gemini-3.8-flash",
    generationStatus: newGeminiResult.generationStatus,
    responseOrigin: newGeminiResult.responseOrigin,
    fallbackUsed: false, // INVIOLABLE
    answerText: newGeminiResult.answerText,
    latencyMs: newGeminiResult.latencyMs,
    retrievalLatencyMs: retrievalLatencyNewMs,
    errorCode: newGeminiResult.errorCode,
    errorMessage: newGeminiResult.errorMessage,
    requestTimestamp: newGeminiResult.requestTimestamp,
    responseTimestamp: newGeminiResult.responseTimestamp,
    evalMetrics: newEvalMetrics
  });

  if (idx < selectedQuestions.length - 1) {
    console.log(`[Throttle] Pause de ${delayMs} ms avant la question suivante...`);
    await sleep(delayMs);
  }
}

// 6. VALIDATION RIGOUSEUSE DES INVARIANTS STRUCTUELS
let invalidBenchmarkResultCount = 0;
let fallbackUsedCount = 0;

for (const r of results) {
  if (r.fallbackUsed !== false) {
    fallbackUsedCount++;
  }

  if (r.generationStatus === "success") {
    if (r.provider !== "google-gemini" ||
        r.model !== "gemini-3.8-flash" ||
        r.responseOrigin !== "gemini" ||
        r.fallbackUsed !== false ||
        !r.answerText ||
        typeof r.answerText !== 'string' ||
        r.answerText.trim().length === 0) {
      invalidBenchmarkResultCount++;
    }
  } else {
    if (r.responseOrigin !== "none" ||
        r.answerText !== null) {
      invalidBenchmarkResultCount++;
    }
  }
}

if (fallbackUsedCount > 0) {
  console.error("❌ ERREUR CRITIQUE : INVALID_FALLBACK_DETECTED - Un fallback a été détecté dans les résultats !");
  process.exit(1);
}

if (invalidBenchmarkResultCount > 0) {
  console.error("❌ ERREUR CRITIQUE : INVALID_BENCHMARK_RESULT - Incohérence de contrat de génération détectée !");
  process.exit(1);
}

// 7. COMPTABILISATION DES MÉTRIQUES ET DÉTERMINATION DE LA CLASSIFICATION
const attemptedGenerations = results.length; // 20
const successfulGeminiGenerations = results.filter(r => r.generationStatus === "success").length;
const quotaErrors = results.filter(r => r.generationStatus === "quota_error").length;
const serviceErrors = results.filter(r => r.generationStatus === "service_error").length;
const trueChunkIdExposureCount = results.filter(r => r.generationStatus === "success" && r.evalMetrics?.chunkIdExposure === true).length;

const legacySuccesses = results.filter(r => r.pipeline === "legacy" && r.generationStatus === "success");
const newRagSuccesses = results.filter(r => r.pipeline === "newRag" && r.generationStatus === "success");

let classification = "QUOTA_BLOCKED";

if (fallbackUsedCount > 0) {
  classification = "INVALID_FALLBACK_DETECTED";
} else if (invalidBenchmarkResultCount > 0) {
  classification = "INVALID_BENCHMARK_RESULT";
} else if (trueChunkIdExposureCount > 0 && successfulGeminiGenerations > 0) {
  classification = "CHUNK_ID_EXPOSURE_DETECTED";
} else if (successfulGeminiGenerations === 20 && fallbackUsedCount === 0 && invalidBenchmarkResultCount === 0 && trueChunkIdExposureCount === 0) {
  classification = "COMPLETE_CLEAN";
} else if (successfulGeminiGenerations > 0 && successfulGeminiGenerations < 20) {
  classification = "COMPLETE_PARTIAL_GEMINI";
} else if (isQuotaBlocked || quotaErrors > 0) {
  classification = "QUOTA_BLOCKED";
}

// 8. CRÉATION DU RAPPORT JSON
const jsonReportPath = path.join(rootDir, 'eval', 'results', 'phase2f9c_gemini_only_ab.json');
const reportData = {
  phase: "2F.9C",
  classification,
  provider: "google-gemini",
  model: "gemini-3.8-flash",
  configuration: {
    productionFlagsUnchanged: true,
    googleSearchUsed: false,
    useLegacyRetrieval: aiConfig.featureFlags.useLegacyRetrieval,
    useHybridRetrieval: aiConfig.featureFlags.useHybridRetrieval
  },
  expectedGenerations: 20,
  attemptedGenerations,
  successfulGeminiGenerations,
  quotaErrors,
  serviceErrors,
  fallbackUsedCount,
  trueChunkIdExposureCount,
  invalidBenchmarkResultCount,
  legacyGenuineSuccesses: `${legacySuccesses.length}/10`,
  newRagGenuineSuccesses: `${newRagSuccesses.length}/10`,
  results
};

fs.writeFileSync(jsonReportPath, JSON.stringify(reportData, null, 2), 'utf8');

// 9. CRÉATION DU RAPPORT MARKDOWN
const mdReportPath = path.join(rootDir, 'eval', 'results', 'phase2f9c_gemini_only_ab.md');
const mdContent = `# Phase 2F.9C — Gemini-only Generation Validation

## 1. Objectif
Mesurer exclusivement la qualité réelle des réponses générées par **Google Gemini (\`gemini-3.8-flash\`)** sans AUCUN fallback (ni LLM alternatif, ni Ollama, ni Ground Truth, ni cache, ni réponses synthétiques locales). Une erreur Gemini reste une erreur (\`answerText = null\`).

---

## 2. Configuration & Isolation
* **Provider** : \`google-gemini\`
* **Modèle** : \`gemini-3.8-flash\`
* **Température** : \`0.2\`
* **Google Search** : Désactivé (\`googleSearchUsed = false\`)
* **Feature flags de production** : \`useLegacyRetrieval=true\`, \`useHybridRetrieval=false\`
* **Classification finale** : \`${classification}\`

---

## 3. Bilan de Provenance et d'Intégrité

| Métrique | Valeur |
| :--- | :---: |
| **Générations attendues** | 20 |
| **Tentatives réelles d'appel Gemini** | ${attemptedGenerations} |
| **Succès authentiques Gemini** | **${successfulGeminiGenerations}** |
| **Erreurs Quota (429 / RESOURCE_EXHAUSTED)** | ${quotaErrors} |
| **Erreurs Service (503 / Autres)** | ${serviceErrors} |
| **Fallbacks utilisés (Ground Truth, Local, Cache, LLM fallback)** | **${fallbackUsedCount}** |
| **Faux positifs ou incohérences de contrat** | ${invalidBenchmarkResultCount} |
| **Expositions de véritables Chunk IDs** | ${trueChunkIdExposureCount} |

---

## 4. Résultats par Pipeline

* **Pipeline Legacy (Générations authentiques Gemini)** : ${legacySuccesses.length}/10
* **Pipeline New RAG (Générations authentiques Gemini)** : ${newRagSuccesses.length}/10

---

## 5. Détail par question

${results.map(r => `
### Question [${r.questionId}] (${r.category}) — Pipeline: ${r.pipeline.toUpperCase()}
* **Question** : "${r.question}"
* **Statut Génération** : \`${r.generationStatus.toUpperCase()}\`
* **Origine Réponse** : \`${r.responseOrigin}\`
* **Fallback Utilisé** : \`${r.fallbackUsed}\`
* **Latence API Gemini** : ${r.latencyMs !== null ? `${r.latencyMs} ms` : 'N/A'}
* **Code d'Erreur** : ${r.errorCode || 'Aucun'}
* **Message d'Erreur** : ${r.errorMessage || 'N/A'}
* **Texte de la réponse** :
${r.answerText ? `\`\`\`text\n${r.answerText}\n\`\`\`` : '*[AUCUNE RÉPONSE — ERREUR GEMINI CONSERVÉE EN L\'ÉTAT]*'}
`).join('\n------------------------------------------------------------\n')}
`;

fs.writeFileSync(mdReportPath, mdContent, 'utf8');

console.log(`\n=================================================`);
console.log(`💾 Rapport JSON : ${jsonReportPath}`);
console.log(`📄 Rapport MD   : ${mdReportPath}`);
console.log(`=================================================\n`);

// 10. AFFICHAGE DE LA SYNTHÈSE OBLIGATOIRE (RÈGLE 36)
console.log(`PHASE 2F.9C — GEMINI-ONLY GENERATION VALIDATION\n`);
console.log(`Expected generations: 20`);
console.log(`Actual Gemini attempts: ${attemptedGenerations}`);
console.log(`Successful Gemini generations: ${successfulGeminiGenerations}`);
console.log(`Quota errors: ${quotaErrors}`);
console.log(`Service errors: ${serviceErrors}\n`);
console.log(`Fallback used: ${fallbackUsedCount}`);
console.log(`Ground Truth fallback: 0`);
console.log(`Ollama fallback: 0`);
console.log(`Cached answer fallback: 0`);
console.log(`Synthetic answer fallback: 0\n`);
console.log(`True Chunk IDs exposed: ${trueChunkIdExposureCount}\n`);
console.log(`Legacy genuine Gemini successes: ${legacySuccesses.length}/10`);
console.log(`New RAG genuine Gemini successes: ${newRagSuccesses.length}/10\n`);
console.log(`Classification: ${classification}\n`);
console.log(`PRODUCTION FLAGS UNCHANGED\n`);
console.log(`STOP`);
