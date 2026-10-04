/**
 * King's Sword — Service Documentaire & RAG Chants (Phase 2F.12C)
 * 
 * Intègre les recueils de chants (cantiques) au pipeline RAG unifié :
 * 1. Abstraction canonique des chants depuis public/songs.json.
 * 2. Découpage sémantique en strophes / couplets / refrains.
 * 3. Recherche lexicale BM25 pour les paroles et numéros de chants.
 * 4. Citations au format canonique : [Réf: Chant-ID, §N] (ex: [Réf: Chant-229, §1]).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CanonicalDocument, DocumentParagraph, SermonChunk } from '../types';
import { normalizeText } from '../utils/textUtils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

let cachedRawSongs: Array<{ id: number; title: string; content: string; language: string; filename?: string }> | null = null;
let cachedSongDocs: CanonicalDocument[] | null = null;
let cachedSongChunks: SermonChunk[] | null = null;

/**
 * Charge la liste brute des chants depuis public/songs.json.
 */
export async function loadRawSongsData(): Promise<Array<{ id: number; title: string; content: string; language: string; filename?: string }>> {
  if (cachedRawSongs) return cachedRawSongs;

  const songsPath = path.join(rootDir, 'public', 'songs.json');
  if (fs.existsSync(songsPath)) {
    const raw = fs.readFileSync(songsPath, 'utf8');
    cachedRawSongs = JSON.parse(raw);
    return cachedRawSongs!;
  }
  throw new Error(`Fichier chants introuvable : ${songsPath}`);
}

/**
 * Découpe le texte d'un chant en strophes (couplets / refrains).
 */
export function splitSongIntoStrophes(content: string): Array<{ index: number; title: string; text: string }> {
  if (!content) return [];
  const lines = content.split('\n');
  const strophes: Array<{ index: number; title: string; text: string }> = [];

  let currentTitle = 'Couplet 1';
  let currentLines: string[] = [];
  let stropheIndex = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      if (currentLines.length > 0) {
        strophes.push({
          index: stropheIndex++,
          title: currentTitle,
          text: currentLines.join('\n')
        });
        currentLines = [];
      }
      continue;
    }

    // Détection d'en-tête de section (Couplet N, Chœur, Refrain, Chorus)
    const headerMatch = line.match(/^(couplet\s*\d+|chœur|choeur|refrain|chorus|strophe\s*\d+)/i);
    if (headerMatch) {
      if (currentLines.length > 0) {
        strophes.push({
          index: stropheIndex++,
          title: currentTitle,
          text: currentLines.join('\n')
        });
        currentLines = [];
      }
      currentTitle = line;
      continue;
    }

    currentLines.push(line);
  }

  if (currentLines.length > 0) {
    strophes.push({
      index: stropheIndex,
      title: currentTitle,
      text: currentLines.join('\n')
    });
  }

  return strophes.length > 0 ? strophes : [{ index: 1, title: 'Paroles', text: content.trim() }];
}

/**
 * Charge les chants sous forme de documents canoniques.
 */
export async function loadSongsAsCanonicalDocuments(): Promise<CanonicalDocument[]> {
  if (cachedSongDocs) return cachedSongDocs;

  const rawSongs = await loadRawSongsData();
  const docs: CanonicalDocument[] = [];

  for (const song of rawSongs) {
    const strophes = splitSongIntoStrophes(song.content);
    const paragraphs: DocumentParagraph[] = strophes.map(s => ({
      paragraphId: `s${s.index}`,
      paragraphIndex: s.index,
      text: s.text,
      sectionTitle: s.title,
      chapterTitle: song.title
    }));

    docs.push({
      documentId: `song-${song.id}`,
      documentType: 'song',
      title: song.title,
      author: 'Cantiques & Chants du Message',
      version: song.language,
      paragraphs,
      metadata: {
        songId: song.id,
        language: song.language,
        filename: song.filename
      }
    });
  }

  cachedSongDocs = docs;
  return docs;
}

