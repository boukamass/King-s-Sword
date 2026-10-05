/**
 * King's Sword — Unified RAG & AI Context Service (Phase 2F.12C)
 * 
 * Moteur de Retrieval RAG unifié multi-ressources sous contrainte stricte de l'AI Context :
 * - Ressources supportées : Sermons, Exposé, Bible, Chants.
 * - Règle absolue : L'Assistant IA ne recherche QUE dans les sources explicitement
 *   sélectionnées par l'utilisateur (AI Context). Aucune fuite ni élargissement silencieux.
 * - Granularités supportées : document entier, chapitre, page, verset, paragraphe ou plage.
 * - Answerability évaluée STRICTEMENT par rapport au sous-ensemble sélectionné.
 * - Pipeline unifié : BM25 + Vectoriel -> RRF (k=60) -> Reranking -> Answerability -> Evidence Package.
 */

import { 
  DocumentSourceType, 
  AIContext, 
  AIContextSource, 
  AIContextUnit,
  Sermon, 
  SermonChunk, 
  HybridSearchResult,
  RerankedSearchResult,
  AnswerabilityAssessment,
  RetrievalEvidencePackage,
  RetrievalEvidence,
  EvidenceParagraphCitation
} from '../types';
import { BibleVersion } from '../types/bible';
import { BIBLE_BOOKS_META } from './bibleMetadata';
import { getBibleChapterVerses } from './bibleService';
import { loadAllSongs, getSongAsSermon } from './songService';
import { loadExposeAsCanonicalDocuments, createExposeDocumentChunks } from './exposeDocumentService';
import { createSermonChunks } from './chunkingService';
import { getSermonById } from './db';
import { mapParagraphsToChunkHits, fuseRankings } from './hybridRetrievalService';
import { rerankHybridResults, assessAnswerability, extractSignificantQueryTerms, extractSubstantiveQueryTerms, isOverviewOrSummaryQuery } from './rerankingService';
import { expandTheologicalQuery } from './theologicalQueryService';
import { searchByVector, embedQueryText } from './vectorSearchService';
import { getChunksBySermonId } from './chunkStorageService';
import { getGeminiApiKey } from '../utils/apiKeyHelper';
import { normalizeText, splitSermonIntoParagraphs, extractLeadingParagraphNumber } from '../utils/textUtils';

// Mots vides généraux pour l'analyse lexicale
const UNIFIED_STOP_WORDS = new Set([
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
  'selon', 'comme', 'comment', 'pourquoi', 'quand', 'lorsque', 'quel', 'quelle', 'quels', 'quelles',
  'tout', 'tous', 'toute', 'toutes', 'plus', 'moins', 'tres', 'bien', 'aussi', 'alors',
  'si', 'ne', 'pas', 'point', 'non', 'oui', 'peut', 'peuvent', 'pouvoir',
  'apres'
]);

// Termes structurels des conteneurs documentaires à filtrer lors de la recherche ciblée
const CONTAINER_STOP_WORDS = new Set([
  'sermon', 'sermons', 'message', 'branham', 'william', 'frere', 'brother',
  'expose', 'sept', 'ages', 'age', 'livre', 'chapitre',
  'bible', 'verset', 'versets', 'cantique', 'chant', 'chanson'
]);

export interface UnifiedRagOptions {
  topK?: number;
  maxEvidenceCount?: number;
  k?: number; // constante RRF, défaut 60
  vectorWeight?: number;
  lexicalWeight?: number;
  rrfWeight?: number;
  multiModalBonus?: number;
  bibleVersion?: BibleVersion;
  mockVectorHits?: any[];
  loadedSermonsMap?: Map<string, Sermon | Omit<Sermon, 'text'>> | Map<string, any>;
  apiKey?: string;
  queryVector?: number[] | Float32Array;
}

/**
 * Parse un identifiant textuel ou un objet en AIContextSource canonique.
 */
