/**
 * King's Sword — Test Réel du Nouveau Pipeline RAG (Phase 2F.3)
 * 
 * Exécute le vrai flux de question/réponse sur les 10 questions représentatives du corpus de dev.
 * Compare rigoureusement :
 * 1. Moteur LEGACY (useHybridRetrieval = false)
 * 2. Nouveau Moteur (useHybridRetrieval = true)
 * 
 * Mesure :
 * - Answerability & Confiance
 * - Preuves / Paragraphes récupérés
 * - Réponses Gemini générées
 * - Validation déterministe des citations (Citations valides / invalides)
 * - Abstention sur hors-corpus (0 citation fictive)
 * - Latences (Retrieval, Gemini, Total)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// 1. Clé API Gemini
let apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '';
if (!apiKey) {
  const envPath = path.join(rootDir, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const match = envContent.match(/(?:VITE_)?GEMINI_API_KEY\s*=\s*([^\s\r\n]+)/);
    if (match) apiKey = match[1].replace(/^["']|["']$/g, '');
  }
}

if (!apiKey) {
  console.error("❌ ERREUR : Clé API Gemini introuvable.");
  process.exit(1);
}

// Imports des services
import { aiConfig } from '../config/aiConfig.ts';
import { retrieveRelevantSermonPassages, formatRagContextForGemini } from '../services/sermonRagService.ts';
import { executeAutoRagPipeline, formatEvidenceContextForGemini } from '../services/autoRagRetrievalService.ts';
import { askGeminiChat } from '../services/geminiChatService.ts';
import { createSermonChunks } from '../services/chunkingService.ts';
import { splitSermonIntoParagraphs, extractLeadingParagraphNumber } from '../utils/textUtils.ts';

import { useAppStore } from '../store.ts';

// Chargement du corpus de 4 sermons et des questions
const libraryPath = path.join(rootDir, 'public', 'library.json');
const sermons = JSON.parse(fs.readFileSync(libraryPath, 'utf8'));
const sermonsMap = new Map();
sermons.forEach(s => sermonsMap.set(s.id, s));
const allChunks = sermons.flatMap(s => createSermonChunks(s));

// Initialisation du store Zustand pour la recherche en mémoire
sermons.forEach(s => useAppStore.getState().sermonsMap.set(s.id, s));

// Sélection des 10 questions représentatives
const TARGET_Q_IDS = [
  'Q001', // enseignement_precis
  'Q002', // enseignement_precis
  'Q009', // theme_biblique
  'Q011', // theme_biblique
  'Q025', // doctrine
  'Q033', // personne_biblique
  'Q041', // evenement_biblique
  'Q057', // multi_sermons
  'Q065', // ambigue
  'Q073'  // hors_corpus
];

const allQuestions = JSON.parse(fs.readFileSync(path.join(rootDir, 'eval', 'questions.json'), 'utf8'));
const testQuestions = TARGET_Q_IDS.map(id => allQuestions.find(q => q.id === id)).filter(Boolean);

/**
 * Valide les citations présentes dans une réponse générée par Gemini
 */
