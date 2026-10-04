/**
 * King's Sword — Validation Minimale du Modèle d'Embedding et de la Sérialisation SQLite (Phase 2B.2)
 * 
 * Valide le modèle 'gemini-embedding-2-preview', la conversion binaire Float32Array <-> BLOB
 * et l'aller-retour d'intégrité en base SQLite sur un échantillon strict de 4 chunks.
 */

import { GoogleGenAI } from '@google/genai';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log("=================================================");
console.log(" 🧠 VALIDATION DU MODÈLE D'EMBEDDING ET DE SQLITE (PHASE 2B.2)");
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

// 1. Clé API et initialisation SDK @google/genai
const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
assert(apiKey !== undefined && apiKey.length > 10, "Clé API Gemini disponible dans l'environnement");

const ai = new GoogleGenAI({ apiKey });
const EMBEDDING_MODEL = 'gemini-embedding-2-preview';

// 2. Fonctions de conversion binaire (Float32Array <-> BLOB Buffer)
function vectorToBlob(vector) {
  const float32 = vector instanceof Float32Array ? vector : new Float32Array(vector);
  return Buffer.from(float32.buffer, float32.byteOffset, float32.byteLength);
}

function blobToVector(buffer) {
  if (!buffer || buffer.length === 0) return [];
  const float32 = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4);
  return Array.from(float32);
}

function cosineSimilarity(vecA, vecB) {
  let dot = 0, nA = 0, nB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    nA += vecA[i] * vecA[i];
    nB += vecB[i] * vecB[i];
  }
  return dot / (Math.sqrt(nA) * Math.sqrt(nB));
}

// 3. Extraction d'exactement 4 chunks (1 par sermon du corpus de développement)
const library = JSON.parse(fs.readFileSync(path.join(rootDir, 'public', 'library.json'), 'utf8'));
assert(library.length === 4, `Corpus chargé (${library.length} sermons)`);

const testChunks = [
  {
    chunkId: "63-0324M_c1_p1_p2",
    sermonId: "63-0324M",
    paragraphIds: [1, 2],
    startParagraph: 1,
    endParagraph: 2,
    sermonTitle: "Questions Et Réponses Sur Les Sceaux",
    date: "1963-03-24",
    city: "Jeffersonville",
    version: "VGR",
    text: "Le premier sceau a été ouvert, et nous avons clairement vu que le cavalier sur le cheval blanc n'était pas le Seigneur Jésus-Christ, mais bien l'antichrist imitant le Véritable. Il portait un arc, mais n'avait aucune flèche. C'est le grand bluff religieux du temps de la fin."
  },
  {
    chunkId: "65-1212_c1_p1_p2",
    sermonId: "65-1212",
    paragraphIds: [1, 2],
    startParagraph: 1,
    endParagraph: 2,
    sermonTitle: "La Communion",
    date: "1965-12-12",
    city: "Tucson",
    version: "Shp",
    text: "La communion n'est pas simplement manger un morceau de pain sans levain et boire un peu de jus de cep. C'est une union spirituelle profonde et vivante entre le croyant racheté et son Seigneur glorieux. Si vous ne mangez la chair du Fils de l'homme, et si vous ne buvez son sang, vous n'avez point la vie en vous-mêmes."
  },
  {
    chunkId: "64-0719M_c1_p2_p3",
    sermonId: "64-0719M",
    paragraphIds: [2, 3],
    startParagraph: 2,
    endParagraph: 3,
    sermonTitle: "La Fête Des Trompettes",
    date: "1964-07-19",
    city: "Jeffersonville",
    version: "VGR",
    text: "Entre la Sixième et la Septième Trompette se trouve le rassemblement des cent quarante-quatre mille Juifs scellés par le ministère des deux témoins prophétiques d'Apocalypse 11. Le figuier a repoussé ses feuilles, la nation d'Israël est érigée, le drapeau à l'étoile de David flotte à Jérusalem."
  },
  {
    chunkId: "65-0725M_c1_p2_p3",
    sermonId: "65-0725M",
    paragraphIds: [2, 3],
    startParagraph: 2,
    endParagraph: 3,
    sermonTitle: "Les Oints Du Temps De La Fin",
    date: "1965-07-25",
    city: "Jeffersonville",
    version: "VGR",
    text: "Car il s'élèvera de faux Christs et de faux prophètes; ils feront de grands prodiges et des miracles, au point de séduire, s'il était possible, même les élus. Mais bien que l'esprit extérieur soit oint, leur âme intérieure n'est pas née de la Semence incorruptible de la Parole."
  }
];

assert(testChunks.length === 4, "Échantillon de test configuré : exactement 4 chunks");

