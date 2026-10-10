/**
 * King's Sword — Service Documentaire & RAG Exposé (Phase 2F.11)
 * 
 * Intègre le corpus « Exposé des Sept Âges de l'Église » au pipeline RAG :
 * 1. Abstraction canonique des documents Exposé (11 chapitres, 1 590 paragraphes).
 * 2. Découpage en chunks sémantiques déterministes (100% de couverture, zéro perte).
 * 3. Moteur de recherche lexicale BM25 / scoring par paragraphe adapté au RAG.
 * 4. Pipeline de retrieval hybride (Lexical + Vectoriel RRF + Reranking + Answerability + Evidence).
 * 5. Préservation absolue des identifiants et citations originaux [Réf: expose-ch-N, §P].
 */

import { 
  CanonicalDocument, 
  DocumentParagraph, 
  Sermon, 
  SermonChunk, 
  ChunkingOptions,
  RetrievalEvidencePackage,
  HybridSearchResult,
  RerankedSearchResult,
  AnswerabilityAssessment
} from '../types';
import { loadExposeData, cleanExposeText, ExposeTOC, ExposePage, ExposeParagraph } from './exposeService';
import { computeChunkHash, DEFAULT_CHUNKING_OPTIONS } from './chunkingService';
import { mapParagraphsToChunkHits, fuseRankings } from './hybridRetrievalService';
import { rerankHybridResults, assessAnswerability } from './rerankingService';
import { buildRetrievalEvidencePackage } from './retrievalEvidenceService';
import { normalizeText } from '../utils/textUtils';
import { searchByText } from './vectorSearchService';
import { getGeminiApiKey } from '../utils/apiKeyHelper';

let cachedCanonicalExpose: CanonicalDocument[] | null = null;
let cachedExposeSermons: Sermon[] | null = null;
let cachedExposeChunks: SermonChunk[] | null = null;

/**
 * Charge l'intégralité du livre Exposé sous forme de documents canoniques (1 document par chapitre).
 */
export async function loadExposeAsCanonicalDocuments(): Promise<CanonicalDocument[]> {
  if (cachedCanonicalExpose) return cachedCanonicalExpose;

  const data = await loadExposeData();
  if (!data) return [];

  const chapters: CanonicalDocument[] = [];
  const tocEntries: ExposeTOC[] = data.table_of_contents || [];

  for (let i = 0; i < tocEntries.length; i++) {
    const entry = tocEntries[i];
    const nextEntry = tocEntries[i + 1];
    const chNum = String(entry.chapter_number);
    const pageStart = entry.page_start;
    const pageEnd = nextEntry ? nextEntry.page_start - 1 : (data.book?.total_pages || 374);

    const docParagraphs: DocumentParagraph[] = [];
    let sequentialIndex = 1;

    for (let p = pageStart; p <= pageEnd; p++) {
      const page: ExposePage = data.pages[String(p)];
      if (page && Array.isArray(page.paragraphs)) {
        for (const para of page.paragraphs) {
          if (para.text && para.text.trim()) {
            docParagraphs.push({
              paragraphId: para.paragraph_id,
              paragraphIndex: sequentialIndex++,
              text: cleanExposeText(para.text.trim()),
              sectionTitle: para.section_title ? cleanExposeText(para.section_title.trim()) : null,
              chapterNumber: chNum,
              chapterTitle: cleanExposeText(entry.title),
              pageNumber: p,
              indexInPage: para.index_in_page
            });
          }
        }
      }
    }

    const docTitle = chNum === '0' 
      ? cleanExposeText(entry.title) 
      : `Chapitre ${chNum} - ${cleanExposeText(entry.title)}`;

    chapters.push({
      documentId: `expose-ch-${chNum}`,
      documentType: 'expose',
      title: docTitle,
      author: data.book?.author || 'William Marrion Branham',
      date: '1965',
      city: 'Jeffersonville',
      version: 'EXPOSE',
      paragraphs: docParagraphs,
      metadata: {
        chapter_number: chNum,
        page_start: pageStart,
        page_end: pageEnd,
        total_paragraphs: docParagraphs.length
      }
    });
  }

  cachedCanonicalExpose = chapters;
  return chapters;
}

/**
 * Expose les chapitres de l'Exposé comme des objets Sermon compatibles.
 */