export function parseContextSourceString(idOrObj: string | AIContextSource): AIContextSource {
  if (typeof idOrObj !== 'string') {
    return idOrObj;
  }

  const raw = idOrObj.trim();

  // 1. Bible (ex: bible-jhn-3, bible-jhn-3-16, bible-mat-5)
  if (raw.startsWith('bible-')) {
    const parts = raw.split('-');
    const bookId = parts[1]?.toUpperCase() || 'GEN';
    const chapterStr = parts[2] || '1';
    const verseStr = parts[3];

    const meta = BIBLE_BOOKS_META.find(b => b.id.toUpperCase() === bookId.toUpperCase());
    const bookName = meta ? meta.name : bookId;

    if (verseStr) {
      const verseNum = parseInt(verseStr, 10);
      return {
        sourceType: 'bible',
        sourceId: `bible-${bookId.toLowerCase()}-${chapterStr}`,
        title: `${bookName} ${chapterStr}:${verseNum}`,
        selectedUnit: { type: 'verse', id: verseNum, verse: verseNum },
        allowedVerses: [verseNum]
      };
    }

    return {
      sourceType: 'bible',
      sourceId: `bible-${bookId.toLowerCase()}-${chapterStr}`,
      title: chapterStr === 'all' ? `${bookName} (Livre entier)` : `${bookName} ${chapterStr}`,
      selectedUnit: { type: 'chapter', id: chapterStr }
    };
  }

  // 2. Exposé Chapitre (ex: expose-ch-8, expose-ch-1)
  if (raw.startsWith('expose-ch-')) {
    const ch = raw.replace('expose-ch-', '');
    return {
      sourceType: 'expose',
      sourceId: raw,
      title: `Exposé - Chapitre ${ch}`,
      selectedUnit: { type: 'chapter', id: ch }
    };
  }

  // 3. Exposé Page (ex: expose-pg-15)
  if (raw.startsWith('expose-pg-')) {
    const pg = parseInt(raw.replace('expose-pg-', ''), 10);
    return {
      sourceType: 'expose',
      sourceId: raw,
      title: `Exposé - Page ${pg}`,
      selectedUnit: { type: 'page', id: pg }
    };
  }

  // 4. Chant (ex: song-1, song-12)
  if (raw.startsWith('song-')) {
    const sId = raw.replace('song-', '');
    return {
      sourceType: 'song',
      sourceId: raw,
      title: `Cantique #${sId}`,
      selectedUnit: { type: 'document', id: sId }
    };
  }

  // 5. Sermon standard (ex: 63-0324M, 65-1212)
  return {
    sourceType: 'sermon',
    sourceId: raw,
    title: raw,
    selectedUnit: { type: 'document', id: raw }
  };
}

/**
 * Normalise l'AI Context en structure unifiée.
 */
export function normalizeAIContext(context: AIContext | (string | AIContextSource)[] | null | undefined): AIContext {
  if (!context) {
    return { sources: [] };
  }
  if ('sources' in context && Array.isArray(context.sources)) {
    return {
      sources: context.sources.map(s => typeof s === 'string' ? parseContextSourceString(s) : s)
    };
  }
  if (Array.isArray(context)) {
    return {
      sources: context.map(item => parseContextSourceString(item))
    };
  }
  return { sources: [] };
}

/**
 * Extrait les termes significatifs pour le retrieval unifié, avec filtrage
 * des conteneurs documentaires SAUF si la requête ne contient que ceux-là.
 */
export function extractUnifiedQueryTerms(query: string): string[] {
  if (!query || typeof query !== 'string') return [];
  const normalized = normalizeText(query);
  const words = normalized
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2);

  const nonStop = words.filter(w => !UNIFIED_STOP_WORDS.has(w));
  const substantive = nonStop.filter(w => !CONTAINER_STOP_WORDS.has(w));

  if (substantive.length > 0) return Array.from(new Set(substantive));
  if (nonStop.length > 0) return Array.from(new Set(nonStop));
  return Array.from(new Set(words));
}

/**
 * Résout et génère les chunks autorisés pour l'ensemble des sources sélectionnées dans l'AI Context.
 * STRICTEMENT AUCUN chunk en dehors de cet AI Context ne sera généré ni retourné.
 */
