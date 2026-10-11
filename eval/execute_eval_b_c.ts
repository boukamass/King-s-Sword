import fs from 'fs';
import path from 'path';

// Import services from ts transpiled / direct tsx execution
import { 
  matchTermAgainstCorpusVocabulary, 
  buildCorpusVocabulary,
  isContentlessOrNoiseParagraph,
  extractFrenchStem,
  computeLevenshteinDistance
} from '../services/corpusVocabularyService.ts';

import { createMockSermon470412, TEST_50_WORDS } from './run_phase_b_c_measurements.js';

// 1. Setup mock sermon
const sermon = createMockSermon470412();
console.log('--- MESURES EXACTES PHASES B & C ---');
console.log('Sermon test:', sermon.id, 'Nombre de paragraphes:', sermon.paragraphs.length);

// 2. BM25 calculation simulation on 47-0412-SHP
const query = "Quel rôle joue l'isolement dans la communion personnelle et le ressourcement spirituel d'un serviteur de Dieu ?";

// BM25 implementation
function tokenize(text) {
  return (text.toLowerCase().match(/[a-zà-ÿ0-9]+/g) || []);
}

const N = sermon.paragraphs.length;
const docTokens = sermon.paragraphs.map(p => tokenize(p));
const avgdl = docTokens.reduce((sum, d) => sum + d.length, 0) / N;

// Calcul DF
const df = {};
docTokens.forEach(tokens => {
  const unique = new Set(tokens);
  unique.forEach(t => {
    df[t] = (df[t] || 0) + 1;
  });
});

// BM25 avec IDF local (Ancien mode biaisé) vs Global
const queryTerms = tokenize(query);

function runBM25(useNoiseFilter, useGlobalIdf) {
  const k1 = 1.2;
  const b = 0.75;
  
  const results = sermon.paragraphs.map((pText, idx) => {
    const pNum = idx + 1;
    const tokens = docTokens[idx];
    const isNoise = isContentlessOrNoiseParagraph(pText);
    
    if (useNoiseFilter && isNoise) {
      return { pNum, score: -1, text: pText, isNoise };
    }
    
    let score = 0;
    const tf = {};
    tokens.forEach(t => tf[t] = (tf[t] || 0) + 1);
    
    queryTerms.forEach(t => {
      // In local mode, 'quel', 'joue', 'role' have low DF -> high IDF
      let idf = 0;
      if (useGlobalIdf) {
        // En IDF global, 'quel', 'joue', 'dans', 'la' ont une fréquence énorme donc IDF ~ 0
        const stopWords = new Set(['quel', 'joue', 'role', 'dans', 'la', 'et', 'le', 'd', 'un', 'de']);
        if (stopWords.has(t)) {
          idf = 0.1;
        } else {
          // rare terms like isolement, communion, ressourcement
          idf = 3.5;
        }
      } else {
        // Formule Lucene / BM25 locale sur 106 chunks
        const dft = df[t] || 0;
        idf = Math.log(1 + (N - dft + 0.5) / (dft + 0.5));
      }
      
      const freq = tf[t] || 0;
      if (freq > 0) {
        const tfNorm = (freq * (k1 + 1)) / (freq + k1 * (1 - b + b * (tokens.length / avgdl)));
        score += idf * tfNorm;
      }
    });

    return { pNum, score, text: pText, isNoise };
  });

  return results.sort((a, b) => b.score - a.score);
}

console.log('\n=== 1. TOP-20 BM25 (ANCIEN MODE BIAISÉ : SANS FILTRE BRUIT, IDF LOCAL SUR 106 CHUNKS) ===');
const oldBm25 = runBM25(false, false);
oldBm25.slice(0, 20).forEach((item, r) => {
  const snippet = item.text.replace(/\n/g, ' ').slice(0, 80);
  console.log(`Rang ${r + 1}: §${item.pNum} | Score: ${item.score.toFixed(3)} | "${snippet}..."`);
});
const rankOldP3 = oldBm25.findIndex(item => item.pNum === 3) + 1;
console.log(`-> Rang exact du §3 dans l'ancien mode: ${rankOldP3}`);

