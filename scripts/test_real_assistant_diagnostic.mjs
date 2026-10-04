#!/usr/bin/env node
/**
 * King's Sword — Real Assistant Pipeline Diagnostic Test Suite
 * 
 * Verifies the 4 minimal required test scenarios:
 * 1. Sermon sélectionné + question connue (63-0324M)
 * 2. Exposé sélectionné + question connue (expose-ch-8)
 * 3. Bible sélectionnée + question connue (bible-jhn-3)
 * 4. Question hors AI Context (63-0324M + Question Jean 3)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { executeUnifiedRagAssistantFlow } from '../services/unifiedRagIntegrationService.ts';
import { aiConfig } from '../config/aiConfig.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let passCount = 0;
let failCount = 0;
const results = [];

function assert(condition, title, details = '') {
  if (condition) {
    passCount++;
    console.log(`  ✅ [PASS] ${title}`);
    results.push({ title, status: 'PASS', details });
  } else {
    failCount++;
    console.error(`  ❌ [FAIL] ${title} - ${details}`);
    results.push({ title, status: 'FAIL', details });
  }
}

console.log('==================================================================');
console.log('🔍 DIAGNOSTIC CIBLÉ DU FLUX RÉEL DE L\'ASSISTANT IA');
console.log('==================================================================\n');

aiConfig.featureFlags.useUnifiedRag = true;

// Mock Gemini Client pour tests déterministes d'intégration
const mockGeminiClient = {
  generateContent: async () => ({
    text: 'Explication doctrinale valide.\n\n> « ... » [Réf: 63-0324M, Para. 2]'
  })
};

(async () => {
  try {
    // -----------------------------------------------------------------
    // TEST 1 : Sermon sélectionné (63-0324M) + Question connue
    // -----------------------------------------------------------------
    console.log('--- TEST 1 : Sermon sélectionné (63-0324M) + Question connue ---');
    let geminiCalled1 = false;
    const res1 = await executeUnifiedRagAssistantFlow(
      'premier sceau cavalier cheval blanc',
      ['63-0324M'],
      {
        geminiClient: {
          generateContent: async () => {
            geminiCalled1 = true;
            return { text: 'Enseignement sur le premier sceau.\n\n> « Le cavalier... » [Réf: 63-0324M, Para. 2]' };
          }
        }
      }
    );

    console.log(`  Trace: AI Context [63-0324M] → ${res1.evidencePackage.evidence.length} preuves → answerable=${res1.evidencePackage.answerable} → Gemini appelé=${geminiCalled1}`);

    assert(
      res1.status === 'success' &&
      res1.evidencePackage.answerable === true &&
      res1.evidencePackage.evidence.length > 0 &&
      geminiCalled1 === true &&
      res1.evidencePackage.evidence.every(e => e.sermonId === '63-0324M'),
      'Test 1 Sermon : Chunks résolus > 0, answerable=true, Gemini appelé, 0 fuite'
    );

    // -----------------------------------------------------------------
    // TEST 2 : Exposé sélectionné (expose-ch-8) + Question connue
    // -----------------------------------------------------------------
    console.log('\n--- TEST 2 : Exposé sélectionné (expose-ch-8) + Question connue ---');
    let geminiCalled2 = false;
    const res2 = await executeUnifiedRagAssistantFlow(
      'Que signifie le nom Philadelphie d\'après l\'Exposé ?',
      ['expose-ch-8'],
      {
        geminiClient: {
          generateContent: async () => {
            geminiCalled2 = true;
            return { text: 'Philadelphie signifie amour fraternel.\n\n> « ... » [Réf: expose-ch-8, §15]' };
          }
        }
      }
    );

    console.log(`  Trace: AI Context [expose-ch-8] → ${res2.evidencePackage.evidence.length} preuves → answerable=${res2.evidencePackage.answerable} → Gemini appelé=${geminiCalled2}`);

    assert(
      res2.status === 'success' &&
      res2.evidencePackage.answerable === true &&
      res2.evidencePackage.evidence.length > 0 &&
      geminiCalled2 === true &&
      res2.evidencePackage.evidence.every(e => e.sermonId === 'expose-ch-8'),
      'Test 2 Exposé : Chunks résolus > 0, answerable=true, Gemini appelé, 0 fuite'
    );

    // -----------------------------------------------------------------
    // TEST 3 : Bible sélectionnée (bible-jhn-3) + Question connue
    // -----------------------------------------------------------------
    console.log('\n--- TEST 3 : Bible sélectionnée (bible-jhn-3) + Question connue ---');
    let geminiCalled3 = false;
    const res3 = await executeUnifiedRagAssistantFlow(
      'Car Dieu a tant aimé le monde qu\'il a donné son Fils unique',
      ['bible-jhn-3'],
      {
        geminiClient: {
          generateContent: async () => {
            geminiCalled3 = true;
            return { text: 'Texte selon Jean 3:16.\n\n> « ... » [Réf: bible-jhn-3, §16]' };
          }
        }
      }
    );

    console.log(`  Trace: AI Context [bible-jhn-3] → ${res3.evidencePackage.evidence.length} preuves → answerable=${res3.evidencePackage.answerable} → Gemini appelé=${geminiCalled3}`);

    assert(
      res3.status === 'success' &&
      res3.evidencePackage.answerable === true &&
      res3.evidencePackage.evidence.length > 0 &&
      geminiCalled3 === true &&
      res3.evidencePackage.evidence.every(e => e.sermonId === 'bible-jhn-3'),
      'Test 3 Bible : Versets résolus > 0, answerable=true, Gemini appelé, 0 fuite'
    );

    // -----------------------------------------------------------------
    // TEST 4 : Question hors AI Context (Isolement strict)
    // -----------------------------------------------------------------
    console.log('\n--- TEST 4 : Question hors AI Context (Isolement strict) ---');
    let geminiCalled4 = false;
    const res4 = await executeUnifiedRagAssistantFlow(
      'Que dit la rencontre nocturne de Nicodème avec Jésus au chapitre 3 selon saint Jean ?',
      ['63-0324M'], // Jean 3 est ABSENT de l'AI Context sélectionné
      {
        geminiClient: {
          generateContent: async () => {
            geminiCalled4 = true;
            return { text: 'INTERDIT' };
          }
        }
      }
    );

    console.log(`  Trace: AI Context [63-0324M] → ${res4.evidencePackage.evidence.length} preuves → answerable=${res4.evidencePackage.answerable} → Gemini appelé=${geminiCalled4}`);

    assert(
      res4.status === 'not_answerable' &&
      res4.evidencePackage.answerable === false &&
      geminiCalled4 === false,
      'Test 4 Hors Contexte : answerable=false, Gemini NON appelé (0 quota consommé), 0 fuite'
    );

    // -----------------------------------------------------------------
    // BILAN DES TESTS DE DIAGNOSTIC
    // -----------------------------------------------------------------
    console.log('\n==================================================================');
    console.log(` RÉSULTATS DIAGNOSTIC : ${passCount}/${passCount + failCount} TESTS PASSÉS (${Math.round((passCount / (passCount + failCount)) * 100)}%)`);
    console.log('==================================================================');

    if (failCount > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('💥 Erreur fatale lors du diagnostic :', err);
    process.exit(1);
  }
})();
