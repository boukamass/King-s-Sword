/**
 * King's Sword — Tests de Stockage Persistant des Chunks (Phase 2B.1)
 * Valide le schéma SQLite, les clés primaires, le contentHash et les opérations CRUD.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log("=================================================");
console.log(" 💾 TESTS DU STOCKAGE PERSISTANT DES CHUNKS (PHASE 2B.1)");
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

// 1. Chargement du corpus
const library = JSON.parse(fs.readFileSync(path.join(rootDir, 'public', 'library.json'), 'utf8'));
assert(Array.isArray(library) && library.length === 4, `Corpus de 4 sermons chargé`);

// 2. Fonctions de chunking et hash
function computeChunkHash(sermonId, paragraphIds, text) {
  const payload = `${sermonId}:${paragraphIds.join(',')}:${text}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x84222325;
  for (let i = 0; i < payload.length; i++) {
    const code = payload.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= (code + i);
    h2 = Math.imul(h2, 0x01000193);
  }
  const part1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const part2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `h_${part1}${part2}`;
}

function parseSermonParagraphs(text) {
  if (!text || typeof text !== 'string') return [];
  const rawParagraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  return rawParagraphs.map((raw, idx) => {
    const trimmed = raw.trim();
    const leadingNumMatch = trimmed.match(/^(\d+)[\.\s]/);
    const num = leadingNumMatch ? parseInt(leadingNumMatch[1], 10) : idx + 1;
    return { num, text: trimmed, charCount: trimmed.length };
  });
}

function createSermonChunks(sermon) {
  const paragraphs = parseSermonParagraphs(sermon.text);
  const chunks = [];
  let pIdx = 0;
  let chunkCounter = 1;

  while (pIdx < paragraphs.length) {
    const currentGroup = [];
    let currentLength = 0;

    while (pIdx + currentGroup.length < paragraphs.length) {
      const candidate = paragraphs[pIdx + currentGroup.length];
      const addedLength = currentLength === 0 ? candidate.charCount : currentLength + 2 + candidate.charCount;
      if (currentGroup.length > 0 && (addedLength > 900 || currentGroup.length >= 3)) break;
      currentGroup.push(candidate);
      currentLength = addedLength;
    }

    if (currentGroup.length === 0) currentGroup.push(paragraphs[pIdx]);

    const paragraphIds = currentGroup.map(p => p.num);
    const startParagraph = paragraphIds[0];
    const endParagraph = paragraphIds[paragraphIds.length - 1];
    const chunkText = currentGroup.map(p => p.text).join('\n\n');
    const contentHash = computeChunkHash(sermon.id, paragraphIds, chunkText);
    const now = new Date().toISOString();

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
      wordCount: chunkText.split(/\s+/).filter(Boolean).length,
      contentHash,
      createdAt: now,
      updatedAt: now
    });

    chunkCounter++;
    const step = currentGroup.length > 1 ? Math.max(1, currentGroup.length - 1) : currentGroup.length;
    pIdx += step;
  }
  return chunks;
}

// 3. Test de la base de données SQLite en mémoire
const testDb = new Database(':memory:');

// Exécution du schéma exact de production
testDb.exec(`
  CREATE TABLE IF NOT EXISTS sermons (
    id TEXT PRIMARY KEY, 
    title TEXT, 
    date TEXT, 
    city TEXT, 
    version TEXT, 
    time TEXT, 
    audio_url TEXT
  );

  CREATE TABLE IF NOT EXISTS sermon_chunks (
    chunk_id TEXT PRIMARY KEY,
    sermon_id TEXT,
    paragraph_ids TEXT,
    start_paragraph INTEGER,
    end_paragraph INTEGER,
    text TEXT,
    sermon_title TEXT,
    date TEXT,
    city TEXT,
    version TEXT,
    character_count INTEGER,
    word_count INTEGER,
    content_hash TEXT,
    embedding BLOB DEFAULT NULL,
    created_at TEXT,
    updated_at TEXT,
    FOREIGN KEY(sermon_id) REFERENCES sermons(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_chunks_sermon_id ON sermon_chunks(sermon_id);
  CREATE INDEX IF NOT EXISTS idx_chunks_content_hash ON sermon_chunks(content_hash);
`);

assert(testDb !== null, "Initialisation de la base SQLite de test");

// Vérification de la structure des colonnes de sermon_chunks
const columns = testDb.prepare("PRAGMA table_info(sermon_chunks)").all();
const columnNames = new Set(columns.map(c => c.name));
const expectedCols = [
  'chunk_id', 'sermon_id', 'paragraph_ids', 'start_paragraph', 'end_paragraph',
  'text', 'sermon_title', 'date', 'city', 'version', 'character_count', 'word_count',
  'content_hash', 'embedding', 'created_at', 'updated_at'
];

expectedCols.forEach(col => {
  assert(columnNames.has(col), `Colonne SQLite présente : ${col}`);
});

// Insertion des sermons parents
const insertSermon = testDb.prepare('INSERT INTO sermons (id, title, date, city, version) VALUES (?, ?, ?, ?, ?)');
library.forEach(s => {
  insertSermon.run(s.id, s.title, s.date, s.city, s.version);
});

// Génération de tous les chunks du corpus
const allChunks = [];
library.forEach(s => {
  allChunks.push(...createSermonChunks(s));
});
assert(allChunks.length === 16, `16 chunks générés pour les 4 sermons`);

// 4. Test d'insertion (saveChunks)
const upsertStmt = testDb.prepare(`
  INSERT INTO sermon_chunks (
    chunk_id, sermon_id, paragraph_ids, start_paragraph, end_paragraph,
    text, sermon_title, date, city, version, character_count, word_count,
    content_hash, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(chunk_id) DO UPDATE SET
    sermon_id = excluded.sermon_id,
    paragraph_ids = excluded.paragraph_ids,
    start_paragraph = excluded.start_paragraph,
    end_paragraph = excluded.end_paragraph,
    text = excluded.text,
    sermon_title = excluded.sermon_title,
    date = excluded.date,
    city = excluded.city,
    version = excluded.version,
    character_count = excluded.character_count,
    word_count = excluded.word_count,
    content_hash = excluded.content_hash,
    updated_at = excluded.updated_at
`);

const insertAllTx = testDb.transaction((chunks) => {
  for (const c of chunks) {
    upsertStmt.run(
      c.chunkId,
      c.sermonId,
      JSON.stringify(c.paragraphIds),
      c.startParagraph,
      c.endParagraph,
      c.text,
      c.sermonTitle,
      c.date,
      c.city,
      c.version,
      c.characterCount,
      c.wordCount,
      c.contentHash,
      c.createdAt,
      c.updatedAt
    );
  }
});

insertAllTx(allChunks);

const countInDb = testDb.prepare('SELECT COUNT(*) as count FROM sermon_chunks').get().count;
assert(countInDb === 16, `16 chunks correctement insérés dans la table SQLite (${countInDb}/16)`);

// 5. Test de récupération par chunkId (getChunkById)
const sampleChunk = allChunks[0];
const retrievedRow = testDb.prepare('SELECT * FROM sermon_chunks WHERE chunk_id = ?').get(sampleChunk.chunkId);
assert(retrievedRow !== undefined, `getChunkById: Chunk retrouvé (${sampleChunk.chunkId})`);
assert(retrievedRow.sermon_id === sampleChunk.sermonId, `getChunkById: sermon_id conforme`);
assert(retrievedRow.content_hash === sampleChunk.contentHash, `getChunkById: content_hash conforme (${retrievedRow.content_hash})`);
assert(retrievedRow.text === sampleChunk.text, `getChunkById: texte intégral préservé`);
assert(retrievedRow.embedding === null, `getChunkById: embedding NULL par défaut (prêt pour Phase 2B.2)`);

// 6. Test de récupération par sermonId (getChunksBySermon)
const sermon1Chunks = testDb.prepare('SELECT * FROM sermon_chunks WHERE sermon_id = ? ORDER BY start_paragraph ASC').all('63-0324M');
assert(sermon1Chunks.length === 5, `getChunksBySermon: 5 chunks retournés pour 63-0324M`);
assert(sermon1Chunks[0].start_paragraph === 1, `getChunksBySermon: premier chunk commence au §1`);
assert(sermon1Chunks[sermon1Chunks.length - 1].end_paragraph === 5, `getChunksBySermon: dernier chunk se termine au §5`);

// 7. Test de détection de contentHash inchangé vs modifié
function detectChanges(incoming, existingMap) {
  let unchanged = 0;
  let changed = 0;
  let newOnes = 0;

  for (const inc of incoming) {
    const ex = existingMap.get(inc.chunkId);
    if (!ex) newOnes++;
    else if (ex.contentHash === inc.contentHash) unchanged++;
    else changed++;
  }
  return { unchanged, changed, newOnes };
}

const existingMap = new Map();
allChunks.forEach(c => existingMap.set(c.chunkId, c));

// Test idempotence : ré-insertion des mêmes chunks
const idempRes = detectChanges(allChunks, existingMap);
assert(idempRes.unchanged === 16 && idempRes.changed === 0 && idempRes.newOnes === 0, `Détection contentHash : 16/16 chunks inchangés détectés avec succès`);

// Test modification : modification d'un paragraphe dans un chunk
const modifiedChunk = {
  ...allChunks[0],
  text: allChunks[0].text + " [Texte révisé]",
  contentHash: computeChunkHash(allChunks[0].sermonId, allChunks[0].paragraphIds, allChunks[0].text + " [Texte révisé]")
};
const mixedIncoming = [modifiedChunk, ...allChunks.slice(1)];
const modRes = detectChanges(mixedIncoming, existingMap);
assert(modRes.changed === 1 && modRes.unchanged === 15, `Détection contentHash : 1 chunk modifié détecté (${modRes.changed}), 15 inchangés (${modRes.unchanged})`);

// 8. Test de suppression en cascade lors de la suppression d'un sermon
testDb.prepare('DELETE FROM sermons WHERE id = ?').run('65-1212');
const remainingChunksForDeletedSermon = testDb.prepare('SELECT COUNT(*) as count FROM sermon_chunks WHERE sermon_id = ?').get('65-1212').count;
assert(remainingChunksForDeletedSermon === 0, `Suppression cascade ON DELETE CASCADE opérationnelle sur sermon_chunks`);

testDb.close();

console.log("\n=================================================");
console.log(` RÉSULTATS : ${passed}/${total} TESTS PASSÉS AVEC SUCCÈS`);
console.log("=================================================");

if (passed !== total) {
  process.exit(1);
}
