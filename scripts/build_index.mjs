#!/usr/bin/env node
/**
 * scripts/build_index.mjs
 * 
 * ÉTAPE 1 : Index Pré-calculé Complet (Chunks + Index BM25 + Vecteurs E5 384D Int8)
 * 
 * Construit un index pré-calculé complet du corpus de l'Exposé (corpus complet de référence) :
 * - Métadonnées de versioning strict (indexVersion, modelId, modelVersion, quantization, chunkingVersion, corpusHash).
 * - Chunks sémantiques complets avec identifiants pérennes et métadonnées.
 * - Index lexicale BM25 pré-calculé (DF, IDF, longueurs de documents, vocabulaire).
 * - Vecteurs d'embeddings E5 384D Int8 pré-calculés.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

export const INDEX_VERSION = '1.0.0';
export const MODEL_ID = 'Xenova/multilingual-e5-small';
export const MODEL_VERSION = '1.0.0';
export const QUANTIZATION = 'int8';
export const CHUNKING_VERSION = '1.0.0';

export function computeCorpusHash(files = [
  'public/expose.json',
  'public/bible-lsg1910.json',
  'public/bible-darby.json',
  'public/bible-kjv.json',
  'public/songs.json',
  'public/library.json'
]) {
  const hash = crypto.createHash('sha256');
  for (const rel of files) {
    const full = path.resolve(rootDir, rel);
    if (fs.existsSync(full)) {
      hash.update(fs.readFileSync(full));
    }
  }
  return hash.digest('hex');
}

export function tokenizeText(text) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2);
}

export async function buildIndex(options = {}) {
  const scope = options.scope || process.env.INDEX_SCOPE || 'all';
  const outputPath = options.outputPath || path.join(
    rootDir, 
    'public', 
    scope === 'all' ? 'precalculated_full_corpus_index.json' : 'precalculated_index.json'
  );

  console.log('================================================================================');
  console.log(`   CONSTRUCTION DE L\'INDEX PRÉ-CALCULÉ (ÉTAPE 1 - SCOPE: ${scope.toUpperCase()})`);
  console.log('================================================================================\n');

  const tStart = Date.now();

  // 1. Calcul du hash composite du corpus
  const corpusFiles = scope === 'all' 
    ? ['public/expose.json', 'public/bible-lsg1910.json', 'public/bible-darby.json', 'public/bible-kjv.json', 'public/songs.json', 'public/library.json']
    : ['public/expose.json'];
  const corpusHash = computeCorpusHash(corpusFiles);
  console.log(`[BUILD_INDEX] Hash SHA-256 du corpus (${scope}) : ${corpusHash.slice(0, 24)}...`);

  // 2. Découpage en chunks
  console.log('[BUILD_INDEX] Génération des chunks...');
  const { createExposeDocumentChunks } = await import('../services/exposeDocumentService.ts');
  const exposeChunks = await createExposeDocumentChunks({ forceCanonical: true });
  console.log(`[BUILD_INDEX] ✓ Exposé : ${exposeChunks.length} chunks.`);

  let rawChunks = exposeChunks;

  if (scope === 'all') {
    const { createBibleDocumentChunks } = await import('../services/bibleDocumentService.ts');
    const { createSongDocumentChunks } = await import('../services/songDocumentService.ts');
    const { ensureFullBibleLoaded } = await import('../services/bibleService.ts');
    const { BIBLE_BOOKS_META } = await import('../services/bibleMetadata.ts');

    const bibleLsgChunks = await createBibleDocumentChunks();
    console.log(`[BUILD_INDEX] ✓ Bible LSG : ${bibleLsgChunks.length} chunks.`);

    const songChunks = await createSongDocumentChunks();
    console.log(`[BUILD_INDEX] ✓ Chants : ${songChunks.length} chunks.`);

    // Darby
    const darbyData = await ensureFullBibleLoaded('darby');
    const darbyChunks = [];
    if (darbyData) {
      for (const meta of BIBLE_BOOKS_META) {
        const bookData = darbyData[meta.id];
        if (!bookData) continue;
        const chapters = Object.keys(bookData).map(k => parseInt(k, 10)).sort((a,b) => a - b);
        for (const ch of chapters) {
          const verses = bookData[ch];
          if (!Array.isArray(verses) || verses.length === 0) continue;
          let pIdx = 0;
          let cCount = 1;
          while (pIdx < verses.length) {
            const group = [];
            let currentLen = 0;
            while (pIdx + group.length < verses.length) {
              const v = verses[pIdx + group.length];
              const vText = `${v.verse}. ${v.text.trim()}`;
              const added = currentLen === 0 ? vText.length : currentLen + 2 + vText.length;
              if (group.length > 0 && (added > 600 || group.length >= 4)) break;
              group.push({ ...v, fullText: vText });
              currentLen = added;
            }
            if (group.length === 0) group.push({ ...verses[pIdx], fullText: `${verses[pIdx].verse}. ${verses[pIdx].text}` });
            const text = group.map(g => g.fullText).join('\n\n');
            const vStart = group[0].verse;
            const vEnd = group[group.length - 1].verse;
            const ref = vStart === vEnd ? `${meta.name} ${ch}:${vStart}` : `${meta.name} ${ch}:${vStart}-${vEnd}`;
            darbyChunks.push({
              chunkId: `bible-darby-${meta.id}-${ch}-c${cCount++}`,
              sermonId: `bible-darby-${meta.id}-${ch}`,
              documentType: 'bible',
              title: `${meta.name} ${ch}`,
              author: 'Bible (Darby FR)',
              year: 1890,
              text,
              startParagraphIndex: vStart,
              endParagraphIndex: vEnd,
              paragraphIds: group.map(g => `v${g.verse}`),
              citationRef: `[Réf: ${ref} (Darby)]`,
              createdAt: new Date().toISOString()
            });
            pIdx += group.length;
          }
        }
      }
    }
    console.log(`[BUILD_INDEX] ✓ Bible Darby : ${darbyChunks.length} chunks.`);

    // KJV
    const kjvData = await ensureFullBibleLoaded('kjv');
    const kjvChunks = [];
    if (kjvData) {
      for (const meta of BIBLE_BOOKS_META) {
        const bookData = kjvData[meta.id];
        if (!bookData) continue;
        const chapters = Object.keys(bookData).map(k => parseInt(k, 10)).sort((a,b) => a - b);
        for (const ch of chapters) {
          const verses = bookData[ch];
          if (!Array.isArray(verses) || verses.length === 0) continue;
          let pIdx = 0;
          let cCount = 1;
          while (pIdx < verses.length) {
            const group = [];
            let currentLen = 0;
            while (pIdx + group.length < verses.length) {
              const v = verses[pIdx + group.length];
              const vText = `${v.verse}. ${v.text.trim()}`;
              const added = currentLen === 0 ? vText.length : currentLen + 2 + vText.length;
              if (group.length > 0 && (added > 600 || group.length >= 4)) break;
              group.push({ ...v, fullText: vText });
              currentLen = added;
            }
            if (group.length === 0) group.push({ ...verses[pIdx], fullText: `${verses[pIdx].verse}. ${verses[pIdx].text}` });
            const text = group.map(g => g.fullText).join('\n\n');
            const vStart = group[0].verse;
            const vEnd = group[group.length - 1].verse;
            const ref = vStart === vEnd ? `${meta.name} ${ch}:${vStart}` : `${meta.name} ${ch}:${vStart}-${vEnd}`;
            kjvChunks.push({
              chunkId: `bible-kjv-${meta.id}-${ch}-c${cCount++}`,
              sermonId: `bible-kjv-${meta.id}-${ch}`,
              documentType: 'bible',
              title: `${meta.name} ${ch}`,
              author: 'Bible (KJV 1611)',
              year: 1611,
              text,
              startParagraphIndex: vStart,
              endParagraphIndex: vEnd,
              paragraphIds: group.map(g => `v${g.verse}`),
              citationRef: `[Réf: ${ref} (KJV)]`,
              createdAt: new Date().toISOString()
            });
            pIdx += group.length;
          }
        }
      }
    }
    console.log(`[BUILD_INDEX] ✓ Bible KJV : ${kjvChunks.length} chunks.`);

    // Sermons locaux (library.json)
    const libPath = path.resolve(rootDir, 'public', 'library.json');
    const lib = fs.existsSync(libPath) ? JSON.parse(fs.readFileSync(libPath, 'utf8')) : [];
    const sermonChunks = lib.map(s => ({
      chunkId: `sermon-${s.id}-c1`,
      sermonId: s.id,
      documentType: 'sermon',
      title: s.title,
      author: 'William Marrion Branham',
      year: parseInt((s.date || '').split('-')[0], 10) || 1965,
      text: (s.text || '').trim(),
      startParagraphIndex: 1,
      endParagraphIndex: 1,
      paragraphIds: ['p1'],
      citationRef: `[${s.id}]`,
      createdAt: new Date().toISOString()
    }));
    console.log(`[BUILD_INDEX] ✓ Sermons library.json : ${sermonChunks.length} chunks.`);

    rawChunks = [
      ...exposeChunks,
      ...bibleLsgChunks,
      ...songChunks,
      ...darbyChunks,
      ...kjvChunks,
      ...sermonChunks
    ];
  }

  console.log(`[BUILD_INDEX] TOTAL CHUNKS : ${rawChunks.length}.`);

  // 3. Indexation BM25
  console.log('[BUILD_INDEX] Construction de l\'index lexical BM25...');
  const docFrequency = {};
  const docLengths = {};
  let totalTokens = 0;

  for (const c of rawChunks) {
    const tokens = tokenizeText(c.text);
    docLengths[c.chunkId] = tokens.length;
    totalTokens += tokens.length;
    const unique = new Set(tokens);
    for (const term of unique) {
      docFrequency[term] = (docFrequency[term] || 0) + 1;
    }
  }

  const totalDocs = rawChunks.length;
  const avgDocLength = Math.round((totalTokens / totalDocs) * 100) / 100;
  const terms = {};

  for (const [term, df] of Object.entries(docFrequency)) {
    const idf = Math.max(0, Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5)));
    terms[term] = {
      df,
      idf: Math.round(idf * 1000) / 1000
    };
  }
  console.log(`[BUILD_INDEX] ✓ Index BM25 : ${Object.keys(terms).length} termes uniques (longueur moyenne : ${avgDocLength} mots).`);

  // 4. Récupération / Calcul des vecteurs E5 384D Int8
  console.log('[BUILD_INDEX] Récupération des vecteurs 384D Int8 existants...');
  const binPath = path.join(rootDir, 'public', 'corpus_embeddings_384d.bin');
  const metaPath = path.join(rootDir, 'public', 'corpus_embeddings_384d_meta.json');
  
  const vectors = {};
  const vectorItems = [];
  let vectorsLoaded = 0;

  if (fs.existsSync(binPath) && fs.existsSync(metaPath)) {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const binBuffer = fs.readFileSync(binPath);

    // Préparation de la liste des vecteurs pour écriture binaire (Étape 2)
    for (const item of meta.chunks) {
      if (item.length === 384) {
        const int8Array = new Int8Array(binBuffer.buffer, binBuffer.byteOffset + item.offset, item.length);
        vectorItems.push({
          chunkId: item.chunkId,
          vector: int8Array
        });
        vectors[item.chunkId] = int8Array;
        vectorsLoaded++;
      }
    }
    console.log(`[BUILD_INDEX] ✓ ${vectorsLoaded} vecteurs Int8 collectés pour le stockage binaire.`);
  }

  // Si des vecteurs manquent, on les calcule si explicitement demandé (sinon stockés dans l'Étape 4 en background)
  const shouldComputeMissing = options.computeMissingVectors || process.env.COMPUTE_MISSING_VECTORS === 'true';
  if (vectorsLoaded < rawChunks.length && shouldComputeMissing) {
    const missingChunks = rawChunks.filter(c => !vectors[c.chunkId]);
    console.log(`[BUILD_INDEX] Calcul local des ${missingChunks.length} vecteurs manquants par lots de 8 sans tri (Étape 3)...`);
    const { getE5Extractor, quantizeToInt8 } = await import('../services/embeddingService.ts');
    const extractor = await getE5Extractor();
    const batchSize = 8;
    for (let i = 0; i < missingChunks.length; i += batchSize) {
      const batch = missingChunks.slice(i, i + batchSize);
      for (const c of batch) {
        const formatted = `passage: ${c.text}`;
        const output = await extractor(formatted, { pooling: 'mean', normalize: true });
        const int8Vec = quantizeToInt8(output.data);
        vectors[c.chunkId] = int8Vec;
        vectorItems.push({
          chunkId: c.chunkId,
          vector: int8Vec
        });
      }
    }
  } else if (vectorsLoaded < rawChunks.length) {
    console.log(`[BUILD_INDEX] ℹ ${vectorsLoaded} vecteurs pré-calculés associés (les vecteurs restants relèvent du Worker Étape 4).`);
  }

  // 5. Écriture Binaire des Vecteurs (Étape 2 : Pas de JSON pour les vecteurs)
  const binaryVecPath = path.join(rootDir, 'public', 'corpus_vectors.bin');
  const indexVecPath = path.join(rootDir, 'public', 'corpus_vectors_index.json');
  console.log('[BUILD_INDEX] Écriture des vecteurs dans le conteneur binaire...');
  
  const { writeBinaryVectorFiles } = await import('../services/binaryVectorStorageService.ts');
  const binResult = writeBinaryVectorFiles(
    binaryVecPath,
    indexVecPath,
    vectorItems,
    {
      modelId: MODEL_ID,
      dimension: 384,
      quantization: QUANTIZATION
    }
  );
  console.log(`[BUILD_INDEX] ✓ Vecteurs binaires écrits : ${binResult.binaryBytes} octets (${(binResult.binaryBytes/1024).toFixed(1)} Ko) dans ${path.basename(binaryVecPath)}`);
  console.log(`[BUILD_INDEX] ✓ Index des offsets écrit : ${binResult.indexBytes} octets dans ${path.basename(indexVecPath)}`);

  // 6. Structure de l'Index Allégé (ZÉRO VECTEUR DANS LE JSON)
  const fullIndex = {
    metadata: {
      indexVersion: INDEX_VERSION,
      modelId: MODEL_ID,
      modelVersion: MODEL_VERSION,
      quantization: QUANTIZATION,
      chunkingVersion: CHUNKING_VERSION,
      corpusHash,
      totalChunks: rawChunks.length,
      dimension: 384,
      vectorStorageFormat: 'binary_int8',
      generatedAt: new Date().toISOString()
    },
    vectorStorage: {
      binaryFile: path.basename(binaryVecPath),
      indexFile: path.basename(indexVecPath),
      format: QUANTIZATION,
      dimension: 384,
      totalVectors: binResult.totalVectors
    },
    bm25: {
      vocabSize: Object.keys(terms).length,
      avgDocLength,
      totalDocs,
      terms,
      docLengths
    },
    chunks: rawChunks.map(c => ({
      chunkId: c.chunkId,
      sermonId: c.sermonId,
      documentId: c.documentId,
      documentType: c.documentType,
      paragraphIds: c.paragraphIds,
      startParagraph: c.startParagraph,
      endParagraph: c.endParagraph,
      text: c.text,
      sermonTitle: c.sermonTitle,
      chapterTitle: c.chapterTitle,
      chapterNumber: c.chapterNumber,
      sectionTitle: c.sectionTitle,
      date: c.date,
      city: c.city,
      version: c.version,
      characterCount: c.characterCount,
      wordCount: c.wordCount,
      contentHash: c.contentHash,
      metadata: c.metadata
    }))
    // REMARQUE ÉTAPE 2 : vectors supprimé du JSON (remplacé par binaryFile zero-copy)
  };

  // 7. Écriture du fichier sur disque
  const serialized = JSON.stringify(fullIndex);
  fs.writeFileSync(outputPath, serialized, 'utf8');

  const stats = fs.statSync(outputPath);
  const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);
  const elapsed = ((Date.now() - tStart) / 1000).toFixed(2);

  console.log('\n================================================================================');
  console.log('   RÉSUMÉ ÉTAPE 2 : STOCKAGE BINAIRE & INDEX PRÉ-CALCULÉ');
  console.log('================================================================================');
  console.log(`• Fichier JSON index   : ${outputPath}`);
  console.log(`• Taille JSON allégé   : ${sizeMb} Mo (${stats.size} octets) [ZÉRO VECTEUR EN JSON]`);
  console.log(`• Fichier binaire .bin : ${binaryVecPath} (${(binResult.binaryBytes/1024).toFixed(1)} Ko)`);
  console.log(`• Fichier offsets JSON : ${indexVecPath} (${(binResult.indexBytes/1024).toFixed(1)} Ko)`);
  console.log(`• Total chunks         : ${rawChunks.length}`);
  console.log(`• Vocabulaire BM25     : ${Object.keys(terms).length} termes`);
  console.log(`• Vecteurs Int8 (384D) : ${binResult.totalVectors} vecteurs en buffer binaire`);
  console.log(`• Version Index        : ${INDEX_VERSION}`);
  console.log(`• Version Modèle       : ${MODEL_VERSION}`);
  console.log(`• Quantification       : ${QUANTIZATION}`);
  console.log(`• Version Chunking     : ${CHUNKING_VERSION}`);
  console.log(`• Hash du corpus       : ${corpusHash.slice(0, 16)}...`);
  console.log(`• Temps d'exécution    : ${elapsed} s`);
  console.log('================================================================================\n');

  return {
    outputPath,
    sizeBytes: stats.size,
    sizeMb,
    totalChunks: rawChunks.length,
    vocabSize: Object.keys(terms).length,
    elapsed
  };
}

if (process.argv[1] && process.argv[1].endsWith('build_index.mjs')) {
  buildIndex().catch(err => {
    console.error('[BUILD_INDEX] Erreur fatale :', err);
    process.exit(1);
  });
}