async function runValidation() {
  // 4. Génération réelle des embeddings
  console.log(`\nAppel de l'API Gemini pour ${testChunks.length} chunks via ${EMBEDDING_MODEL}...`);
  const embeddedChunks = [];

  for (const c of testChunks) {
    const t0 = performance.now();
    const res = await ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: c.text
    });
    const latency = Math.round(performance.now() - t0);

    const vector = res.embeddings?.[0]?.values || res.embedding?.values;
    assert(Array.isArray(vector) && vector.length > 0, `Chunk ${c.chunkId} : Vecteur reçu avec succès (${latency} ms)`);
    assert(vector.length === 3072, `Chunk ${c.chunkId} : Dimension = ${vector.length} (attendu 3072)`);

    // Vérification de l'absence de NaN ou Infinity
    const allFinite = vector.every(v => typeof v === 'number' && Number.isFinite(v) && !Number.isNaN(v));
    assert(allFinite, `Chunk ${c.chunkId} : Tous les 3072 scalaires sont des nombres finis valides`);

    embeddedChunks.push({
      ...c,
      vector,
      latency
    });
  }

  // 5. Test de conversion binaire (Float32Array <-> BLOB)
  console.log("\nValidation de la conversion binaire Float32Array <-> BLOB...");
  embeddedChunks.forEach(c => {
    const blob = vectorToBlob(c.vector);
    assert(blob.length === 3072 * 4, `Chunk ${c.chunkId} : BLOB binaire = ${blob.length} octets (12 Ko)`);

    const restoredVector = blobToVector(blob);
    assert(restoredVector.length === 3072, `Chunk ${c.chunkId} : Vecteur restauré = ${restoredVector.length} dimensions`);

    // Calcul de l'erreur absolue maximale (tolérance numérique Float32)
    let maxDelta = 0;
    for (let i = 0; i < c.vector.length; i++) {
      const delta = Math.abs(c.vector[i] - restoredVector[i]);
      if (delta > maxDelta) maxDelta = delta;
    }
    assert(maxDelta < 1e-6, `Chunk ${c.chunkId} : Fidélité binaire parfaite (erreur max: ${maxDelta.toExponential(2)})`);
  });

  // 6. Test d'insertion et de relecture en base SQLite réelle
  console.log("\nValidation de l'aller-retour SQLite (stockage et relecture BLOB)...");
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sermon_chunks (
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
      updated_at TEXT
    );
  `);

  const insertStmt = db.prepare(`
    INSERT INTO sermon_chunks (
      chunk_id, sermon_id, paragraph_ids, start_paragraph, end_paragraph,
      text, sermon_title, date, city, version, character_count, word_count,
      content_hash, embedding, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const now = new Date().toISOString();
  embeddedChunks.forEach(c => {
    const blob = vectorToBlob(c.vector);
    insertStmt.run(
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
      c.text.length,
      c.text.split(/\s+/).length,
      `hash_${c.chunkId}`,
      blob,
      now,
      now
    );
  });

  const count = db.prepare('SELECT COUNT(*) as c FROM sermon_chunks WHERE embedding IS NOT NULL').get().c;
  assert(count === 4, `SQLite : 4 embeddings stockés sous forme de BLOB (${count}/4)`);

  // Relecture depuis SQLite et comparaison avec les vecteurs originaux
  embeddedChunks.forEach(c => {
    const row = db.prepare('SELECT * FROM sermon_chunks WHERE chunk_id = ?').get(c.chunkId);
    assert(row !== undefined, `SQLite : Enregistrement ${c.chunkId} retrouvé`);
    assert(Buffer.isBuffer(row.embedding) && row.embedding.length === 3072 * 4, `SQLite : Colonne embedding est un BLOB de 12 288 octets`);

    const readVector = blobToVector(row.embedding);
    assert(readVector.length === 3072, `SQLite : Vecteur relu de 3072 dimensions`);

    let maxDiff = 0;
    for (let i = 0; i < c.vector.length; i++) {
      const diff = Math.abs(c.vector[i] - readVector[i]);
      if (diff > maxDiff) maxDiff = diff;
    }
    assert(maxDiff < 1e-6, `SQLite : Intégrité totale aller-retour vérifiée (diff max = ${maxDiff.toExponential(2)})`);
  });

  // 7. Vérification de la cohérence sémantique par similarité cosinus
  console.log("\nVérification de la géométrie sémantique (similarité cosinus)...");
  const simSelf = cosineSimilarity(embeddedChunks[0].vector, embeddedChunks[0].vector);
  assert(Math.abs(simSelf - 1.0) < 1e-5, `Similarité d'un vecteur avec lui-même = ${simSelf.toFixed(4)} (attendu 1.0)`);

  const simDiff = cosineSimilarity(embeddedChunks[0].vector, embeddedChunks[1].vector);
  assert(simDiff < 0.90 && simDiff > 0.10, `Similarité entre deux sermons distincts = ${simDiff.toFixed(4)} (espace bien séparé)`);

  db.close();

  console.log("\n=================================================");
  console.log(` RÉSULTATS : ${passed}/${total} TESTS PASSÉS AVEC SUCCÈS`);
  console.log("=================================================");

  if (passed !== total) {
    process.exit(1);
  }
}

runValidation().catch(err => {
  console.error("Erreur durant la validation d'embedding :", err);
  process.exit(1);
});