export async function loadExposeAsSermons(): Promise<Sermon[]> {
  if (cachedExposeSermons) return cachedExposeSermons;

  const docs = await loadExposeAsCanonicalDocuments();
  cachedExposeSermons = docs.map(d => ({
    id: d.documentId,
    title: d.title,
    date: d.date || '1965',
    city: d.city || 'Jeffersonville',
    version: d.version || 'EXPOSE',
    text: d.paragraphs.map(p => p.text).join('\n\n')
  }));

  return cachedExposeSermons;
}

/**
 * Crée les chunks sémantiques pour l'ensemble du corpus Exposé.
 * Règle d'or : Couverture 100% sans aucun texte perdu.
 */
export async function createExposeDocumentChunks(options?: ChunkingOptions): Promise<SermonChunk[]> {
  if (cachedExposeChunks && !options) return cachedExposeChunks;

  const docs = await loadExposeAsCanonicalDocuments();
  const opts: Required<ChunkingOptions> = {
    ...DEFAULT_CHUNKING_OPTIONS,
    ...(options || {})
  };

  const chunks: SermonChunk[] = [];
  const nowIso = new Date().toISOString();

  for (const doc of docs) {
    const paras = doc.paragraphs;
    if (paras.length === 0) continue;

    let pIdx = 0;
    let chunkCounter = 1;

    while (pIdx < paras.length) {
      const currentGroup: DocumentParagraph[] = [];
      let currentLength = 0;

      while (pIdx + currentGroup.length < paras.length) {
        const candidate = paras[pIdx + currentGroup.length];
        const addedLength = currentLength === 0 ? candidate.text.length : currentLength + 2 + candidate.text.length;

        if (currentGroup.length > 0) {
          if (addedLength > opts.maxCharacters || currentGroup.length >= opts.maxParagraphsPerChunk) {
            break;
          }
        }

        currentGroup.push(candidate);
        currentLength = addedLength;
      }

      if (currentGroup.length === 0) {
        currentGroup.push(paras[pIdx]);
      }

      const paragraphIds = currentGroup.map(p => p.paragraphIndex);
      const startParagraph = paragraphIds[0];
      const endParagraph = paragraphIds[paragraphIds.length - 1];
      const chunkText = currentGroup.map(p => p.text).join('\n\n');
      const contentHash = computeChunkHash(doc.documentId, paragraphIds, chunkText);

      // Métadonnées enrichies
      const primarySection = currentGroup.find(p => Boolean(p.sectionTitle))?.sectionTitle || null;

      chunks.push({
        chunkId: `${doc.documentId}_c${chunkCounter}_p${startParagraph}_p${endParagraph}`,
        sermonId: doc.documentId,
        documentId: doc.documentId,
        documentType: 'expose',
        paragraphIds,
        startParagraph,
        endParagraph,
        text: chunkText,
        sermonTitle: doc.title,
        chapterTitle: doc.title,
        chapterNumber: doc.metadata?.chapter_number || null,
        sectionTitle: primarySection,
        date: doc.date,
        city: doc.city,
        version: doc.version,
        characterCount: chunkText.length,
        wordCount: chunkText.split(/\s+/).filter(Boolean).length,
        contentHash,
        createdAt: nowIso,
        updatedAt: nowIso,
        metadata: {
          page_start: currentGroup[0].pageNumber,
          page_end: currentGroup[currentGroup.length - 1].pageNumber
        }
      });

      chunkCounter++;

      const groupSize = currentGroup.length;
      let step = groupSize;
      if (opts.overlapParagraphs > 0 && groupSize > 1) {
        step = Math.max(1, groupSize - opts.overlapParagraphs);
      }
      pIdx += step;
    }
  }

  if (!options) {
    cachedExposeChunks = chunks;
    await hydrateExposePrecalculatedEmbeddings(cachedExposeChunks);
  }
  return chunks;
}

let cachedMeta: any = null;
let cachedArrayBuf: ArrayBuffer | null = null;
let cachedNodeBuffer: any = null;

/**
 * Hydrate les chunks avec les embeddings 768D Int8 précalculés livrés dans l'application.
 * 0 appel réseau Gemini, chargement binaire direct et instantané (< 10 ms).
 */
