/**
 * King's Sword — Tests déterministes du système de Chunking (Phase 2A)
 * Valide l'intégrité du découpage en chunks, la préservation des sources et la couverture à 100%.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log("=================================================");
console.log(" 🧩 TESTS DU SYSTÈME DE CHUNKING RAG (PHASE 2A)");
console.log("=================================================\n");

let passed = 0;
let total = 0;

function assert(condition, message) {
  total++;
  if (condition) {
    console.log(`  ✅ [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${message}`);
  }
}

// 1. Chargement du corpus réel
const libraryPath = path.join(rootDir, 'public', 'library.json');
assert(fs.existsSync(libraryPath), "Fichier public/library.json accessible");
const library = JSON.parse(fs.readFileSync(libraryPath, 'utf8'));
assert(Array.isArray(library) && library.length > 0, `Corpus chargé (${library.length} sermons)`);

// 2. Fonctions de chunking (port ESM pour validation)
function parseSermonParagraphs(text) {
  if (!text || typeof text !== 'string') return [];
  const rawParagraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  return rawParagraphs.map((raw, idx) => {
    const trimmed = raw.trim();
    const leadingNumMatch = trimmed.match(/^(\d+)[\.\s]/);
    const num = leadingNumMatch ? parseInt(leadingNumMatch[1], 10) : idx + 1;
    return {
      num,
      text: trimmed,
      charCount: trimmed.length,
      wordCount: trimmed.split(/\s+/).filter(Boolean).length
    };
  });
}

function createSermonChunks(sermon, options = {}) {
  const maxCharacters = options.maxCharacters || 900;
  const maxParagraphsPerChunk = options.maxParagraphsPerChunk || 3;
  const overlapParagraphs = options.overlapParagraphs !== undefined ? options.overlapParagraphs : 1;

  const paragraphs = parseSermonParagraphs(sermon.text);
  if (paragraphs.length === 0) return [];

  const chunks = [];
  let pIdx = 0;
  let chunkCounter = 1;

  while (pIdx < paragraphs.length) {
    const currentGroup = [];
    let currentLength = 0;

    while (pIdx + currentGroup.length < paragraphs.length) {
      const candidate = paragraphs[pIdx + currentGroup.length];
      const addedLength = currentLength === 0 ? candidate.charCount : currentLength + 2 + candidate.charCount;

      if (currentGroup.length > 0) {
        if (addedLength > maxCharacters || currentGroup.length >= maxParagraphsPerChunk) {
          break;
        }
      }

      currentGroup.push(candidate);
      currentLength = addedLength;
    }

    if (currentGroup.length === 0) {
      currentGroup.push(paragraphs[pIdx]);
    }

    const paragraphIds = currentGroup.map(p => p.num);
    const startParagraph = paragraphIds[0];
    const endParagraph = paragraphIds[paragraphIds.length - 1];
    const chunkText = currentGroup.map(p => p.text).join('\n\n');

    chunks.push({
      chunkId: `${sermon.id}_c${chunkCounter}_p${startParagraph}_p${endParagraph}`,
      sermonId: sermon.id,
      paragraphIds,
      startParagraph,
      endParagraph,
      text: chunkText,
      sermonTitle: sermon.title,
      date: sermon.date,
      city: sermon.city,
      version: sermon.version,
      characterCount: chunkText.length,
      wordCount: chunkText.split(/\s+/).filter(Boolean).length
    });

    chunkCounter++;

    const groupSize = currentGroup.length;
    let step = groupSize;
    if (overlapParagraphs > 0 && groupSize > 1) {
      step = Math.max(1, groupSize - overlapParagraphs);
    }

    pIdx += step;
  }

  return chunks;
}

// 3. Tests sur chaque sermon individuel
let totalOriginalParagraphs = 0;
const allSermonChunks = [];
const allOriginalParagraphKeys = new Set();
const allCoveredParagraphKeys = new Set();

library.forEach(s => {
  const originalParas = parseSermonParagraphs(s.text);
  totalOriginalParagraphs += originalParas.length;
  originalParas.forEach(p => allOriginalParagraphKeys.add(`${s.id}_${p.num}`));

  const chunks = createSermonChunks(s);
  assert(chunks.length > 0, `Sermon ${s.id} génère des chunks (${chunks.length} chunks)`);

  // Vérifier la conformité de chaque chunk
  chunks.forEach(c => {
    assert(c.sermonId === s.id, `Chunk ${c.chunkId}: sermonId correct (${c.sermonId})`);
    assert(c.sermonTitle === s.title, `Chunk ${c.chunkId}: sermonTitle préservé`);
    assert(c.date === s.date, `Chunk ${c.chunkId}: date préservée`);
    assert(c.city === s.city, `Chunk ${c.chunkId}: city préservée`);
    assert(c.version === s.version, `Chunk ${c.chunkId}: version préservée`);
    assert(Array.isArray(c.paragraphIds) && c.paragraphIds.length > 0, `Chunk ${c.chunkId}: paragraphIds non vide`);
    assert(c.startParagraph === c.paragraphIds[0], `Chunk ${c.chunkId}: startParagraph concorde`);
    assert(c.endParagraph === c.paragraphIds[c.paragraphIds.length - 1], `Chunk ${c.chunkId}: endParagraph concorde`);

    // Vérifier l'ordre des paragraphes
    for (let i = 1; i < c.paragraphIds.length; i++) {
      assert(c.paragraphIds[i] > c.paragraphIds[i - 1], `Chunk ${c.chunkId}: ordre croissant des paragraphes respecté`);
    }

    // Vérifier que le texte reconstruit contient mot à mot les paragraphes correspondants
    c.paragraphIds.forEach(pNum => {
      const orig = originalParas.find(p => p.num === pNum);
      assert(orig !== undefined, `Chunk ${c.chunkId}: paragraphe ${pNum} existe dans l'original`);
      if (orig) {
        assert(c.text.includes(orig.text), `Chunk ${c.chunkId}: texte original préservé pour §${pNum}`);
      }
      allCoveredParagraphKeys.add(`${s.id}_${pNum}`);
    });

    allSermonChunks.push(c);
  });
});

// 4. Vérification de la couverture globale à 100%
const missingParagraphs = Array.from(allOriginalParagraphKeys).filter(k => !allCoveredParagraphKeys.has(k));
assert(missingParagraphs.length === 0, `Couverture de 100% des paragraphes (aucun paragraphe perdu : ${allCoveredParagraphKeys.size}/${allOriginalParagraphKeys.size})`);

// 5. Calcul des statistiques réelles du corpus
let totalChars = 0;
let totalWords = 0;
let totalParasInChunks = 0;
let minChars = Infinity;
let maxChars = 0;

allSermonChunks.forEach(c => {
  totalChars += c.characterCount;
  totalWords += c.wordCount;
  totalParasInChunks += c.paragraphIds.length;
  if (c.characterCount < minChars) minChars = c.characterCount;
  if (c.characterCount > maxChars) maxChars = c.characterCount;
});

const stats = {
  totalSermons: library.length,
  totalParagraphs: totalOriginalParagraphs,
  totalChunks: allSermonChunks.length,
  avgParagraphsPerChunk: Math.round((totalParasInChunks / allSermonChunks.length) * 10) / 10,
  avgChunkLengthChars: Math.round(totalChars / allSermonChunks.length),
  minChunkLengthChars: minChars,
  maxChunkLengthChars: maxChars,
  avgChunkLengthWords: Math.round(totalWords / allSermonChunks.length),
  coverageRate: Math.round((allCoveredParagraphKeys.size / allOriginalParagraphKeys.size) * 1000) / 10
};

console.log("\n=================================================");
console.log(" 📊 STATISTIQUES RÉELLES DU CHUNKING (CORPUS)");
console.log("=================================================");
console.log(` • Nombre de sermons           : ${stats.totalSermons}`);
console.log(` • Nombre de paragraphes       : ${stats.totalParagraphs}`);
console.log(` • Nombre de chunks            : ${stats.totalChunks}`);
console.log(` • Moyenne paragraphes / chunk : ${stats.avgParagraphsPerChunk}`);
console.log(` • Taille moyenne des chunks   : ${stats.avgChunkLengthChars} caractères (~${stats.avgChunkLengthWords} mots)`);
console.log(` • Taille min / max            : ${stats.minChunkLengthChars} / ${stats.maxChunkLengthChars} caractères`);
console.log(` • Taux de couverture          : ${stats.coverageRate}%`);
console.log("=================================================");

console.log(`\n RÉSULTATS : ${passed}/${total} TESTS PASSÉS AVEC SUCCÈS`);

if (passed !== total || missingParagraphs.length > 0) {
  process.exit(1);
}