function validateCitationsInResponse(responseText, sermonsMap) {
  const citationRegex = /\[Réf:\s*([a-zA-Z0-9_-]+)(?:,\s*(?:Para\.?|§)\s*(\d+))?\]/gi;
  const matches = [...responseText.matchAll(citationRegex)];

  let validCount = 0;
  let invalidCount = 0;
  const validDetails = [];
  const invalidDetails = [];

  for (const m of matches) {
    const rawRef = m[0];
    const sId = m[1] ? m[1].trim() : '';
    const pNum = m[2] ? parseInt(m[2], 10) : null;

    // 1. Invalide si c'est un chunkId (ex: contienne _c1_p)
    if (sId.includes('_c') || sId.toLowerCase().includes('chunk')) {
      invalidCount++;
      invalidDetails.push({ ref: rawRef, reason: 'Identifiant technique CHUNK_ID utilisé à la place de sermonId' });
      continue;
    }

    // 2. Invalide si le sermon n'existe pas dans le corpus
    const sermon = sermonsMap.get(sId);
    if (!sermon) {
      invalidCount++;
      invalidDetails.push({ ref: rawRef, reason: `Sermon ID "${sId}" inconnu dans le corpus` });
      continue;
    }

    // 3. Invalide si le numéro de paragraphe n'existe pas
    if (pNum !== null) {
      const paragraphs = splitSermonIntoParagraphs(sermon.text);
      let found = false;
      for (let idx = 0; idx < paragraphs.length; idx++) {
        const rawP = paragraphs[idx];
        const leading = extractLeadingParagraphNumber(rawP);
        const actualNum = leading !== null ? leading : idx + 1;
        if (actualNum === pNum) {
          found = true;
          break;
        }
      }

      if (!found) {
        invalidCount++;
        invalidDetails.push({ ref: rawRef, reason: `Paragraphe §${pNum} introuvable dans le sermon ${sId}` });
        continue;
      }
    }

    validCount++;
    validDetails.push({ ref: rawRef, sermonId: sId, paragraphIndex: pNum });
  }

  return {
    totalCitations: matches.length,
    validCount,
    invalidCount,
    validDetails,
    invalidDetails
  };
}

