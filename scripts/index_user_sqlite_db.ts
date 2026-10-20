/**
 * King's Sword — Script d'indexation pour la base SQLite complète de l'utilisateur (1 500 sermons)
 * 
 * À exécuter directement sur votre machine locale contenant votre fichier `kings_sword_v2.db` :
 *   npx tsx scripts/index_user_sqlite_db.ts [chemin_vers_votre_db.db]
 */

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { createLibraryChunks } from '../services/chunkingService';
import { createExposeDocumentChunks } from '../services/exposeDocumentService';
import { writeBinaryVectorFiles } from '../services/binaryVectorStorageService';
import { computeE5Embedding } from '../services/embeddingService';

async function indexUserSqliteDb() {
  const dbPath = process.argv[2] || path.resolve(process.env.APPDATA || process.env.HOME || '.', '.config', 'kings-sword', 'kings_sword_v2.db');

  console.log("=====================================================================");
  console.log("  INDEXATION COMPLÈTE DE LA BASE SQLITE UTILISATEUR");
  console.log("=====================================================================");
  console.log(`• Fichier SQLite cible : ${dbPath}`);

  if (!fs.existsSync(dbPath)) {
    console.log(`⚠️ Fichier SQLite introuvable à l'emplacement : ${dbPath}`);
    console.log(`   Pour lancer l'indexation sur vos 1 500 sermons, spécifiez le chemin :`);
    console.log(`   npx tsx scripts/index_user_sqlite_db.ts /chemin/vers/votre/kings_sword_v2.db\n`);
    process.exit(0);
  }

  const db = new Database(dbPath);

  // 1. Lecture des sermons de l'utilisateur
  const sermonsRows = db.prepare('SELECT id, title, date, city, version FROM sermons').all() as any[];
  const pStmt = db.prepare('SELECT content FROM paragraphs WHERE sermon_id = ? ORDER BY paragraph_index ASC');

  const fullSermons = sermonsRows.map(s => {
    const paras = pStmt.all(s.id) as { content: string }[];
    return {
      ...s,
      text: paras.map(p => p.content).join('\n\n')
    };
  });

  console.log(`• Sermons extraits de la base SQLite : ${fullSermons.length} sermons`);

  // 2. Génération des chunks pour tous les sermons
  const sermonChunks = createLibraryChunks(fullSermons);
  const exposeChunks = await createExposeDocumentChunks();
  const allChunks = [...sermonChunks, ...exposeChunks];

  console.log(`• Total chunks générés : ${allChunks.length} (Sermons: ${sermonChunks.length}, Exposé: ${exposeChunks.length})`);

  // 3. Stockage des chunks dans la table `sermon_chunks` de votre SQLite
  db.exec(`
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
      updated_at TEXT
    );
  `);

  const insChunkStmt = db.prepare(`
    INSERT OR REPLACE INTO sermon_chunks (
      chunk_id, sermon_id, paragraph_ids, start_paragraph, end_paragraph,
      text, sermon_title, date, city, version, character_count, word_count,
      content_hash, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const now = new Date().toISOString();
  const tx = db.transaction((chunkList) => {
    for (const c of chunkList) {
      insChunkStmt.run(
        c.chunkId,
        c.sermonId,
        JSON.stringify(c.paragraphIds || []),
        c.startParagraph,
        c.endParagraph,
        c.text,
        c.sermonTitle || '',
        c.date || '',
        c.city || '',
        c.version || '',
        c.characterCount || c.text.length,
        c.wordCount || 0,
        c.contentHash || '',
        now,
        now
      );
    }
  });

  tx(allChunks);
  const countRow = db.prepare('SELECT COUNT(*) as total FROM sermon_chunks').get() as { total: number };
  console.log(`✓ Total chunks enregistrés dans la table SQLite sermon_chunks : ${countRow.total} chunks`);

  db.close();
}

indexUserSqliteDb().catch(err => {
  console.error("Erreur indexation base utilisateur:", err);
});
