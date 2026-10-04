/**
 * King's Sword — Service Documentaire & RAG Bible (Phase 2F.12C)
 * 
 * Intègre la Bible (Louis Segond 1910) au pipeline RAG unifié :
 * 1. Abstraction canonique des livres et chapitres de la Bible.
 * 2. Découpage sémantique en chunks (versets / péricopes) avec références bibliques strictes.
 * 3. Recherche lexicale BM25 haute précision pour les versets et références.
 * 4. Citations au format canonique : [Réf: Livre Chapitre:Verset] (ex: [Réf: Jean 3:16]).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CanonicalDocument, DocumentParagraph, SermonChunk } from '../types';
import { normalizeText } from '../utils/textUtils';
import { BIBLE_BOOKS_META, BibleBookMeta } from './bibleMetadata';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

let cachedBibleData: Record<string, Record<number, Array<{ verse: number; text: string }>>> | null = null;
let cachedBibleChunks: SermonChunk[] | null = null;
let cachedBibleDocs: CanonicalDocument[] | null = null;

// Map d'alias pour les noms de livres en français
const BOOK_NAME_TO_ID = new Map<string, string>();
const BOOK_ID_TO_META = new Map<string, BibleBookMeta>();

for (const meta of BIBLE_BOOKS_META) {
  BOOK_ID_TO_META.set(meta.id.toUpperCase(), meta);
  const normName = normalizeText(meta.name);
  BOOK_NAME_TO_ID.set(normName, meta.id.toUpperCase());
  BOOK_NAME_TO_ID.set(meta.id.toLowerCase(), meta.id.toUpperCase());
}

// Alias courants
BOOK_NAME_TO_ID.set('apoc', 'REV');
BOOK_NAME_TO_ID.set('apocalypse', 'REV');
BOOK_NAME_TO_ID.set('revelation', 'REV');
BOOK_NAME_TO_ID.set('genese', 'GEN');
BOOK_NAME_TO_ID.set('matthieu', 'MAT');
BOOK_NAME_TO_ID.set('matt', 'MAT');
BOOK_NAME_TO_ID.set('jean', 'JHN');
BOOK_NAME_TO_ID.set('romains', 'ROM');
BOOK_NAME_TO_ID.set('rom', 'ROM');
BOOK_NAME_TO_ID.set('actes', 'ACT');
BOOK_NAME_TO_ID.set('psaumes', 'PSA');
BOOK_NAME_TO_ID.set('psaume', 'PSA');
BOOK_NAME_TO_ID.set('1 jean', '1JN');
BOOK_NAME_TO_ID.set('1jean', '1JN');
BOOK_NAME_TO_ID.set('1 corinthiens', '1CO');
BOOK_NAME_TO_ID.set('2 corinthiens', '2CO');
BOOK_NAME_TO_ID.set('ephesiens', 'EPH');
BOOK_NAME_TO_ID.set('hebreux', 'HEB');

/**
 * Charge les données brutes de la Bible Louis Segond 1910 depuis public/bible-lsg1910.json.
 */
export async function loadRawBibleData(): Promise<Record<string, Record<number, Array<{ verse: number; text: string }>>>> {
  if (cachedBibleData) return cachedBibleData;

  const biblePath = path.join(rootDir, 'public', 'bible-lsg1910.json');
  if (fs.existsSync(biblePath)) {
    const raw = fs.readFileSync(biblePath, 'utf8');
    cachedBibleData = JSON.parse(raw);
    return cachedBibleData!;
  }
  throw new Error(`Fichier Bible introuvable : ${biblePath}`);
}

/**
 * Charge la Bible sous forme de documents canoniques.
 * Chaque chapitre d'un livre biblique forme un CanonicalDocument autonome.
 */
export async function loadBibleAsCanonicalDocuments(): Promise<CanonicalDocument[]> {
  if (cachedBibleDocs) return cachedBibleDocs;

  const rawData = await loadRawBibleData();
  const docs: CanonicalDocument[] = [];

  for (const meta of BIBLE_BOOKS_META) {
    const bookData = rawData[meta.id];
    if (!bookData) continue;

    const chapters = Object.keys(bookData).map(k => parseInt(k, 10)).sort((a, b) => a - b);
    for (const chapter of chapters) {
      const verses = bookData[chapter];
      if (!Array.isArray(verses) || verses.length === 0) continue;

      const paragraphs: DocumentParagraph[] = verses.map(v => ({
        paragraphId: `v${v.verse}`,
        paragraphIndex: v.verse,
        text: `${v.verse}. ${v.text.trim()}`,
        sectionTitle: `${meta.name} ${chapter}:${v.verse}`,
        chapterNumber: chapter,
        chapterTitle: `${meta.name} ${chapter}`
      }));

      docs.push({
        documentId: `bible-${meta.id}-${chapter}`,
        documentType: 'bible',
        title: `${meta.name} ${chapter}`,
        author: 'Bible (Louis Segond 1910)',
        version: 'LSG 1910',
        paragraphs,
        metadata: {
          bookId: meta.id,
          bookName: meta.name,
          testament: meta.testament,
          category: meta.category,
          chapter
        }
      });
    }
  }

  cachedBibleDocs = docs;
  return docs;
}

/**
 * Découpe la Bible en chunks sémantiques.
 * Un chunk regroupe 1 à 4 versets consécutifs du même chapitre (~300 à 600 caractères).
 */