export async function resolveAIContextChunks(
  aiContext: AIContext,
  options: { bibleVersion?: BibleVersion; loadedSermonsMap?: Map<string, Sermon | Omit<Sermon, 'text'>> | Map<string, any> } = {}
): Promise<SermonChunk[]> {
  const sources = aiContext.sources || [];
  if (sources.length === 0) return [];

  const chunks: SermonChunk[] = [];
  const bibleVersion = options.bibleVersion || 'lsg1910';

  for (const src of sources) {
    // -------------------------------------------------------------
    // 1. SERMON
    // -------------------------------------------------------------
    if (src.sourceType === 'sermon') {
      let sermon: Sermon | null = null;
      const cleanSourceId = src.sourceId;

      // 1. Recherche par ID exact dans la map chargée
      if (options.loadedSermonsMap && options.loadedSermonsMap.has(cleanSourceId)) {
        const candidate = options.loadedSermonsMap.get(cleanSourceId);
        if (candidate && typeof (candidate as any).text === 'string' && (candidate as any).text.length > 0) {
          sermon = candidate as Sermon;
        }
      }

      // 2. Recherche par ID de base (sans suffixe de version) dans la map chargée
      if (!sermon && options.loadedSermonsMap) {
        const baseId = cleanSourceId.split('-').slice(0, 2).join('-');
        for (const [key, value] of options.loadedSermonsMap.entries()) {
          const keyBase = key.split('-').slice(0, 2).join('-');
          if (keyBase === baseId && value && typeof (value as any).text === 'string' && (value as any).text.length > 0) {
            sermon = value as Sermon;
            break;
          }
        }
      }

      // 3. Recherche par ID exact dans la base de données
      if (!sermon || !sermon.text) {
        sermon = await getSermonById(cleanSourceId);
      }

      // 4. Recherche par ID de base dans la base de données
      if (!sermon || !sermon.text) {
        const baseId = cleanSourceId.split('-').slice(0, 2).join('-');
        sermon = await getSermonById(baseId);
      }

      // Fallback Web browser / Node.js static library.json
      if (!sermon || !sermon.text) {
        try {
          if (typeof window !== 'undefined') {
            const res = await fetch('/library.json');
            if (res.ok) {
              const lib: Sermon[] = await res.json();
              const baseId = cleanSourceId.split('-').slice(0, 2).join('-');
              const found = lib.find(s => s.id === cleanSourceId || s.id === baseId || (s.version && `${s.id}-${s.version}` === cleanSourceId));
              if (found && found.text) sermon = found;
            }
          } else {
            const fs = await import('fs');
            const path = await import('path');
            const candidates = [
              path.resolve('public/library.json'),
              path.resolve('dist/library.json'),
              path.resolve('../public/library.json')
            ];
            for (const cand of candidates) {
              if (fs.existsSync(cand)) {
                const lib: Sermon[] = JSON.parse(fs.readFileSync(cand, 'utf8'));
                const baseId = cleanSourceId.split('-').slice(0, 2).join('-');
                const found = lib.find(s => s.id === cleanSourceId || s.id === baseId || (s.version && `${s.id}-${s.version}` === cleanSourceId));
                if (found && found.text) {
                  sermon = found;
                  break;
                }
              }
            }
          }
        } catch {}
      }

      if (sermon && sermon.text) {
        const sermonChunks = createSermonChunks(sermon);
        try {
          const stored = await getChunksBySermonId(cleanSourceId);
          if (stored && stored.length > 0) {
            const embMap = new Map(stored.filter(s => Array.isArray(s.embedding) && s.embedding.length > 0).map(s => [s.chunkId, s.embedding]));
            for (const c of sermonChunks) {
              const foundEmb = embMap.get(c.chunkId);
              if (foundEmb) c.embedding = foundEmb;
            }
          }
        } catch {}

        for (const c of sermonChunks) {
          c.documentType = 'sermon';
          c.documentId = cleanSourceId; // Conserve l'ID sélectionné par l'utilisateur (avec suffixe) pour la synchronisation de l'IHM
          c.sermonId = cleanSourceId;
          
          // Filtrage granulaire par paragraphes autorisés si spécifié
          if (Array.isArray(src.allowedParagraphIds) && src.allowedParagraphIds.length > 0) {
            const hasOverlap = c.paragraphIds.some(pid => src.allowedParagraphIds!.includes(pid));
            if (!hasOverlap) continue;
          }

          chunks.push(c);
        }
      }
    }

    // -------------------------------------------------------------
    // 2. EXPOSÉ
    // -------------------------------------------------------------
    else if (src.sourceType === 'expose') {
      const allExposeChunks = await createExposeDocumentChunks();
      try {
        const stored = await getChunksBySermonId(src.sourceId);
        if (stored && stored.length > 0) {
          const embMap = new Map(stored.filter(s => Array.isArray(s.embedding) && s.embedding.length > 0).map(s => [s.chunkId, s.embedding]));
          for (const c of allExposeChunks) {
            const foundEmb = embMap.get(c.chunkId);
            if (foundEmb) c.embedding = foundEmb;
          }
        }
      } catch {}
      
      for (const c of allExposeChunks) {
        // Filtrage par chapitre (ex: expose-ch-8 ou ch "8")
        if (src.selectedUnit?.type === 'chapter' && src.selectedUnit.id) {
          const expectedCh = String(src.selectedUnit.id);
          const chunkCh = String(c.chapterNumber || c.sermonId.replace('expose-ch-', ''));
          if (chunkCh !== expectedCh && c.sermonId !== `expose-ch-${expectedCh}`) continue;
        } else if (src.sourceId && src.sourceId.startsWith('expose-ch-')) {
          if (c.sermonId !== src.sourceId) continue;
        }

        // Filtrage par page (ex: expose-pg-15)
        if (src.selectedUnit?.type === 'page' && src.selectedUnit.id) {
          const pgTarget = Number(src.selectedUnit.id);
          const pStart = c.metadata?.page_start;
          const pEnd = c.metadata?.page_end;
          if (typeof pStart === 'number' && typeof pEnd === 'number') {
            if (pgTarget < pStart || pgTarget > pEnd) continue;
          }
        }

        // Filtrage granulaire par paragraphes
        if (Array.isArray(src.allowedParagraphIds) && src.allowedParagraphIds.length > 0) {
          const hasOverlap = c.paragraphIds.some(pid => src.allowedParagraphIds!.includes(pid));
          if (!hasOverlap) continue;
        }

        chunks.push(c);
      }
    }

    // -------------------------------------------------------------
    // 3. BIBLE
    // -------------------------------------------------------------
    else if (src.sourceType === 'bible') {
      const rawId = src.sourceId; // e.g. bible-jhn-3
      const parts = rawId.split('-');
      const bookId = parts[1]?.toUpperCase() || 'GEN';
      const chapter = parseInt(parts[2] || '1', 10) || 1;

      const meta = BIBLE_BOOKS_META.find(b => b.id.toUpperCase() === bookId.toUpperCase());
      const bookName = meta ? meta.name : bookId;
      const verses = await getBibleChapterVerses(bookId, chapter, bibleVersion);

      if (Array.isArray(verses) && verses.length > 0) {
        for (const v of verses) {
          // Filtrage granulaire par verset si spécifié
          if (Array.isArray(src.allowedVerses) && src.allowedVerses.length > 0) {
            if (!src.allowedVerses.includes(v.verse)) continue;
          } else if (src.selectedUnit?.type === 'verse' && typeof src.selectedUnit.verse === 'number') {
            if (v.verse !== src.selectedUnit.verse) continue;
          }

          chunks.push({
            chunkId: `bible-${bookId.toLowerCase()}-${chapter}_v${v.verse}`,
            sermonId: `bible-${bookId.toLowerCase()}-${chapter}`,
            documentId: `bible-${bookId.toLowerCase()}-${chapter}`,
            documentType: 'bible',
            paragraphIds: [v.verse],
            startParagraph: v.verse,
            endParagraph: v.verse,
            text: v.text,
            sermonTitle: `${bookName} ${chapter}`,
            chapterTitle: `${bookName} ${chapter}`,
            chapterNumber: String(chapter),
            characterCount: v.text.length,
            wordCount: v.text.split(/\s+/).filter(Boolean).length,
            metadata: {
              bookId,
              bookName,
              chapter,
              verse: v.verse,
              testament: meta?.testament || 'NT'
            }
          });
        }
      }
    }

    // -------------------------------------------------------------
    // 4. CHANT
    // -------------------------------------------------------------
    else if (src.sourceType === 'song') {
      const sId = src.sourceId.replace('song-', '');
      const allSongs = await loadAllSongs();
      let song = allSongs.find(s => String(s.id) === sId);

      if (!song) {
        const asSermon = await getSongAsSermon(src.sourceId);
        if (asSermon) {
          song = {
            id: sId,
            title: asSermon.title,
            content: asSermon.text
          };
        }
      }

      if (song && song.content) {
        const stanzas = song.content.split(/\n\s*\n/).filter(st => st.trim().length > 0);
        
        stanzas.forEach((stanza, sIdx) => {
          const pIndex = sIdx + 1;
          if (Array.isArray(src.allowedParagraphIds) && src.allowedParagraphIds.length > 0) {
            if (!src.allowedParagraphIds.includes(pIndex)) return;
          }

          chunks.push({
            chunkId: `song-${song.id}_p${pIndex}`,
            sermonId: `song-${song.id}`,
            documentId: `song-${song.id}`,
            documentType: 'song',
            paragraphIds: [pIndex],
            startParagraph: pIndex,
            endParagraph: pIndex,
            text: stanza.trim(),
            sermonTitle: song.title.startsWith(`${song.id}.`) ? song.title : `${song.id}. ${song.title}`,
            chapterTitle: song.title,
            characterCount: stanza.length,
            wordCount: stanza.split(/\s+/).filter(Boolean).length,
            metadata: {
              songId: song.id,
              language: song.language || 'fr'
            }
          });
        });
      }
    }
  }

  return chunks;
}