export async function hydrateExposePrecalculatedEmbeddings(chunks: SermonChunk[]): Promise<void> {
  if (!Array.isArray(chunks) || chunks.length === 0) return;

  try {
    // Mode Node.js / Electron
    if (typeof process !== 'undefined' && process.versions && process.versions.node) {
      if (!cachedMeta || !cachedNodeBuffer) {
        const fs = await import('fs');
        const path = await import('path');
        const metaPath384 = path.resolve('public', 'corpus_embeddings_384d_meta.json');
        const metaPathMain = path.resolve('public', 'corpus_embeddings_meta.json');
        const metaPath = fs.existsSync(metaPath384) ? metaPath384 : metaPathMain;

        const binPath384 = path.resolve('public', 'corpus_embeddings_384d.bin');
        const binPath768 = path.resolve('public', 'corpus_embeddings_768d.bin');
        const binPath = fs.existsSync(binPath384) ? binPath384 : binPath768;

        if (fs.existsSync(metaPath) && fs.existsSync(binPath)) {
          const rawMeta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
          // Filtrer rigoureusement sur model_id et dimension
          if (rawMeta.dimension === 384 && (rawMeta.model_id === 'Xenova/multilingual-e5-small' || rawMeta.model === 'Xenova/multilingual-e5-small')) {
            cachedMeta = rawMeta;
            cachedNodeBuffer = fs.readFileSync(binPath);
          } else if (rawMeta.dimension === 768) {
            // Ancien index conservé mais ignoré pour les recherches vectorielles E5
            console.info('[ExposeDocumentService] Ancien index 768D détecté et ignoré au profit de E5 384D.');
          }
        }
      }

      if (cachedMeta && cachedNodeBuffer) {
        const chunkMap = new Map<string, SermonChunk>();
        for (const c of chunks) {
          if (!c.embedding || c.embedding.length === 0) chunkMap.set(c.chunkId, c);
        }

        for (const item of cachedMeta.chunks) {
          const chunk = chunkMap.get(item.chunkId);
          if (chunk && item.length === 384) {
            chunk.embedding = new Int8Array(cachedNodeBuffer.buffer, cachedNodeBuffer.byteOffset + item.offset, item.length);
          }
        }
        return;
      }
    }

    // Mode Navigateur Web / SPA / Electron Renderer
    if (typeof window !== 'undefined' && typeof fetch !== 'undefined') {
      if (!cachedMeta || !cachedArrayBuf) {
        const safeFetch = async (url: string): Promise<Response | null> => {
          try {
            const res = await fetch(url);
            return res && res.ok ? res : null;
          } catch {
            return null;
          }
        };

        const fetchFirstWorking = async (urls: string[]): Promise<Response | null> => {
          for (const u of urls) {
            const res = await safeFetch(u);
            if (res) return res;
          }
          return null;
        };

        const loc = window.location;
        const baseUrl = loc ? loc.origin + loc.pathname.replace(/\/[^\/]*$/, '/') : './';

        const metaCandidates = [
          baseUrl + 'corpus_embeddings_384d_meta.json',
          './corpus_embeddings_384d_meta.json',
          'corpus_embeddings_384d_meta.json',
          '/corpus_embeddings_384d_meta.json',
          baseUrl + 'corpus_embeddings_meta.json',
          './corpus_embeddings_meta.json',
          'corpus_embeddings_meta.json',
          '/corpus_embeddings_meta.json'
        ];

        const binCandidates = [
          baseUrl + 'corpus_embeddings_384d.bin',
          './corpus_embeddings_384d.bin',
          'corpus_embeddings_384d.bin',
          '/corpus_embeddings_384d.bin',
          baseUrl + 'corpus_embeddings_768d.bin',
          './corpus_embeddings_768d.bin',
          'corpus_embeddings_768d.bin',
          '/corpus_embeddings_768d.bin'
        ];

        const metaRes = await fetchFirstWorking(metaCandidates);
        const binRes = await fetchFirstWorking(binCandidates);

        if (metaRes && binRes) {
          const rawMeta = await metaRes.json();
          if (rawMeta.dimension === 384 && (rawMeta.model_id === 'Xenova/multilingual-e5-small' || rawMeta.model === 'Xenova/multilingual-e5-small')) {
            cachedMeta = rawMeta;
            cachedArrayBuf = await binRes.arrayBuffer();
          }
        }
      }

      if (cachedMeta && cachedArrayBuf) {
        const chunkMap = new Map<string, SermonChunk>();
        for (const c of chunks) {
          if (!c.embedding || c.embedding.length === 0) chunkMap.set(c.chunkId, c);
        }

        for (const item of cachedMeta.chunks) {
          const chunk = chunkMap.get(item.chunkId);
          if (chunk && item.length === 384) {
            chunk.embedding = new Int8Array(cachedArrayBuf, item.offset, item.length);
          }
        }
      }
    }
  } catch (err) {
    console.warn('[ExposeDocumentService] Hydratation des embeddings précalculés ignorée:', err);
  }
}

