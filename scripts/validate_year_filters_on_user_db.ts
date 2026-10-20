/**
 * King's Sword — Script de validation des filtres d'année sur la base SQLite complète (1 500 sermons)
 * 
 * Ce script est conçu pour être lancé directement sur votre machine de production :
 *   npx tsx scripts/validate_year_filters_on_user_db.ts [chemin_vers_kings_sword_v2.db]
 * 
 * Exemples :
 *   npx tsx scripts/validate_year_filters_on_user_db.ts
 *   npx tsx scripts/validate_year_filters_on_user_db.ts /chemin/vers/ma_base.db
 */

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { performance } from 'perf_hooks';
import { createLibraryChunks } from '../services/chunkingService';
import { createExposeDocumentChunks } from '../services/exposeDocumentService';
import { buildPrecalculatedMetadataIndices, filterChunksViaMetadataIndices } from '../services/metadataIndexService';
import { matchesMetadataFilter } from '../services/vectorSearchService';
import { MetadataFilter, SermonChunk } from '../types';

function resolveDatabasePath(): string {
  // 1. Argument en ligne de commande
  if (process.argv[2]) {
    return path.resolve(process.argv[2]);
  }

  // 2. Chemins standards King's Sword selon l'OS
  const home = process.env.HOME || process.env.USERPROFILE || '.';
  const candidatePaths = [
    path.join(home, '.config', 'kings-sword', 'kings_sword_v2.db'),
    path.join(home, 'AppData', 'Roaming', 'kings-sword', 'kings_sword_v2.db'),
    path.join(home, 'Library', 'Application Support', 'kings-sword', 'kings_sword_v2.db'),
    path.resolve('kings_sword_v2.db'),
    path.resolve('public', 'kings_sword_v2.db')
  ];

  for (const cand of candidatePaths) {
    if (fs.existsSync(cand)) return cand;
  }

  return candidatePaths[0];
}