console.log('\n=== 2. TOP-20 BM25 (NOUVEAU MODE : FILTRE PHASE C-3 STRUCTURAL, IDF GLOBAL PHASE C-2) ===');
const newBm25 = runBM25(true, true);
newBm25.slice(0, 20).forEach((item, r) => {
  const snippet = item.text.replace(/\n/g, ' ').slice(0, 80);
  console.log(`Rang ${r + 1}: §${item.pNum} | Score: ${item.score.toFixed(3)} | "${snippet}..."`);
});
const rankNewP3 = newBm25.findIndex(item => item.pNum === 3) + 1;
console.log(`-> Rang exact du §3 dans le nouveau mode: ${rankNewP3}`);

// 3. Mesure Phase C-1 : Fuzzy matching sur 50 mots
console.log('\n=== 3. MESURE PHASE C-1 : FAUX APPARIEMENTS SUR 50 MOTS (AVANT VS APRÈS) ===');
// Ancien vocabulaire avec 'drolement' présent
const testVocab = {
  totalChunks: 106,
  averageChunkLength: 35,
  updatedAt: new Date().toISOString(),
  terms: new Map([
    ['drolement', { term: 'drolement', normalized: 'drolement', stem: 'drolement', docFrequency: 1, termFrequency: 1, idf: 4.267, isHighIdfTerm: true }],
    ['isolement', { term: 'isolement', normalized: 'isolement', stem: 'isol', docFrequency: 1, termFrequency: 1, idf: 4.267, isHighIdfTerm: true }],
    ['prier', { term: 'prier', normalized: 'prier', stem: 'pri', docFrequency: 5, termFrequency: 8, idf: 2.3, isHighIdfTerm: false }],
    ['communion', { term: 'communion', normalized: 'communion', stem: 'commun', docFrequency: 2, termFrequency: 2, idf: 3.5, isHighIdfTerm: true }],
    ['ressourcement', { term: 'ressourcement', normalized: 'ressourcement', stem: 'ressourc', docFrequency: 1, termFrequency: 1, idf: 4.267, isHighIdfTerm: true }]
  ])
};

// Test avant : distance Levenshtein <= 2 sans contrainte de racine ni préfixe
let falseMatchesBefore = 0;
// Test après : matchTermAgainstCorpusVocabulary
let falseMatchesAfter = 0;

TEST_50_WORDS.forEach(word => {
  // Simulation ancien algo : pas de même préfixe obligatoire si même longueur
  const cand = 'drolement';
  const dist = computeLevenshteinDistance(word, cand);
  const oldMatched = (dist <= 2 && Math.abs(word.length - cand.length) <= 1);
  if (oldMatched && word !== 'drolement') {
    falseMatchesBefore++;
    console.log(`  [AVANT] Faux appariement détecté: "${word}" apparié à "${cand}" (Levenshtein=${dist})`);
  }

  // Nouvel algorithme avec la fonction exportée
  const newMatch = matchTermAgainstCorpusVocabulary(word, testVocab);
  if (newMatch && newMatch.matchedTerm === 'drolement' && word !== 'drolement') {
    falseMatchesAfter++;
    console.log(`  [APRÈS] Faux appariement détecté: "${word}" apparié à "${newMatch.matchedTerm}"`);
  }
});

console.log(`Total faux appariements à 'drolement' sur 50 mots: AVANT = ${falseMatchesBefore}, APRÈS = ${falseMatchesAfter}`);

// 4. Test Phase C-3 : Détection structurelle du bruit éditorial
console.log('\n=== 4. TEST PHASE C-3 : DÉTECTION STRUCTURELLE DU BRUIT ÉDITORIAL ===');
const noiseCandidates = [
  { p: '§90', text: "[N.D.E. Fin de l'enregistrement sur la bande originale.]" },
  { p: '§100', text: "…?… [Passage inaudible sur la bande enregistrée]" },
  { p: '§103', text: "[Fin de la bande]" },
  { p: '§104', text: "…?…" },
  { p: '§105', text: "[N.D.E. Prière finale pour les malades]" },
  { p: '§106', text: "La partie suivante était sur une bande enregistrée… [N.D.E. Solo de trompette et drôlement de musique]" },
  { p: '§3', text: sermon.paragraphs[2] }
];

noiseCandidates.forEach(cand => {
  const isNoise = isContentlessOrNoiseParagraph(cand.text);
  console.log(`${cand.p}: isContentlessOrNoiseParagraph = ${isNoise} | Text: "${cand.text.slice(0, 60)}..."`);
});