/**
 * Construit la citation formatée canonique pour un paragraphe/verset donné.
 */
export function formatUnitCitation(chunk: Partial<SermonChunk> & { sermonId: string }, paragraphIndex: number): string {
  const docType = chunk.documentType || 'sermon';
  
  if (docType === 'bible') {
    const bookName = chunk.metadata?.bookName || chunk.sermonTitle || 'Bible';
    const ch = chunk.metadata?.chapter || chunk.chapterNumber || 1;
    return `[Réf: ${bookName} ${ch}:${paragraphIndex}]`;
  }
  
  if (docType === 'expose') {
    return `[Réf: ${chunk.sermonId}, §${paragraphIndex}]`;
  }
  
  if (docType === 'song') {
    return `[Réf: Song-${chunk.metadata?.songId || chunk.sermonId.replace('song-', '')}, §${paragraphIndex}]`;
  }
  
  // Sermon
  return `[Réf: ${chunk.sermonId}, §${paragraphIndex}]`;
}

/**
 * Exécute le pipeline Unified RAG contraint par l'AI Context.
 */
export async function executeUnifiedRagPipeline(
  query: string,
  contextInput: AIContext | (string | AIContextSource)[],
  options: UnifiedRagOptions = {}
): Promise<RetrievalEvidencePackage> {
  const cleanQuery = (query || '').trim();
  const aiContext = normalizeAIContext(contextInput);
  const topK = options.topK || 10;
  const maxEvidenceCount = options.maxEvidenceCount || 5;

  // 1. Résolution stricte des chunks de l'AI Context
  const allowedChunks = await resolveAIContextChunks(aiContext, {
    bibleVersion: options.bibleVersion,
    loadedSermonsMap: options.loadedSermonsMap
  });

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

  if (allowedChunks.length === 0) {
    return {
      answerable: false,
      confidenceScore: 0,
      reason: 'Aucune ressource disponible dans le contexte IA sélectionné.',
      evidence: [],
      query: cleanQuery,
      totalCandidates: 0,
      rejectedCount: 0
    };
  }

  // Concaténation du texte intégral du contexte actif pour l'évaluation d'Answerability
  const contextCorpusText = allowedChunks.map(c => c.text).join(' ');

  // Expansion doctrinale & décomposition Multi-Hop
  const queryExpansion = await expandTheologicalQuery(cleanQuery, options.apiKey);
  const effectiveQuery = queryExpansion.expandedQuery || cleanQuery;
  const queryTerms = extractUnifiedQueryTerms(effectiveQuery);
  const normalizedQuery = normalizeText(cleanQuery);
  const queryWords = normalizedQuery.split(/\s+/).filter(w => w.length > 2);

  // Termes additionnels issus des sous-requêtes multi-hop
  if (queryExpansion.isMultiHop && queryExpansion.subQueries.length > 1) {
    for (const sq of queryExpansion.subQueries) {
      for (const t of extractUnifiedQueryTerms(sq)) {
        if (!queryTerms.includes(t)) queryTerms.push(t);
      }
    }
  }

  // Bigrammes de la requête pour détecter les syntagmes doctrinaux précis
  const bigrams: string[] = [];
  for (let i = 0; i < queryWords.length - 1; i++) {
    bigrams.push(queryWords[i] + ' ' + queryWords[i + 1]);
  }

  // 2. Recherche lexicale (BM25 / term match) STRICTEMENT sur les chunks autorisés
  const scoredChunks: Array<{ chunk: SermonChunk; score: number }> = [];
  for (const chunk of allowedChunks) {
    const normText = normalizeText(chunk.text);
    let matchCount = 0;
    let score = 0;

    for (const term of queryTerms) {
      if (normText.includes(term)) {
        matchCount++;
        const occurrences = normText.split(term).length - 1;
        score += 20 + Math.min(occurrences * 8, 40);
      }
    }

    let bigramMatches = 0;
    for (const bg of bigrams) {
      if (normText.includes(bg)) {
        bigramMatches++;
        score += 35;
      }
    }

    if (normText.includes(normalizedQuery)) {
      score += 50;
    }

    if (chunk.sectionTitle || chunk.sermonTitle) {
      const normTitle = normalizeText(chunk.sectionTitle || chunk.sermonTitle);
      for (const term of queryTerms) {
        if (normTitle.includes(term)) score += 20;
      }
    }

    if (matchCount > 0 && score >= 5) {
      const termRatio = matchCount / Math.max(1, queryTerms.length);
      score = score * (0.3 + 0.7 * termRatio);
      scoredChunks.push({
        chunk,
        score: Math.round(score * 10) / 10
      });
    }
  }

  scoredChunks.sort((a, b) => b.score - a.score);
  const lexicalHits = scoredChunks.slice(0, 40).map((item, idx) => ({
    chunkId: item.chunk.chunkId,
    rank: idx + 1,
    score: item.score,
    matchedParagraphIds: item.chunk.paragraphIds
  }));

  // 3. Recherche vectorielle / sémantique STRICTEMENT sur les chunks autorisés
  let vectorHits: Array<{ chunk: SermonChunk; score: number; rank: number }> = [];
  let vectorMethod: 'cosine_768d_int8' | 'cosine_768d_float32' | 'cosine_3072d' | 'deterministic_overlap' = 'deterministic_overlap';

  if (Array.isArray(options.mockVectorHits) && options.mockVectorHits.length > 0) {
    const allowedIds = new Set(allowedChunks.map(c => c.chunkId));
    vectorHits = options.mockVectorHits.filter(h => allowedIds.has(h.chunk?.chunkId));
    vectorMethod = 'cosine_3072d';
  } else {
    // 3A. VRAI VECTOR RETRIEVAL (768D Int8/Float32 ou 3072D Float32)
    const chunksWithEmbeddings = allowedChunks.filter(c => 
      (Array.isArray(c.embedding) && (c.embedding.length === 768 || c.embedding.length === 3072)) ||
      (c.embedding instanceof Float32Array && (c.embedding.length === 768 || c.embedding.length === 3072)) ||
      (c.embedding instanceof Int8Array && c.embedding.length === 768)
    );
    const activeApiKey = options.apiKey || (typeof window !== 'undefined' ? getGeminiApiKey() : '') || process.env.API_KEY || '';

    let vectorSearchSuccess = false;

    if (chunksWithEmbeddings.length > 0 && (options.queryVector || activeApiKey)) {
      try {
        let qVec: number[] | Float32Array | Int8Array | null = options.queryVector || null;
        const sampleEmb = chunksWithEmbeddings[0].embedding;
        const targetDim = sampleEmb ? sampleEmb.length : 768;

        if (!qVec && activeApiKey) {
          qVec = await embedQueryText(cleanQuery, activeApiKey, {
            dimension: targetDim,
            taskType: 'RETRIEVAL_QUERY'
          });
        }

        if (qVec && (qVec.length === 768 || qVec.length === 3072)) {
          const vecResults = searchByVector(qVec, chunksWithEmbeddings, {
            topK: 20
          });
          if (vecResults.length > 0) {
            vectorHits = vecResults.map((item, idx) => ({
              chunk: item.chunk,
              score: item.score,
              rank: idx + 1
            }));
            vectorSearchSuccess = true;
            const isInt8 = chunksWithEmbeddings[0].embedding instanceof Int8Array;
            vectorMethod = isInt8 ? 'cosine_768d_int8' : (qVec.length === 768 ? 'cosine_768d_float32' : 'cosine_3072d');
          }
        }
      } catch (err) {
        console.warn('[UnifiedRAG] Erreur appel embedding, repli déterministe immédiat:', err);
      }
    }

    // 3B. FALLBACK DÉTERMINISTE LOCAL (si pas d'embeddings précalculés, hors-ligne ou erreur API)
    if (!vectorSearchSuccess) {
      const normQ = cleanQuery.toLowerCase();
      const qWords = queryTerms.length > 0 ? queryTerms : normQ.split(/\s+/).filter(w => w.length > 3);
      vectorHits = allowedChunks
        .map((chunk) => {
          let sim = 0;
          const t = normalizeText(chunk.text);
          if (chunk.sectionTitle && normQ.includes(chunk.sectionTitle.toLowerCase())) sim += 0.20;
          if (chunk.sermonTitle && normQ.includes(chunk.sermonTitle.toLowerCase())) sim += 0.15;
          let wordMatches = 0;
          for (const w of qWords) {
            if (w.length > 2 && t.includes(w)) wordMatches++;
          }
          let bgMatches = 0;
          for (const bg of bigrams) {
            if (t.includes(bg)) bgMatches++;
          }
          const matchRatio = wordMatches / Math.max(1, qWords.length);
          sim += matchRatio * 0.60;
          if (bgMatches > 0) sim += 0.15 * Math.min(bgMatches, 2) * matchRatio;
          if (matchRatio >= 0.70) sim += 0.20;
          if (t.includes(normalizedQuery)) sim += 0.30;
          return { chunk, score: Math.min(1.0, Math.round(sim * 100) / 100) };
        })
        .filter(h => h.score > 0.1)
        .sort((a, b) => b.score - a.score)
        .slice(0, 20)
        .map((item, idx) => ({
          ...item,
          rank: idx + 1
        }));
      vectorMethod = 'deterministic_overlap';
    }
  }

  // 4. Fusion Hybride RRF (k=60)
  let hybridResults = fuseRankings({
    lexicalHits,
    vectorHits,
    allChunks: allowedChunks,
    options: { k: options.k || 60, topK: 20 }
  });

  // Cas spécial : Requête d'aperçu / synthèse ("de quoi ça parle", "résumé", etc.) ou absence de hit strict
  const isOverview = isOverviewOrSummaryQuery(cleanQuery);
  if ((isOverview || hybridResults.length === 0) && allowedChunks.length > 0) {
    if (hybridResults.length === 0) {
      // Sélection des chunks initiaux et représentatifs des ressources autorisées dans l'AI Context
      hybridResults = allowedChunks.slice(0, 15).map((chunk, idx) => ({
        chunkId: chunk.chunkId,
        sermonId: chunk.sermonId,
        sermonTitle: chunk.sermonTitle,
        paragraphIds: chunk.paragraphIds,
        startParagraph: chunk.startParagraph,
        endParagraph: chunk.endParagraph,
        text: chunk.text,
        date: chunk.date,
        city: chunk.city,
        version: chunk.version,
        lexicalRank: idx + 1,
        lexicalScore: Math.max(10, 50 - idx * 3),
        vectorRank: idx + 1,
        vectorScore: Math.max(0.6, 0.95 - idx * 0.03),
        rrfScore: 1.0 / (60 + idx + 1),
        rank: idx + 1,
        chunk
      }));
    }
  }

  // 5. Reranking local multi-signaux
  const rerankedResults = rerankHybridResults({
    query: cleanQuery,
    hybridResults,
    options: {
      topK,
      vectorWeight: options.vectorWeight,
      lexicalWeight: options.lexicalWeight,
      rrfWeight: options.rrfWeight,
      multiModalBonus: options.multiModalBonus
    }
  });

  // 6. Évaluation d'Answerability (STRICTEMENT par rapport au sous-ensemble contextuel)
  const assessment = assessAnswerability({
    query: cleanQuery,
    candidates: rerankedResults,
    corpusTextIndex: contextCorpusText
  });

  // 7. Construction du Retrieval Evidence Package
  const evidence: RetrievalEvidence[] = [];

  if (assessment.answerable && rerankedResults.length > 0) {
    for (const item of rerankedResults.slice(0, maxEvidenceCount)) {
      const chunk = item.chunk || item;
      const citationParagraphs: EvidenceParagraphCitation[] = [];

      for (const pNum of chunk.paragraphIds || [chunk.startParagraph]) {
        const formattedCitation = formatUnitCitation(chunk, pNum);
        const snippet = chunk.text.length > 220 ? chunk.text.slice(0, 220) + '...' : chunk.text;
        
        citationParagraphs.push({
          paragraphIndex: pNum,
          formattedCitation,
          textSnippet: snippet,
          isAuthentic: true
        });
      }

      evidence.push({
        chunkId: chunk.chunkId,
        sermonId: chunk.sermonId,
        sermonTitle: chunk.sermonTitle,
        paragraphIds: chunk.paragraphIds,
        startParagraph: chunk.startParagraph,
        endParagraph: chunk.endParagraph,
        text: chunk.text,
        date: chunk.date,
        city: chunk.city,
        version: chunk.version,
        retrievalScore: item.rerankScore,
        rank: item.rank,
        sourceType: 'reranked',
        citationParagraphs
      });
    }
  }

  if (process.env.NODE_ENV !== 'production' || typeof console !== 'undefined') {
    console.log('[RAG_DEV_DIAGNOSTIC]', JSON.stringify({
      query: cleanQuery,
      selectedSourcesCount: aiContext.sources.length,
      selectedSources: aiContext.sources.map(s => `${s.sourceType}:${s.sourceId}`),
      resolvedChunksCount: allowedChunks.length,
      lexicalHitsCount: lexicalHits.length,
      vectorHitsCount: vectorHits.length,
      vectorMethod,
      rrfHitsCount: hybridResults.length,
      rerankedHitsCount: rerankedResults.length,
      confidenceScore: assessment.confidenceScore,
      answerable: assessment.answerable,
      reason: assessment.reason,
      evidenceCount: evidence.length
    }, null, 2));
  }

  return {
    answerable: assessment.answerable,
    confidenceScore: assessment.confidenceScore,
    reason: assessment.reason,
    evidence,
    query: cleanQuery,
    totalCandidates: rerankedResults.length,
    rejectedCount: Math.max(0, rerankedResults.length - evidence.length),
    vectorMethod
  };
}
