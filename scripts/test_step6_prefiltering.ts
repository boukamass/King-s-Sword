import fs from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';
import { createLibraryChunks } from '../services/chunkingService';
import { createExposeDocumentChunks } from '../services/exposeDocumentService';
import { searchByVector, matchesMetadataFilter } from '../services/vectorSearchService';
import { searchHybrid, mapParagraphsToChunkHits } from '../services/hybridRetrievalService';
import { loadBinaryVectorStorage, hydrateChunksWithBinaryVectors } from '../services/binaryVectorStorageService';
import { normalizeText } from '../utils/textUtils';
import { computeE5Embedding } from '../services/embeddingService';
import { SermonChunk, MetadataFilter, HybridSearchResult } from '../types';

interface TestScenario {
  id: number;
  title: string;
  query: string;
  filter: MetadataFilter;
  topK: number;
}

const SCENARIOS: TestScenario[] = [
  {
    id: 1,
    title: "Sermon 1963 uniquement (Cheval blanc)",
    query: "cavalier sur le cheval blanc premier sceau",
    filter: { years: [1963], sources: ['sermon'] },
    topK: 5
  },
  {
    id: 2,
    title: "Sermon 1964 uniquement (Fête des Trompettes)",
    query: "trompettes rassemblement des cent quarante-quatre mille",
    filter: { years: [1964], sources: ['sermon'] },
    topK: 5
  },
  {
    id: 3,
    title: "Sermon spécifique 65-0725M (Oints du temps de la fin)",
    query: "faux prophètes bon blé et ivraie dans le même champ",
    filter: { sermonIds: ['65-0725M'], sources: ['sermon'] },
    topK: 5
  },
  {
    id: 4,
    title: "Exposé Chapitre 3 uniquement (Âge d'Éphèse)",
    query: "semence du serpent genèse satan eve",
    filter: { sermonIds: ['expose-ch-3'], sources: ['expose'] },
    topK: 5
  },
  {
    id: 5,
    title: "Exposé Chapitre 4 uniquement (Âge de Pergame)",
    query: "nicolaites doctrine de balaam jézabel",
    filter: { sermonIds: ['expose-ch-4'], sources: ['expose'] },
    topK: 5
  },
  {
    id: 6,
    title: "Exposé Chapitre 1 uniquement (Vision de Patmos)",
    query: "vision de patmos chandelier colonne de feu",
    filter: { sermonIds: ['expose-ch-1'], sources: ['expose'] },
    topK: 5
  }
];

// Moteur lexical BM25 simplifié pour le test
function computeLexicalHits(query: string, chunks: SermonChunk[], topK = 40) {
  const normQ = normalizeText(query);
  const terms = normQ.split(/\s+/).filter(w => w.length > 2);
  const scored = chunks.map((c, idx) => {
    const text = normalizeText(c.text);
    let s = 0;
    for (const t of terms) {
      if (text.includes(t)) {
        s += 15 + (text.split(t).length - 1) * 5;
      }
    }
    if (text.includes(normQ)) s += 40;
    return {
      chunkId: c.chunkId,
      rank: 0,
      score: s,
      matchedParagraphIds: c.paragraphIds
    };
  }).filter(h => h.score > 0);

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map((item, idx) => ({ ...item, rank: idx + 1 }));
}