/**
 * Retourne le texte concaténé de tout l'Exposé pour l'évaluation d'Answerability.
 */
export async function getExposeCorpusTextIndex(): Promise<string> {
  const sermons = await loadExposeAsSermons();
  return sermons.map(s => s.text).join(' ');
}

// Mots vides généraux pour l'extraction de termes de recherche
const EXPOSE_STOP_WORDS = new Set([
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'd', 'au', 'aux',
  'et', 'ou', 'mais', 'donc', 'or', 'ni', 'car', 'que', 'qui', 'quoi', 'dont',
  'a', 'dans', 'en', 'par', 'pour', 'sur', 'sous', 'vers', 'avec', 'sans', 'chez',
  'ce', 'cet', 'cette', 'ces', 'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'son', 'sa', 'ses',
  'notre', 'votre', 'leur', 'nos', 'vos', 'leurs',
  'je', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles',
  'me', 'te', 'se', 'lui', 'y',
  'est', 'sont', 'ete', 'etre', 'suis', 'es', 'sommes', 'etes',
  'ont', 'ai', 'as', 'avons', 'avez', 'avait', 'avaient', 'avoir',
  'fait', 'faire', 'fais', 'font', 'dis', 'dit', 'disent', 'dire', 'parle', 'parlent', 'parler',
  'selon', 'comme', 'comment', 'pourquoi', 'quand', 'quel', 'quelle', 'quels', 'quelles',
  'tout', 'tous', 'toute', 'toutes', 'plus', 'moins', 'tres', 'bien', 'aussi', 'alors',
  'si', 'ne', 'pas', 'point', 'non', 'oui', 'peut', 'peuvent', 'pouvoir',
  'apres'
]);

// Termes structurels du conteneur documentaire "Exposé" à filtrer pour éviter la dilution lexicale
const EXPOSE_CONTAINER_TERMS = new Set(['expose', 'sept', 'ages', 'age', 'livre', 'chapitre']);

/**
 * Extrait les termes significatifs pour la recherche lexicale dans l'Exposé,
 * en éliminant les mots vides et les termes redondants liés au conteneur lui-même.
 */
export function extractExposeLexicalQueryTerms(query: string): string[] {
  if (!query || typeof query !== 'string') return [];
  const normalized = normalizeText(query);
  const words = normalized
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2);

  const nonStopWords = words.filter(w => !EXPOSE_STOP_WORDS.has(w));
  // Filtre les termes du conteneur ("exposé", "sept", "âges", "livre") SAUF si la requête ne contient que ceux-là
  const substantiveWords = nonStopWords.filter(w => !EXPOSE_CONTAINER_TERMS.has(w));

  if (substantiveWords.length > 0) {
    return Array.from(new Set(substantiveWords));
  }
  if (nonStopWords.length > 0) {
    return Array.from(new Set(nonStopWords));
  }
  return Array.from(new Set(words));
}

/**
 * Recherche lexicale haute précision (BM25 / scoring textuel) sur les paragraphes de l'Exposé.
 */