async function runRealPipelineTest() {
  console.log("=================================================");
  console.log(" 🎯 PHASE 2F.3 — TEST RÉEL DU NOUVEAU PIPELINE RAG (10 QUESTIONS)");
  console.log("=================================================\n");

  const results = [];

  for (let i = 0; i < testQuestions.length; i++) {
    const qObj = testQuestions[i];
    console.log(`\n------------------------------------------------------------`);
    console.log(`📌 Question ${i + 1}/10 [${qObj.id}] [${qObj.category.toUpperCase()}] : "${qObj.question}"`);
    console.log(`------------------------------------------------------------`);

    // --- A. TEST PIPELINE LEGACY (useHybridRetrieval = false) ---
    console.log("  🔹 Execution LEGACY (useHybridRetrieval = false)...");
    aiConfig.featureFlags.useHybridRetrieval = false;

    const legacyStart = Date.now();
    let legacyRetrievalMs = 0;
    let legacyGeminiMs = 0;
    let legacyRes = null;
    let legacyError = null;

    try {
      const t0 = Date.now();
      const ragResult = await retrieveRelevantSermonPassages(qObj.question, {
        maxParagraphs: 8,
        minScoreThreshold: 10
      });
      legacyRetrievalMs = Date.now() - t0;

      const formattedContext = formatRagContextForGemini(ragResult.paragraphs, qObj.question);

      const t1 = Date.now();
      legacyRes = await askGeminiChat(qObj.question, formattedContext, [], {
        mode: 'auto-rag',
        retrievedParagraphs: ragResult.paragraphs
      });
      legacyGeminiMs = Date.now() - t1;

    } catch (err) {
      legacyError = err.message || String(err);
      console.error("  ❌ Erreur Legacy :", legacyError);
    }

    const legacyTotalMs = Date.now() - legacyStart;
    const legacyCitations = legacyRes?.text ? validateCitationsInResponse(legacyRes.text, sermonsMap) : { validCount: 0, invalidCount: 0 };

    // --- B. TEST NOUVEAU PIPELINE (useHybridRetrieval = true) ---
    console.log("  ⚡ Execution NOUVEAU PIPELINE (useHybridRetrieval = true)...");
    aiConfig.featureFlags.useHybridRetrieval = true;

    const newStart = Date.now();
    let newRetrievalMs = 0;
    let newGeminiMs = 0;
    let newRes = null;
    let newPkg = null;
    let newError = null;

    try {
      const t0 = Date.now();
      newPkg = await executeAutoRagPipeline(qObj.question, {
        apiKey,
        originalSermons: sermons,
        allChunks,
        maxEvidenceCount: 5
      });
      newRetrievalMs = Date.now() - t0;

      const formattedContext = formatEvidenceContextForGemini(newPkg, qObj.question);

      const t1 = Date.now();
      newRes = await askGeminiChat(qObj.question, formattedContext, [], {
        mode: 'auto-rag',
        evidencePackage: newPkg
      });
      newGeminiMs = Date.now() - t1;

    } catch (err) {
      newError = err.message || String(err);
      console.error("  ❌ Erreur Nouveau Pipeline :", newError);
    }

    const newTotalMs = Date.now() - newStart;
    const newCitations = newRes?.text ? validateCitationsInResponse(newRes.text, sermonsMap) : { validCount: 0, invalidCount: 0 };

    // Remettre le flag à false par sécurité
    aiConfig.featureFlags.useHybridRetrieval = false;

    // Affichage synthétique de comparaison pour la question
    console.log(`\n  📊 Résultat comparatif Q${i + 1} (${qObj.category}) :`);
    console.log(`    • Legacy : ${legacyRes?.text ? 'Succès' : 'Erreur'} | Latence total: ${legacyTotalMs}ms (Retrieval: ${legacyRetrievalMs}ms, Gemini: ${legacyGeminiMs}ms)`);
    console.log(`    • Nouveau : Answerable=${newPkg?.answerable} (Confiance=${newPkg?.confidenceScore}) | Latence total: ${newTotalMs}ms (Retrieval: ${newRetrievalMs}ms, Gemini: ${newGeminiMs}ms)`);
    console.log(`    • Citations Legacy  : Valides = ${legacyCitations.validCount}, Invalides = ${legacyCitations.invalidCount}`);
    console.log(`    • Citations Nouveau : Valides = ${newCitations.validCount}, Invalides = ${newCitations.invalidCount}`);

    results.push({
      questionId: qObj.id,
      question: qObj.question,
      category: qObj.category,
      isExpectedAnswerable: qObj.answerable,
      legacy: {
        retrievedCount: legacyRes?.retrievedParagraphs?.length || 0,
        retrievalTimeMs: legacyRetrievalMs,
        geminiTimeMs: legacyGeminiMs,
        totalTimeMs: legacyTotalMs,
        responseText: legacyRes?.text || '',
        validCitations: legacyCitations.validCount,
        invalidCitations: legacyCitations.invalidCount,
        error: legacyError
      },
      newPipeline: {
        answerable: newPkg?.answerable || false,
        confidenceScore: newPkg?.confidenceScore || 0,
        reason: newPkg?.reason || '',
        evidenceCount: newPkg?.evidence?.length || 0,
        evidenceSermons: newPkg?.evidence?.map(e => ({ sermonId: e.sermonId, title: e.sermonTitle, paragraphIds: e.paragraphIds })) || [],
        retrievalTimeMs: newRetrievalMs,
        geminiTimeMs: newGeminiMs,
        totalTimeMs: newTotalMs,
        responseText: newRes?.text || '',
        validCitations: newCitations.validCount,
        invalidCitations: newCitations.invalidCount,
        invalidDetails: newCitations.invalidDetails,
        error: newError
      }
    });

    // Pause de précaution entre requêtes Gemini
    await new Promise(r => setTimeout(r, 1000));
  }

  // S'assurer que useHybridRetrieval est réinitialisé à false par défaut
  aiConfig.featureFlags.useHybridRetrieval = false;

  // Enregistrement du rapport complet
  const outputDir = path.join(rootDir, 'eval', 'results');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const reportPath = path.join(outputDir, 'phase2f3_report.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    defaultFlagVerified: aiConfig.featureFlags.useHybridRetrieval === false,
    questionsTestedCount: results.length,
    results
  }, null, 2));

  console.log("\n=================================================");
  console.log(`💾 Rapport de test réel enregistré dans : ${reportPath}`);
  console.log(`🔒 Vérification finale du Feature Flag : useHybridRetrieval = ${aiConfig.featureFlags.useHybridRetrieval}`);
  console.log("=================================================");
}

runRealPipelineTest().catch(err => {
  console.error("❌ ERREUR GLOBALE :", err);
  process.exit(1);
});