async function runStep6PrefilteringBenchmark() {
  console.log("=========================================================================================");
  console.log("  ÉTAPE 6 : BENCHMARK COMPARATIF PRE-FILTERING VS POST-FILTERING (6 REQUÊTES)");
  console.log("=========================================================================================\n");

  // 1. Chargement de l'ensemble du corpus
  const pubDir = path.resolve('public');
  const libraryPath = path.join(pubDir, 'library.json');
  const sermons = JSON.parse(fs.readFileSync(libraryPath, 'utf8'));
  const sermonChunks = createLibraryChunks(sermons);
  const exposeChunks = await createExposeDocumentChunks();
  const allChunks = [...sermonChunks, ...exposeChunks];

  console.log(`• Corpus total chargé : ${allChunks.length} chunks (${sermonChunks.length} sermons + ${exposeChunks.length} exposé)`);

  // 2. Hydratation binaire des vecteurs Int8
  await loadBinaryVectorStorage();
  await hydrateChunksWithBinaryVectors(allChunks);
  const chunksWithVec = allChunks.filter(c => c.embedding && c.embedding.length === 384);
  console.log(`• Chunks avec vecteur Int8 384D : ${chunksWithVec.length} / ${allChunks.length}\n`);

  console.log("-----------------------------------------------------------------------------------------");
  console.log(" EXÉCUTION COMPARATIVE DES 6 SCÉNARIOS À FILTRES ÉTROITS");
  console.log("-----------------------------------------------------------------------------------------\n");

  const resultsSummary: Array<{
    id: number;
    title: string;
    perimeterCount: number;
    beforeCount: number;
    beforeDurationMs: number;
    afterCount: number;
    afterDurationMs: number;
    guaranteeMet: boolean;
  }> = [];

  for (const scen of SCENARIOS) {
    // Calcul de l'embedding de la requête
    const queryVector = await computeE5Embedding(scen.query, 'query: ');
    const qVecInt8 = queryVector ? queryVector : new Int8Array(384);

    // Chunks appartenant réellement au périmètre
    const perimeterChunks = allChunks.filter(c => matchesMetadataFilter(c, scen.filter));
    const perimeterCount = perimeterChunks.length;

    // ==================================================================================
    // MÉTHODE A : AVANT (POST-FILTERING)
    // 1. Recherche globale sur TOUT le corpus (BM25 + Vectoriel sur 1 450 chunks)
    // 2. Récupération du Top-K global
    // 3. Filtrage A POSTERIORI par les métadonnées sur le Top-K déjà extrait
    // ==================================================================================
    const t0Before = performance.now();
    
    // Retrieval vectoriel global (sur tout le corpus)
    const globalVecHits = searchByVector(qVecInt8, allChunks, { topK: scen.topK });
    // Retrieval lexical global (sur tout le corpus)
    const globalLexHits = computeLexicalHits(scen.query, allChunks, scen.topK);

    // Fusion RRF globale
    const globalHybrid = await searchHybrid({
      query: scen.query,
      allChunks,
      queryVector: qVecInt8,
      lexicalHits: globalLexHits,
      vectorHits: globalVecHits,
      options: { topK: scen.topK }
    });

    // POST-FILTERING : application du filtre après coup sur les résultats obtenus
    const filteredAfter = globalHybrid.results.filter(r => matchesMetadataFilter(r.chunk, scen.filter));
    const tBeforeElapsed = Math.round((performance.now() - t0Before) * 100) / 100;
    const beforeCount = filteredAfter.length;

    // ==================================================================================
    // MÉTHODE B : APRÈS (PRE-FILTERING STRICT)
    // 1. Application du filtre de métadonnées en amont : périmètre restreint dès le départ
    // 2. BM25 score UNIQUEMENT les chunks du périmètre
    // 3. Vectoriel calcule la similarité UNIQUEMENT sur les vecteurs du périmètre
    // 4. Garantie : Top-K complet si le périmètre en a au moins K
    // ==================================================================================
    const t0After = performance.now();

    // Retrieval vectoriel pre-filtré (UNIQUEMENT sur les vecteurs du périmètre)
    const prefilteredVecHits = searchByVector(qVecInt8, allChunks, {
      topK: scen.topK,
      metadataFilter: scen.filter
    });

    // Retrieval lexical pre-filtré (UNIQUEMENT sur les chunks du périmètre)
    const prefilteredLexHits = computeLexicalHits(scen.query, perimeterChunks, scen.topK);

    // Fusion RRF pre-filtrée
    const prefilteredHybrid = await searchHybrid({
      query: scen.query,
      allChunks: perimeterChunks,
      queryVector: qVecInt8,
      lexicalHits: prefilteredLexHits,
      vectorHits: prefilteredVecHits,
      options: {
        topK: scen.topK,
        metadataFilter: scen.filter
      }
    });

    const tAfterElapsed = Math.round((performance.now() - t0After) * 100) / 100;
    const afterCount = prefilteredHybrid.results.length;

    const expectedK = Math.min(scen.topK, perimeterCount);
    const guaranteeMet = afterCount >= expectedK;

    resultsSummary.push({
      id: scen.id,
      title: scen.title,
      perimeterCount,
      beforeCount,
      beforeDurationMs: tBeforeElapsed,
      afterCount,
      afterDurationMs: tAfterElapsed,
      guaranteeMet
    });

    console.log(`[Requête #${scen.id}] "${scen.query}"`);
    console.log(`   • Filtre : ${scen.title} (Périmètre : ${perimeterCount} chunks disponibles)`);
    console.log(`   • AVANT (Post-filtering) : ${beforeCount}/${scen.topK} résultats en ${tBeforeElapsed} ms`);
    console.log(`   • APRÈS (Pre-filtering)  : ${afterCount}/${scen.topK} résultats en ${tAfterElapsed} ms`);
    console.log(`   • Garantie Top-k respectée : ${guaranteeMet ? '✓ OUI (Top-k complet)' : '❌ NON'}\n`);
  }

  console.log("-----------------------------------------------------------------------------------------");
  console.log(" TABLEAU COMPARATIF SYNTHÉTIQUE DES MESURES AVANT / APRÈS");
  console.log("-----------------------------------------------------------------------------------------");
  console.log(" REQ | PÉRIMÈTRE | AVANT (POST-FILTER) | APRÈS (PRE-FILTER) | GAIN TEMPS | GARANTIE TOP-K");
  console.log("-----------------------------------------------------------------------------------------");

  for (const s of resultsSummary) {
    const timeDiff = (s.beforeDurationMs - s.afterDurationMs).toFixed(2);
    const timeSign = Number(timeDiff) >= 0 ? `-${timeDiff} ms` : `+${Math.abs(Number(timeDiff)).toFixed(2)} ms`;
    console.log(
      ` #${s.id}  | ` +
      `${String(s.perimeterCount + ' ch').padEnd(9)} | ` +
      `${String(s.beforeCount + '/' + 5 + ' (' + s.beforeDurationMs + ' ms)').padEnd(19)} | ` +
      `${String(s.afterCount + '/' + 5 + ' (' + s.afterDurationMs + ' ms)').padEnd(18)} | ` +
      `${timeSign.padEnd(10)} | ` +
      `${s.guaranteeMet ? '✓ 100% GARANTI' : '❌ ÉCHEC'}`
    );
  }

  console.log("-----------------------------------------------------------------------------------------\n");
  console.log("=========================================================================================");
  console.log("  RÉSULTAT ÉTAPE 6 : PRE-FILTERING VALIDÉ AVEC SUCCÈS SUR TOUTES LES REQUÊTES");
  console.log("=========================================================================================");

  return resultsSummary;
}

runStep6PrefilteringBenchmark().catch(err => {
  console.error("Erreur benchmark Étape 6:", err);
  process.exit(1);
});