/**
 * Découpe les chants en chunks sémantiques.
 * Chaque strophe forme un chunk autonome.
 */
export async function createSongDocumentChunks(): Promise<SermonChunk[]> {
  if (cachedSongChunks) return cachedSongChunks;

  const docs = await loadSongsAsCanonicalDocuments();
  const chunks: SermonChunk[] = [];
  const nowIso = new Date().toISOString();

  for (const doc of docs) {
    const meta = doc.metadata || {};
    const songId = meta.songId || doc.documentId.replace('song-', '');

    for (const p of doc.paragraphs) {
      const chunkText = p.text;
      const refString = `Chant-${songId}, §${p.paragraphIndex}`;

      chunks.push({
        chunkId: `${doc.documentId}_c${p.paragraphIndex}_p${p.paragraphIndex}`,
        sermonId: doc.documentId,
        documentId: doc.documentId,
        documentType: 'song',
        paragraphIds: [p.paragraphIndex],
        startParagraph: p.paragraphIndex,
        endParagraph: p.paragraphIndex,
        text: chunkText,
        sermonTitle: doc.title,
        chapterTitle: doc.title,
        sectionTitle: p.sectionTitle || refString,
        version: doc.version,
        characterCount: chunkText.length,
        wordCount: chunkText.split(/\s+/).filter(Boolean).length,
        createdAt: nowIso,
        updatedAt: nowIso,
        metadata: {
          songId,
          language: meta.language,
          stropheIndex: p.paragraphIndex,
          sectionTitle: p.sectionTitle,
          formattedCitation: `[Réf: Chant-${songId}, §${p.paragraphIndex}]`
        }
      });
    }
  }

  cachedSongChunks = chunks;
  return chunks;
}

/**
 * Recherche lexicale haute précision sur les chants.
 */
export async function searchSongsLexicalForRag(
  query: string,
  options: { topK?: number; minScore?: number } = {}
): Promise<Array<{ sermonId: string; paragraphIndex: number; score: number; text: string; reference: string }>> {
  const cleanQuery = (query || '').trim();
  if (!cleanQuery) return [];

  const chunks = await createSongDocumentChunks();
  const topK = options.topK || 40;
  const minScore = options.minScore || 5;

  const normalizedQuery = normalizeText(cleanQuery);
  const words = normalizedQuery
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2);

  if (words.length === 0) return [];

  // Détection du numéro de chant (ex: "Chant 229", "Cantique 14")
  const songNrMatch = cleanQuery.match(/(?:chant|cantique|hymn)\s*#?\s*(\d+)/i);
  const targetSongId = songNrMatch ? parseInt(songNrMatch[1], 10) : null;

  const scored: Array<{
    sermonId: string;
    paragraphIndex: number;
    score: number;
    text: string;
    reference: string;
  }> = [];

  for (const chunk of chunks) {
    const meta = chunk.metadata || {};
    const normText = normalizeText(chunk.text);
    const normTitle = normalizeText(chunk.sermonTitle);
    let score = 0;
    let matchCount = 0;

    // Bonus si numéro exact de chant
    if (targetSongId && Number(meta.songId) === targetSongId) {
      score += 150;
    }

    // Bonus si titre de chant correspond
    if (normTitle.includes(normalizedQuery)) {
      score += 60;
    }

    for (const word of words) {
      if (normText.includes(word)) {
        matchCount++;
        const occ = normText.split(word).length - 1;
        score += 15 + Math.min(occ * 5, 20);
      }
      if (normTitle.includes(word)) {
        score += 25;
      }
    }

    if (score >= minScore) {
      const ratio = matchCount / words.length;
      score = score * (0.4 + 0.6 * ratio);

      scored.push({
        sermonId: chunk.sermonId,
        paragraphIndex: chunk.startParagraph,
        score: Math.round(score * 10) / 10,
        text: chunk.text,
        reference: `Chant-${meta.songId}, §${chunk.startParagraph}`
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
