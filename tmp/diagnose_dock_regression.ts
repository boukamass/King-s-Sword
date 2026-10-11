import fs from 'fs';
import path from 'path';
import { createMockSermon470412 } from '../eval/run_phase_b_c_measurements.js';
import { executeUnifiedRagAssistantFlow } from '../services/unifiedRagIntegrationService';
import { executeUnifiedRagPipeline, resolveAIContextChunks, normalizeAIContext } from '../services/unifiedRagService';
import { formatEvidenceContextForGemini } from '../services/autoRagRetrievalService';
import { aiConfig } from '../config/aiConfig';
import { marked } from 'marked';

// Active Unified RAG
aiConfig.featureFlags.useUnifiedRag = true;

const mockSermon = createMockSermon470412();
const loadedSermonsMap = new Map();
loadedSermonsMap.set('47-0412-SHP', mockSermon);

const testQueries = [
  "Que dit-il sur le fait de se retirer seul avec Dieu dans les montagnes ?",
  "Résume",
  "Quel rôle joue l'isolement dans la communion personnelle et le ressourcement spirituel d'un serviteur de Dieu ?"
];

// Helper reproducing formatAIResponse from AIAssistant.tsx
function formatAIResponse(text: string, sermonMeta: any) {
  const textWithoutPistes = (text || '').replace(/(?:#{1,4}\s*(?:💡\s*)?(?:Pistes d'approfondissement|Pistes d'etude|Questions de reflexion|Pistes d'exploration|Pistes d'approfondissement suggérées)[\s\S]*)/i, '').trim();
  const refRegex = /(?:\[|\()(?:\s*Réf\.?\s*:\s*)?([a-zA-Z0-9_-]+)(?:[,\s]+(?:§|Para\.?|Paragraphe|Page|p\.|v\.|verset)?\s*(\d+))?\s*(?:\]|\))/gi;
  const formattedText = textWithoutPistes.replace(refRegex, (match, rawDocId, rawParaNum) => {
    const cleanId = (rawDocId || '').trim();
    const pNum = rawParaNum ? parseInt(rawParaNum, 10) : 1;
    const titleDisplay = `${sermonMeta.title} (${sermonMeta.date})`;
    const paraLabel = rawParaNum ? `§${pNum}` : '';
    return `<a href="#" data-sermon-id="${cleanId}" data-para-num="${pNum}" class="sermon-ref"><span>📖 ${paraLabel ? `${paraLabel} — ` : ''}${titleDisplay}</span></a>`;
  });
  return marked(formattedText, { breaks: true });
}

async function run() {
  console.log("=== DÉBUT DU TEST DE REPRODUCTION RÉEL AVEC GEMINI ===");
  console.log(`Sermon ID: ${mockSermon.id} | Titre: ${mockSermon.title} | Paragraphes: ${mockSermon.paragraphs.length}`);

  for (let i = 0; i < testQueries.length; i++) {
    const q = testQueries[i];
    console.log(`\n================================================================================`);
    console.log(`QUESTION ${i + 1} : "${q}"`);
    console.log(`================================================================================`);

    // 1. Pipeline RAG pour extraire le contexte transmis
    const evidencePkg = await executeUnifiedRagPipeline(q, ['47-0412-SHP'], {
      loadedSermonsMap,
      topK: 15,
      maxEvidenceCount: 8
    });

    console.log(`\n--- 1. PASSAGES TRANSMIS AU MODÈLE (EVIDENCE) ---`);
    console.log(`Answerable : ${evidencePkg.answerable}`);
    console.log(`Nombre d'unités d'évidence : ${evidencePkg.evidence.length}`);
    evidencePkg.evidence.forEach((ev, evIdx) => {
      console.log(`  [Preuve #${evIdx + 1}] Sermon: ${ev.sermonId} | Paras: ${ev.paragraphIds.join(', ')} | Longueur texte: ${ev.text.length} caractères`);
      ev.citationParagraphs.forEach(cp => {
        console.log(`     -> Para §${cp.paragraphIndex} (${(cp.fullParagraphText || cp.textSnippet).length} car.) : "${(cp.fullParagraphText || cp.textSnippet).slice(0, 80)}..."`);
      });
    });

    const formattedContext = formatEvidenceContextForGemini(evidencePkg, q);
    console.log(`Longueur totale du bloc de contexte transmis: ${formattedContext.length} caractères`);

    // 2. Exécution du flux complet jusqu'à Gemini
    const result = await executeUnifiedRagAssistantFlow(q, ['47-0412-SHP'], {
      loadedSermonsMap,
      apiKey: process.env.GEMINI_API_KEY
    });

    console.log(`\n--- 2. RÉSULTAT DU FLUX ASSISTANT ---`);
    console.log(`Status : ${result.status}`);
    console.log(`Provider : ${result.generationResult?.provider}`);
    console.log(`Origin : ${result.generationResult?.responseOrigin}`);
    console.log(`Sources suffisantes : ${result.generationResult?.sourcesSuffisantes}`);
    console.log(`Latency : ${result.latencyMs} ms`);

    console.log(`\n--- 3. TEXTE BRUT RENVOYÉ PAR GEMINI ---`);
    console.log(`AnswerText length : ${result.answerText?.length || 0}`);
    console.log(`AnswerText complet :\n${result.answerText}`);

    console.log(`\n--- 4. CHAMPS AFFICHÉS DANS L'INTERFACE ---`);
    console.log(`A. Champ "Réponse" (msg.content) :`);
    console.log(result.answerText ? result.answerText.slice(0, 300) + '...' : '(vide)');

    console.log(`\nB. Citations dans le corps du texte (rendu HTML via formatAIResponse) :`);
    const renderedHtml = result.answerText ? (formatAIResponse(result.answerText, mockSermon) as string) : '';
    // Extract sermon-ref tags
    const refTags = renderedHtml.match(/<a [^>]*class="sermon-ref"[^>]*>[\s\S]*?<\/a>/gi) || [];
    console.log(`Nombre de badges de citation générés : ${refTags.length}`);
    refTags.forEach((tag, tIdx) => {
      console.log(`  Badge ${tIdx + 1}: ${tag}`);
    });

    console.log(`\nC. Champ "Passages consultés" (msg.sources) :`);
    console.log(`Nombre de sources : ${result.sources?.length || 0}`);
    (result.sources || []).forEach((s, sIdx) => {
      console.log(`  Source ${sIdx + 1} : title="${s.title}" | uri="${s.uri}" | sermonId="${s.sermonId}" | para=${s.paragraphIndex}`);
    });

    console.log(`\nD. Champ "Passages les plus proches" (RefusalPassagesBlock / closestPassages) :`);
    const closest = result.evidencePackage.closestPassages || [];
    console.log(`Nombre de closestPassages : ${closest.length}`);
    closest.forEach((cp, cpIdx) => {
      console.log(`  Closest ${cpIdx + 1} : title="${cp.title}" | textSnippet="${cp.textSnippet}"`);
    });

    console.log(`\nE. VÉRIFICATION DE LA PRÉSENCE D'EXTRAITS DANS L'AFFICHAGE :`);
    // Vérifier si un extrait textuel de plus de 20 caractères apparaît soit dans le badge de citation, soit dans le bouton de source consultée
    let hasExtractInBadge = refTags.some(t => t.length > 100 && !t.includes('La Communion par la Réhabilitation'));
    console.log(`Extraits dans les badges de citation ? ${hasExtractInBadge ? 'OUI' : 'NON (uniquement Titre + Numéro)'}`);
    console.log(`Extraits dans les boutons "Passages consultés" ? NON (uniquement source.title, max-w-[210px] truncate)`);
  }

  console.log("\n=== FIN DU TEST DE REPRODUCTION ===");
}

run().catch(console.error);