async function validateYearFiltersOnUserDatabase() {
  console.log("=========================================================================================");
  console.log("  VALIDATION DES FILTRES PAR ANNÉE SUR VOTRE BASE SQLITE COMPLÈTE (1 500 SERMONS)");
  console.log("=========================================================================================\n");

  const dbPath = resolveDatabasePath();
  console.log(`• Recherche de la base SQLite : ${dbPath}`);

  if (!fs.existsSync(dbPath)) {
    console.error(`\n❌ Fichier SQLite introuvable à : ${dbPath}`);
    console.log(`\nPour exécuter ce test sur votre base, passez le chemin en paramètre :`);
    console.log(`   npx tsx scripts/validate_year_filters_on_user_db.ts /chemin/vers/votre/kings_sword_v2.db\n`);
    process.exit(1);
  }

  const db = new Database(dbPath, { readonly: true });
  console.log("✓ Connexion SQLite établie avec succès.\n");

  // 1. Extraction des métadonnées des sermons
  console.log("1. Inventaire des sermons et des années dans la base :");
  const sermonsRows = db.prepare('SELECT id, title, date, city, version FROM sermons').all() as any[];
  console.log(`   • Nombre total de sermons dans la base : ${sermonsRows.length} sermons`);

  if (sermonsRows.length === 0) {
    console.error("❌ La table sermons est vide !");
    process.exit(1);
  }

  // Chargement des paragraphes pour reconstituer les sermons complets
  console.log("   • Chargement des paragraphes associés...");
  const pStmt = db.prepare('SELECT content FROM paragraphs WHERE sermon_id = ? ORDER BY paragraph_index ASC');

  const fullSermons = sermonsRows.map((s, idx) => {
    if (idx % 250 === 0 && idx > 0) {
      process.stdout.write(`     -> ${idx}/${sermonsRows.length} sermons chargés...\r`);
    }
    const paras = pStmt.all(s.id) as { content: string }[];
    return {
      ...s,
      text: paras.map(p => p.content).join('\n\n')
    };
  });
  console.log(`\n   ✓ ${fullSermons.length} sermons chargés avec texte complet.\n`);

  // Découpage en chunks
  console.log("2. Découpage et constitution du corpus complet (Sermons + Exposé complet) :");
  const t0Chunk = performance.now();
  const sermonChunks = createLibraryChunks(fullSermons);
  const exposeChunks = await createExposeDocumentChunks();
  const allChunks = [...sermonChunks, ...exposeChunks];
  const durChunk = performance.now() - t0Chunk;
  console.log(`   • Chunks de sermons générés : ${sermonChunks.length} chunks`);
  console.log(`   • Chunks de l'Exposé complet : ${exposeChunks.length} chunks`);
  console.log(`   • TOTAL DU CORPUS INDEXÉ   : ${allChunks.length} chunks en ${(durChunk / 1000).toFixed(2)} s\n`);

  // Construction des index de métadonnées
  console.log("3. Construction des index de métadonnées précalculés Map (O(1)) :");
  const t0Idx = performance.now();
  const metadataIndices = buildPrecalculatedMetadataIndices(allChunks);
  const durIdx = performance.now() - t0Idx;
  console.log(`   ✓ Indexation terminée en ${durIdx.toFixed(2)} ms`);
  console.log(`   • Années distinctes indexées : ${metadataIndices.byYear.size} années`);
  
  const yearsSorted = Array.from(metadataIndices.byYear.keys()).sort((a, b) => a - b);
  console.log(`   • Plage couverte : de ${yearsSorted[0]} à ${yearsSorted[yearsSorted.length - 1]}`);
  console.log(`   • Distribution par année :`);
  for (const yr of yearsSorted) {
    const count = metadataIndices.byYear.get(yr)?.length || 0;
    console.log(`     - Année ${yr} : ${String(count).padStart(5)} chunks`);
  }
  console.log("");

  // 4. Batterie de tests réels de filtrage
  console.log("4. Batterie de tests de conformité stricte des filtres :");
  const testCases: Array<{ name: string; filter: MetadataFilter; minExpectedYear?: number; maxExpectedYear?: number }> = [
    { name: "Année unique 1963", filter: { years: [1963] }, minExpectedYear: 1963, maxExpectedYear: 1963 },
    { name: "Année unique 1953", filter: { years: [1953] }, minExpectedYear: 1953, maxExpectedYear: 1953 },
    { name: "Plage 1950 - 1955", filter: { yearMin: 1950, yearMax: 1955 }, minExpectedYear: 1950, maxExpectedYear: 1955 },
    { name: "Plage 1960 - 1965", filter: { yearMin: 1960, yearMax: 1965 }, minExpectedYear: 1960, maxExpectedYear: 1965 },
    { name: "Année 1965 + source sermon uniquement", filter: { years: [1965], sources: ['sermon'] }, minExpectedYear: 1965, maxExpectedYear: 1965 },
    { name: "Année 1965 + source exposé uniquement", filter: { years: [1965], sources: ['expose'] }, minExpectedYear: 1965, maxExpectedYear: 1965 },
    { name: "Année hors-corpus (1930) - test de robustesse", filter: { years: [1930] } }
  ];

  let allTestsPassed = true;

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    const t0 = performance.now();
    const results = filterChunksViaMetadataIndices(tc.filter, allChunks);
    const lat = performance.now() - t0;

    // Vérification de stricte conformité
    let strictlyCompliant = true;
    for (const c of results) {
      if (!matchesMetadataFilter(c, tc.filter)) {
        strictlyCompliant = false;
        break;
      }
    }

    if (!strictlyCompliant) allTestsPassed = false;

    console.log(`   [Test #${i + 1}] ${tc.name.padEnd(46)} | Chunks: ${String(results.length).padStart(5)} | Temps: ${lat.toFixed(2)} ms | ${strictlyCompliant ? '✓ 100% CONFORME' : '❌ ERREUR'}`);
  }
  console.log("");

  // 5. Comparaison de performance (Scan linéaire vs Index Map O(1))
  console.log("5. Benchmark de performance sur votre volume de 1 500 sermons :");
  const testFilter: MetadataFilter = { yearMin: 1960, yearMax: 1964 };
  const iterations = 200;

  const t0Scan = performance.now();
  for (let i = 0; i < iterations; i++) {
    allChunks.filter(c => matchesMetadataFilter(c, testFilter));
  }
  const durScan = performance.now() - t0Scan;

  const t0Map = performance.now();
  for (let i = 0; i < iterations; i++) {
    filterChunksViaMetadataIndices(testFilter, allChunks);
  }
  const durMap = performance.now() - t0Map;

  console.log(`   • ${iterations} filtrages par parcours linéaire complet : ${durScan.toFixed(2)} ms (${(durScan / iterations).toFixed(3)} ms/op)`);
  console.log(`   • ${iterations} filtrages par index précalculés Map     : ${durMap.toFixed(2)} ms (${(durMap / iterations).toFixed(3)} ms/op)`);
  console.log(`   • Facteur d'accélération mesuré                       : x${(durScan / Math.max(0.001, durMap)).toFixed(1)} plus rapide !`);

  console.log("\n=========================================================================================");
  console.log(`  RÉSULTAT : ${allTestsPassed ? '🎉 TOUS LES TESTS SONT VALIDÉS AVEC SUCCÈS !' : '❌ CERTAINS TESTS ONT ÉCHOUÉ.'}`);
  console.log("=========================================================================================\n");

  db.close();
}

validateYearFiltersOnUserDatabase().catch(err => {
  console.error("Erreur exécution validation base SQLite:", err);
  process.exit(1);
});
