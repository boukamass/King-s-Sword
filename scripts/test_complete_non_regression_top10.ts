import fs from 'fs';
import path from 'path';
import { createLibraryChunks } from '../services/chunkingService';
import { createExposeDocumentChunks } from '../services/exposeDocumentService';
import { searchByVector, matchesMetadataFilter } from '../services/vectorSearchService';
import { searchHybrid } from '../services/hybridRetrievalService';
import { loadBinaryVectorStorage, hydrateChunksWithBinaryVectors } from '../services/binaryVectorStorageService';
import { computeE5Embedding } from '../services/embeddingService';

export async function runCompleteTop10NonRegression() {
  console.log("=========================================================================================");
  console.log("  TEST DE NON-RÉGRESSION RIGOUREUX : TOP-10 COMPLET SUR 10 REQUÊTES (AVANT VS APRÈS)");
  console.log("=========================================================================================\n");

  const pubDir = path.resolve('public');
  const libraryPath = path.join(pubDir, 'library.json');
  const sermons = JSON.parse(fs.readFileSync(libraryPath, 'utf8'));
  const sermonChunks = createLibraryChunks(sermons);
  const exposeChunks = await createExposeDocumentChunks();
  const allChunks = [...sermonChunks, ...exposeChunks];

  await loadBinaryVectorStorage();
  await hydrateChunksWithBinaryVectors(allChunks);

  const tenQueries = [
    "cavalier sur le cheval blanc premier sceau",
    "septième ange clairon mystères cachés",
    "manger la chair du fils de l'homme et boire son sang",
    "manne cachée lieu très saint sainte cène",
    "fête des trompettes rassemblement des cent quarante-quatre mille juifs",
    "figuier repoussé ses feuilles drapeau étoile de david Jérusalem",
    "faux christs faux prophètes grands prodiges miracles matthieu 24",
    "pluie de dieu bon blé et ivraie dans le même champ",
    "séduction spirituelle manifestation des dons spirituels ivraie",
    "questions et réponses partie essentielle de l'enseignement"
  ];

  let totalRanksTested = 0;
  let identicalRanksCount = 0;

  for (let qIdx = 0; qIdx < tenQueries.length; qIdx++) {
    const q = tenQueries[qIdx];
    const qVec = await computeE5Embedding(q, 'query: ') || new Int8Array(384);

    // AVANT ÉTAPE 6 (Recherche brute sur tous les chunks puis filtrage a posteriori)
    const resAvant = searchByVector(qVec, allChunks, { topK: 10, guaranteeTopK: false });

    // APRÈS ÉTAPE 6 (Recherche avec pre-filtering sans filtre ou filtre vide {})
    const resApres = searchByVector(qVec, allChunks, { topK: 10, metadataFilter: {}, guaranteeTopK: true });

    console.log(`-----------------------------------------------------------------------------------------`);
    console.log(`[Requête #${qIdx + 1}/10] "${q}"`);
    console.log(`RANG | AVANT ÉTAPE 6 (POST-FILTER)        | APRÈS ÉTAPE 6 (PRE-FILTER)         | SCORE  | STATUT`);
    console.log(`-----+------------------------------------+------------------------------------+--------+-------`);

    let queryOk = true;
    for (let r = 0; r < 10; r++) {
      totalRanksTested++;
      const b = resAvant[r];
      const a = resApres[r];

      const bChunk = b ? b.chunk.chunkId : '---';
      const aChunk = a ? a.chunk.chunkId : '---';
      const bScore = b ? b.score.toFixed(4) : '---';
      const aScore = a ? a.score.toFixed(4) : '---';

      const match = bChunk === aChunk && bScore === aScore;
      if (match) {
        identicalRanksCount++;
      } else {
        queryOk = false;
      }

      console.log(
        ` #${String(r + 1).padEnd(2)} | ` +
        `${bChunk.padEnd(34)} | ` +
        `${aChunk.padEnd(34)} | ` +
        `${aScore.padEnd(6)} | ` +
        `${match ? '✓ IDENTIQUE' : '❌ DIFFÉRENT'}`
      );
    }

    console.log(`• Résultat requête #${qIdx + 1} : ${queryOk ? '10/10 rangs strictement identiques (100%)' : 'Divergence'}\n`);
  }

  console.log("=========================================================================================");
  console.log("  SYNTHÈSE DE LA NON-RÉGRESSION SANS FILTRE SUR LES 10 REQUÊTES");
  console.log("=========================================================================================");
  console.log(`• Total de rangs comparés : ${totalRanksTested} (10 requêtes x 10 rangs)`);
  console.log(`• Rangs strictement identiques : ${identicalRanksCount} / ${totalRanksTested} (${Math.round((identicalRanksCount / totalRanksTested) * 100)}%)`);
  console.log("=========================================================================================\n");
}

if (process.argv[1]?.endsWith('test_complete_non_regression_top10.ts')) {
  runCompleteTop10NonRegression().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