export async function createBibleDocumentChunks(): Promise<SermonChunk[]> {
  if (cachedBibleChunks) return cachedBibleChunks;

  const docs = await loadBibleAsCanonicalDocuments();
  const chunks: SermonChunk[] = [];
  const nowIso = new Date().toISOString();

  for (const doc of docs) {
    const meta = doc.metadata || {};
    const bookName = meta.bookName || doc.title;
    const chapter = meta.chapter || 1;
    const paras = doc.paragraphs;
    let pIdx = 0;
    let chunkCounter = 1;

    while (pIdx < paras.length) {
      const currentGroup: DocumentParagraph[] = [];
      let currentLength = 0;

      while (pIdx + currentGroup.length < paras.length) {
        const candidate = paras[pIdx + currentGroup.length];
        const addedLength = currentLength === 0 ? candidate.text.length : currentLength + 2 + candidate.text.length;

        if (currentGroup.length > 0) {
          if (addedLength > 600 || currentGroup.length >= 4) {
            break;
          }
        }

        currentGroup.push(candidate);
        currentLength = addedLength;
      }

      if (currentGroup.length === 0) {
        currentGroup.push(paras[pIdx]);
      }

      const verseNumbers = currentGroup.map(p => p.paragraphIndex);
      const startVerse = verseNumbers[0];
      const endVerse = verseNumbers[verseNumbers.length - 1];
      const chunkText = currentGroup.map(p => p.text).join('\n');

      const refString = startVerse === endVerse
        ? `${bookName} ${chapter}:${startVerse}`
        : `${bookName} ${chapter}:${startVerse}-${endVerse}`;

      chunks.push({
        chunkId: `${doc.documentId}_c${chunkCounter}_v${startVerse}_v${endVerse}`,
        sermonId: doc.documentId,
        documentId: doc.documentId,
        documentType: 'bible',
        paragraphIds: verseNumbers,
        startParagraph: startVerse,
        endParagraph: endVerse,
        text: chunkText,
        sermonTitle: doc.title,
        chapterTitle: doc.title,
        chapterNumber: String(chapter),
        sectionTitle: refString,
        version: 'LSG 1910',
        characterCount: chunkText.length,
        wordCount: chunkText.split(/\s+/).filter(Boolean).length,
        createdAt: nowIso,
        updatedAt: nowIso,
        metadata: {
          bookId: meta.bookId,
          bookName,
          chapter,
          startVerse,
          endVerse,
          reference: refString
        }
      });

      chunkCounter++;
      // Avance par taille de groupe (overlap de 1 si groupe > 2 versets)
      const step = currentGroup.length > 2 ? currentGroup.length - 1 : currentGroup.length;
      pIdx += step;
    }
  }

  cachedBibleChunks = chunks;
  return chunks;
}

/**
 * Recherche lexicale haute précision sur la Bible.
 * Détecte les références directes (ex: "Jean 3:16") ou mots-clés textuels.
 */
export async function searchBibleLexicalForRag(
  query: string,
  options: { topK?: number; minScore?: number } = {}
): Promise<Array<{ sermonId: string; paragraphIndex: number; score: number; text: string; reference: string }>> {
  const cleanQuery = (query || '').trim();
  if (!cleanQuery) return [];

  const chunks = await createBibleDocumentChunks();
  const topK = options.topK || 40;
  const minScore = options.minScore || 5;

  const normalizedQuery = normalizeText(cleanQuery);
  const words = normalizedQuery
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2);

  if (words.length === 0) return [];

  // Détection d'une référence biblique directe dans la requête (ex: "Jean 3:16", "Romains 6:3-4", "Apocalypse 1:1")
  const refMatch = cleanQuery.match(/([1-3]?\s*[a-zA-ZÀ-ÿ]+)\s*(\d+)[\s:.,]+(\d+)(?:-(\d+))?/i);
  let targetBookId: string | null = null;
  let targetChapter: number | null = null;
  let targetVerse: number | null = null;

  if (refMatch) {
    const rawBookName = normalizeText(refMatch[1].trim());
    targetBookId = BOOK_NAME_TO_ID.get(rawBookName) || null;
    targetChapter = parseInt(refMatch[2], 10);
    targetVerse = parseInt(refMatch[3], 10);
  }

  const scored: Array<{
    sermonId: string;
    paragraphIndex: number;
    score: number;
    text: string;
    reference: string;
  }> = [];

  for (const chunk of chunks) {
    const normText = normalizeText(chunk.text);
    const meta = chunk.metadata || {};
    let score = 0;
    let matchCount = 0;

    // Bonus massif si référence biblique exacte correspondante
    if (targetBookId && meta.bookId === targetBookId && meta.chapter === targetChapter) {
      if (targetVerse && chunk.paragraphIds.includes(targetVerse)) {
        score += 200; // Match exact de verset
      } else {
        score += 50;  // Même chapitre
      }
    }

    // Matching des termes de requête
    for (const word of words) {
      if (normText.includes(word)) {
        matchCount++;
        const occ = normText.split(word).length - 1;
        score += 15 + Math.min(occ * 5, 25);
      }
    }

    if (chunk.sectionTitle && normalizeText(chunk.sectionTitle).includes(normalizedQuery)) {
      score += 40;
    }

    if (score >= minScore) {
      const ratio = matchCount / words.length;
      score = score * (0.5 + 0.5 * ratio);

      scored.push({
        sermonId: chunk.sermonId,
        paragraphIndex: chunk.startParagraph,
        score: Math.round(score * 10) / 10,
        text: chunk.text,
        reference: meta.reference || `${chunk.sermonTitle}:${chunk.startParagraph}`
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