export async function searchExposeLexicalForRag(
  query: string,
  options: { topK?: number; minScore?: number } = {}
): Promise<Array<{ sermonId: string; paragraphIndex: number; score: number; text: string }>> {
  const cleanQuery = (query || '').trim();
  if (!cleanQuery) return [];

  const docs = await loadExposeAsCanonicalDocuments();
  const topK = options.topK || 40;
  const minScore = options.minScore || 5;

  const normalizedQuery = normalizeText(cleanQuery);
  const queryTerms = extractExposeLexicalQueryTerms(cleanQuery);

  if (queryTerms.length === 0) return [];

  const scoredParagraphs: Array<{
    sermonId: string;
    paragraphIndex: number;
    score: number;
    text: string;
  }> = [];

  for (const doc of docs) {
    for (const p of doc.paragraphs) {
      const normText = normalizeText(p.text);
      let matchCount = 0;
      let score = 0;

      for (const term of queryTerms) {
        if (normText.includes(term)) {
          matchCount++;
          // Term frequency bonus
          const occurrences = normText.split(term).length - 1;
          score += 15 + Math.min(occurrences * 5, 25);
        }
      }

      // Bonus si phrase exacte présente
      if (normText.includes(normalizedQuery)) {
        score += 50;
      }

      // Bonus si titre de section correspond
      if (p.sectionTitle) {
        const normSec = normalizeText(p.sectionTitle);
        for (const term of queryTerms) {
          if (normSec.includes(term)) score += 20;
        }
      }

      if (matchCount > 0 && score >= minScore) {
        // Bonus proportionnel au ratio de termes retrouvés
        const termRatio = matchCount / queryTerms.length;
        score = score * (0.4 + 0.6 * termRatio);

        scoredParagraphs.push({
          sermonId: doc.documentId,
          paragraphIndex: p.paragraphIndex,
          score: Math.round(score * 10) / 10,
          text: p.text
        });
      }
    }
  }

  scoredParagraphs.sort((a, b) => b.score - a.score);
  return scoredParagraphs.slice(0, topK);
}

/**
 * Options d'exécution du pipeline Auto-RAG sur l'Exposé.
 */
export interface ExposeRagPipelineOptions {
  apiKey?: string;
  topK?: number;
  maxEvidenceCount?: number;
  mockVectorHits?: any[];
}

/**
 * Exécute le pipeline complet RAG sur le corpus de l'Exposé :
 * Question → Lexical + Vectoriel → RRF (k=60) → Reranking → Answerability → Evidence Package.
 */
export async function executeExposeRagPipeline(
  query: string,
  options: ExposeRagPipelineOptions = {}
): Promise<RetrievalEvidencePackage> {
  const cleanQuery = (query || '').trim();
  if (!cleanQuery) {
    return {
      answerable: false,
      confidenceScore: 0,
      reason: 'Requête vide.',
      evidence: [],
      query: cleanQuery,
      totalCandidates: 0,
      rejectedCount: 0
    };
  }

  const [exposeSermons, exposeChunks, corpusTextIndex] = await Promise.all([
    loadExposeAsSermons(),
    createExposeDocumentChunks(),
    getExposeCorpusTextIndex()
  ]);

  // 1. Récupération lexicale
  const lexicalMatches = await searchExposeLexicalForRag(cleanQuery, { topK: 40 });
  const lexicalHits = mapParagraphsToChunkHits(lexicalMatches, exposeChunks);

  // 2. Récupération vectorielle
  let vectorHits: any[] = options.mockVectorHits || [];
  const apiKey = options.apiKey || getGeminiApiKey();

  if (!options.mockVectorHits && apiKey) {
    try {
      const searchRes = await searchByText(cleanQuery, exposeChunks, apiKey, {
        topK: options.topK || 20,
        minScoreThreshold: 0.1
      });
      vectorHits = searchRes?.results || [];
    } catch (vecErr) {
      console.warn('[ExposeRAG] Recherche vectorielle indisponible, repli lexical contrôlé:', vecErr);
    }
  }

  // 3. Fusion RRF (k=60)
  const hybridResults: HybridSearchResult[] = fuseRankings({
    lexicalHits,
    vectorHits,
    allChunks: exposeChunks,
    options: {
      k: 60,
      topK: options.topK || 15
    }
  });

  if (hybridResults.length === 0) {
    return {
      answerable: false,
      confidenceScore: 0,
      reason: "Aucun passage pertinent retrouvé dans l'Exposé des Sept Âges.",
      evidence: [],
      query: cleanQuery,
      totalCandidates: 0,
      rejectedCount: 0
    };
  }

  // 4. Reranking local multi-signaux
  const rerankedResults: RerankedSearchResult[] = rerankHybridResults({
    query: cleanQuery,
    hybridResults,
    options: {
      topK: options.maxEvidenceCount ? options.maxEvidenceCount * 2 : 10
    }
  });

  // 5. Answerability
  const assessment: AnswerabilityAssessment = assessAnswerability({
    query: cleanQuery,
    candidates: rerankedResults,
    corpusTextIndex
  });

  // 6. Evidence Package
  const evidencePackage = buildRetrievalEvidencePackage({
    query: cleanQuery,
    candidates: rerankedResults,
    assessment,
    originalSermons: exposeSermons,
    maxEvidenceCount: options.maxEvidenceCount || 5
  });

  return evidencePackage;
}
