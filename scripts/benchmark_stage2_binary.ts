import fs from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';
import { loadBinaryVectorStorage, getBinaryVectorForChunk, parseBinaryIndex } from '../services/binaryVectorStorageService';

async function main() {
  console.log("=====================================================================");
  console.log("  POINT 2 : STOCKAGE BINAIRE SANS JSON.PARSE MASSIF (KPI & METRIQUES)");
  console.log("=====================================================================\n");

  const binPath = 'public/corpus_vectors.bin';
  const idxPath = 'public/corpus_vectors.idx';
  const jsonIndexPath = 'public/corpus_vectors_index.json';

  const binStat = fs.statSync(binPath);
  const idxStat = fs.statSync(idxPath);
  const jsonStat = fs.statSync(jsonIndexPath);

  console.log("--- 1. TAILLES SUR DISQUE ---");
  console.log(`• corpus_vectors.bin (Vecteurs Int8 contigus) : ${(binStat.size / 1024).toFixed(1)} Ko (${binStat.size} octets)`);
  console.log(`• corpus_vectors.idx (Index binaire KSIX)    : ${(idxStat.size / 1024).toFixed(1)} Ko (${idxStat.size} octets)`);
  console.log(`• corpus_vectors_index.json (Ancien JSON)    : ${(jsonStat.size / 1024).toFixed(1)} Ko (${jsonStat.size} octets)`);
  console.log(`• Réduction de taille de l'index            : -${((1 - idxStat.size / jsonStat.size) * 100).toFixed(1)}%\n`);

  // Measure 1: Benchmark zero JSON.parse vs JSON.parse
  console.log("--- 2. TEMPS DE CHARGEMENT ET RAM ---");

  // A. Ancien mode JSON.parse
  if (global.gc) global.gc();
  const ram0Json = process.memoryUsage().heapUsed;
  const t0Json = performance.now();
  const rawJson = JSON.parse(fs.readFileSync(jsonIndexPath, 'utf8'));
  const jsonMap = new Map(rawJson.chunks.map((c: any) => [c.chunkId, c]));
  const t1Json = performance.now();
  const ram1Json = process.memoryUsage().heapUsed;
  const jsonLoadMs = t1Json - t0Json;
  const jsonRamKb = (ram1Json - ram0Json) / 1024;

  // B. Nouveau mode KSIX binaire (0 JSON.parse)
  if (global.gc) global.gc();
  const ram0Bin = process.memoryUsage().heapUsed;
  const t0Bin = performance.now();
  const idxBuf = fs.readFileSync(idxPath);
  const parsedIdx = parseBinaryIndex(idxBuf);
  const t1Bin = performance.now();
  const ram1Bin = process.memoryUsage().heapUsed;
  const binLoadMs = t1Bin - t0Bin;
  const binRamKb = Math.max(0, (ram1Bin - ram0Bin) / 1024);

  console.log(`• Ancien chargement via JSON.parse : ${jsonLoadMs.toFixed(2)} ms | RAM consommée : ~${jsonRamKb.toFixed(1)} Ko`);
  console.log(`• Nouveau chargement Binaire KSIX  : ${binLoadMs.toFixed(2)} ms | RAM consommée : ~${binRamKb.toFixed(1)} Ko`);
  console.log(`• Accélération du chargement       : ${(jsonLoadMs / Math.max(0.01, binLoadMs)).toFixed(1)}x plus rapide !\n`);

  // Measure 2: Storage service load
  console.log("--- 3. HYDRATATION EN MEMOIRE DE L'APPLICATION ---");
  const state = await loadBinaryVectorStorage({ forceReload: true });
  console.log(`• Statut de chargement                        : ${state.loaded ? '✓ SUCCÈS' : '❌ ÉCHEC'}`);
  console.log(`• Total vecteurs Int8 gérés                   : ${state.totalVectors}`);
  console.log(`• Format & Dimension                          : ${state.format.toUpperCase()} ${state.dimension}D`);
  console.log(`• Temps total d'hydratation buffer + index    : ${state.loadTimeMs.toFixed(2)} ms`);

  // Measure 3: Direct O(1) lookup
  const sampleChunkId = 'expose-ch-0_c1_p1_p1';
  const t0Lookup = performance.now();
  const vec = getBinaryVectorForChunk(sampleChunkId);
  const lookupMs = performance.now() - t0Lookup;
  console.log(`\n--- 4. ACCES DIRECT ZERO-COPY ---`);
  console.log(`• Recherche O(1) de '${sampleChunkId}' : ${lookupMs.toFixed(4)} ms`);
  console.log(`• Dimensions et type                         : ${vec?.length}D ${vec?.constructor.name}`);
  console.log(`• Extrait de 8 octets Int8                   : [${Array.from(vec?.slice(0, 8) || []).join(', ')}]`);
}

main().catch(err => {
  console.error("Erreur benchmark Étape 2:", err);
  process.exit(1);
});
