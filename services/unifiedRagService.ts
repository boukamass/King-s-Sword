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

import { getStaticResourceUrl } from '../utils/fetchHelper';
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
  EvidenceParagraphCitation,
  MetadataFilter
} from '../types';
import { BibleVersion } from '../types/bible';
import { BIBLE_BOOKS_META } from './bibleMetadata';
import { getBibleChapterVerses } from './bibleService';
import { loadAllSongs, getSongAsSermon } from './songService';
import { loadExposeAsCanonicalDocuments, createExposeDocumentChunks, hydrateExposePrecalculatedEmbeddings } from './exposeDocumentService';
import { createSermonChunks } from './chunkingService';
import { getSermonById } from './db';
import { mapParagraphsToChunkHits, fuseRankings, computeAdaptiveHybridWeights } from './hybridRetrievalService';
import { rerankHybridResults, assessAnswerability, extractSignificantQueryTerms, extractSubstantiveQueryTerms, isOverviewOrSummaryQuery, isBroadOrExhaustiveContextQuery, selectDiverseEvidenceWithMMR } from './rerankingService';
import { expandTheologicalQuery } from './theologicalQueryService';
import { searchByVector, embedQueryText, matchesMetadataFilter } from './vectorSearchService';
import { getChunksBySermonId } from './chunkStorageService';
import { EMBEDDING_CONFIG, computeE5Embedding } from './embeddingService';
import { getGeminiApiKey } from '../utils/apiKeyHelper';
import { detectQueryIntent, logQueryIntent } from './queryIntentService';
import { normalizeText, splitSermonIntoParagraphs, extractLeadingParagraphNumber } from '../utils/textUtils';
import { isContentlessOrNoiseParagraph, computeBM25Score, getActiveCorpusVocabulary, buildCorpusVocabulary, searchBM25WithInvertedIndex, extractCompoundTheologicalTokens } from './corpusVocabularyService';
import { applyParentChildToEvidencePackage, buildAdjacentContextForEvidence, extractDocumentParagraphs, ParentChildOptions } from './parentChildService';
import { aiConfig } from '../config/aiConfig';

// Cache mémoire pour éviter de re-découper et re-hacher (SHA-1) les sermons à chaque requête
const sermonChunksMemoryCache = new Map<string, { textLen: number; chunks: SermonChunk[] }>();
let staticLibraryFallbackCache: Sermon[] | null = null;

/**
 * Découpe le texte d'un chunk multi-paragraphes afin que chaque numéro de paragraphe
 * dans citationParagraphs reçoive son propre texte exact (sans triplication).
 */
function buildCitationParagraphsForChunk(
  chunk: SermonChunk,
  seenParagraphKeys?: Set<string>
): EvidenceParagraphCitation[] {
  const pIds = Array.isArray(chunk.paragraphIds) && chunk.paragraphIds.length > 0
    ? chunk.paragraphIds
    : [chunk.startParagraph];
  const rawParts = (chunk.text || '').split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  const hasExactSplit = rawParts.length === pIds.length;

  const allCitations: EvidenceParagraphCitation[] = pIds.map((pNum, idx) => {
    const paraText = hasExactSplit ? rawParts[idx] : chunk.text;
    return {
      paragraphIndex: pNum,
      formattedCitation: formatUnitCitation(chunk, pNum),
      textSnippet: paraText,
      fullParagraphText: paraText,
      isAuthentic: true
    };
  });

  if (!seenParagraphKeys || allCitations.length <= 1) {
    for (const c of allCitations) {
      seenParagraphKeys?.add(`${chunk.sermonId}_${c.paragraphIndex}`);
    }
    return allCitations;
  }

  // Déduplique les paragraphes de chevauchement (overlap) déjà inclus par un chunk adjacent
  const filtered = allCitations.filter(c => !seenParagraphKeys.has(`${chunk.sermonId}_${c.paragraphIndex}`));
  const finalCitations = filtered.length > 0 ? filtered : [allCitations[0]];
  for (const c of finalCitations) {
    seenParagraphKeys.add(`${chunk.sermonId}_${c.paragraphIndex}`);
  }
  return finalCitations;
}

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
  providedChunks?: SermonChunk[];
  loadedSermonsMap?: Map<string, Sermon | Omit<Sermon, 'text'>> | Map<string, any>;
  apiKey?: string;
  queryVector?: number[] | Float32Array;
  metadataFilter?: MetadataFilter;
  enableParentChild?: boolean;
  parentChildOptions?: ParentChildOptions;
}

/**
 * Parse un identifiant textuel ou un objet en AIContextSource canonique.
 */
export function parseContextSourceString(idOrObj: string | AIContextSource): AIContextSource {
  if (typeof idOrObj !== 'string') {
    return idOrObj;
  }

  const raw = idOrObj.trim();

  // Détection du ciblage granulaire par paragraphe (-p-N)
  const pMatch = raw.match(/^(.*?)-p-(\d+)$/);
  const baseRaw = pMatch ? pMatch[1] : raw;
  const targetParaNum = pMatch ? parseInt(pMatch[2], 10) : undefined;

  // 1. Bible (ex: bible-jhn-3, bible-jhn-3-16, bible-jhn-3-p-16, bible-mat-5)
  if (baseRaw.startsWith('bible-')) {
    const parts = baseRaw.split('-');
    const bookId = parts[1]?.toUpperCase() || 'GEN';
    const chapterStr = parts[2] || '1';
    const verseStr = targetParaNum ? String(targetParaNum) : (parts[3] === 'p' ? parts[4] : parts[3]);

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

  // 2. Exposé Chapitre (ex: expose-ch-8, expose-ch-1, expose-ch-1-p-12)
  if (baseRaw.startsWith('expose-ch-')) {
    const ch = baseRaw.replace('expose-ch-', '');
    return {
      sourceType: 'expose',
      sourceId: baseRaw,
      title: targetParaNum ? `Exposé - Chapitre ${ch} (§ ${targetParaNum})` : `Exposé - Chapitre ${ch}`,
      selectedUnit: targetParaNum ? { type: 'paragraph', id: targetParaNum, paragraphIndex: targetParaNum } : { type: 'chapter', id: ch },
      allowedParagraphIds: targetParaNum ? [targetParaNum] : undefined
    };
  }

  // 3. Exposé Page (ex: expose-pg-15, expose-pg-15-p-3)
  if (baseRaw.startsWith('expose-pg-')) {
    const pg = parseInt(baseRaw.replace('expose-pg-', ''), 10);
    return {
      sourceType: 'expose',
      sourceId: baseRaw,
      title: targetParaNum ? `Exposé - Page ${pg} (§ ${targetParaNum})` : `Exposé - Page ${pg}`,
      selectedUnit: targetParaNum ? { type: 'paragraph', id: targetParaNum, paragraphIndex: targetParaNum } : { type: 'page', id: pg },
      allowedParagraphIds: targetParaNum ? [targetParaNum] : undefined
    };
  }

  // 4. Chant (ex: song-1, song-12, song-12-p-2)
  if (baseRaw.startsWith('song-')) {
    const sId = baseRaw.replace('song-', '');
    return {
      sourceType: 'song',
      sourceId: baseRaw,
      title: targetParaNum ? `Cantique #${sId} (Strophe ${targetParaNum})` : `Cantique #${sId}`,
      selectedUnit: targetParaNum ? { type: 'paragraph', id: targetParaNum, paragraphIndex: targetParaNum } : { type: 'document', id: sId },
      allowedParagraphIds: targetParaNum ? [targetParaNum] : undefined
    };
  }

  // 5. Sermon standard (ex: 63-0324M, 65-1212, 63-0324M-p-15)
  return {
    sourceType: 'sermon',
    sourceId: baseRaw,
    title: targetParaNum ? `${baseRaw} (§ ${targetParaNum})` : baseRaw,
    selectedUnit: targetParaNum ? { type: 'paragraph', id: targetParaNum, paragraphIndex: targetParaNum } : { type: 'document', id: baseRaw },
    allowedParagraphIds: targetParaNum ? [targetParaNum] : undefined
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
  // Découper les apostrophes d'élision explicites (l'église -> eglise) et préfixes collés
  const withSeparatedApostrophes = query.replace(/([ldqujcsnmtLDQUJCSNMT])['`’]([\p{L}\p{N}]+)/gu, '$1 $2');
  const normalized = normalizeText(withSeparatedApostrophes);
  const words = normalized
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .map(w => {
      // Élaguer article élidé collé si applicable (ex: leglise -> eglise)
      if (w.startsWith('leglise')) return 'eglise';
      if (w.startsWith('deglise')) return 'eglise';
      return w;
    })
    .filter(w => w.length > 2);

  const compounds = extractCompoundTheologicalTokens(query);
  const nonStop = words.filter(w => !UNIFIED_STOP_WORDS.has(w));
  const substantive = nonStop.filter(w => !CONTAINER_STOP_WORDS.has(w));

  const baseTerms = substantive.length > 0
    ? substantive
    : (nonStop.length > 0 ? nonStop : words);

  return Array.from(new Set([...baseTerms, ...compounds]));
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

  // Pré-chargement unique des chunks de l'Exposé si au moins une source est de type 'expose'
  let cachedExposeChunks: SermonChunk[] | null = null;
  if (sources.some(s => s.sourceType === 'expose')) {
    cachedExposeChunks = await createExposeDocumentChunks();
  }

  const sermonChunksToHydrate: SermonChunk[] = [];

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

      // Fallback Web browser / Node.js static library.json (mis en cache mémoire)
      if (!sermon || !sermon.text) {
        try {
          if (!staticLibraryFallbackCache) {
            if (typeof window !== 'undefined') {
              const res = await fetch(getStaticResourceUrl('library.json'));
              if (res.ok) {
                staticLibraryFallbackCache = await res.json();
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
                  staticLibraryFallbackCache = JSON.parse(fs.readFileSync(cand, 'utf8'));
                  break;
                }
              }
            }
          }
          if (staticLibraryFallbackCache) {
            const baseId = cleanSourceId.split('-').slice(0, 2).join('-');
            const found = staticLibraryFallbackCache.find(
              s => s.id === cleanSourceId || s.id === baseId || (s.version && `${s.id}-${s.version}` === cleanSourceId)
            );
            if (found && found.text) sermon = found;
          }
        } catch {}
      }

      if (sermon && sermon.text) {
        const cacheKey = `${cleanSourceId}::${sermon.id}`;
        const cachedEntry = sermonChunksMemoryCache.get(cacheKey);
        let sermonChunks: SermonChunk[];

        if (cachedEntry && cachedEntry.textLen === sermon.text.length) {
          sermonChunks = cachedEntry.chunks;
        } else {
          sermonChunks = createSermonChunks(sermon);
          for (const c of sermonChunks) {
            c.documentType = 'sermon';
            c.documentId = cleanSourceId;
            c.sermonId = cleanSourceId;
          }
          sermonChunksMemoryCache.set(cacheKey, { textLen: sermon.text.length, chunks: sermonChunks });
        }

        for (const c of sermonChunks) {
          if (!c.embedding) {
            sermonChunksToHydrate.push(c);
          }
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
      const allExposeChunks = cachedExposeChunks || await createExposeDocumentChunks();
      try {
        const stored = await getChunksBySermonId(src.sourceId);
        if (stored && stored.length > 0) {
          const embMap = new Map(stored.filter(s => s.embedding && (Array.isArray(s.embedding) || ArrayBuffer.isView(s.embedding)) && (s.embedding as any).length > 0).map(s => [s.chunkId, s.embedding]));
          for (const c of allExposeChunks) {
            if (!c.embedding) {
              const foundEmb = embMap.get(c.chunkId);
              if (foundEmb) c.embedding = foundEmb;
            }
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

  if (sermonChunksToHydrate.length > 0) {
    try {
      const { hydrateChunksWithBinaryVectors } = await import('./binaryVectorStorageService');
      await hydrateChunksWithBinaryVectors(sermonChunksToHydrate, {
        target: 'sermons',
        binaryFileName: 'sermons_vectors.bin',
        indexFileName: 'sermons_vectors.idx'
      });
    } catch {}
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
  const resolvedChunks = await resolveAIContextChunks(aiContext, {
    bibleVersion: options.bibleVersion,
    loadedSermonsMap: options.loadedSermonsMap
  });
  const allowedChunks = (options.providedChunks && options.providedChunks.length > 0)
    ? options.providedChunks
    : resolvedChunks;

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

  // 0. Détection d'intention (CONTENT_TRANSFORMATION vs DOCUMENT_RETRIEVAL)
  const intentResult = detectQueryIntent(cleanQuery);
  const uniqueTitles = Array.from(new Set(allowedChunks.map(c => c.sermonTitle || c.sermonId).filter(Boolean)));
  const aiContextDesc = uniqueTitles.length > 0 
    ? (uniqueTitles.slice(0, 2).join(', ') + (uniqueTitles.length > 2 ? ` (+${uniqueTitles.length - 2})` : ''))
    : 'Ressources sélectionnées';

  logQueryIntent({
    query: cleanQuery,
    aiContextDescription: aiContextDesc,
    intentResult
  });

  // ROUTAGE INTENTION A : CONTENT_TRANSFORMATION
  if (intentResult.intent === 'CONTENT_TRANSFORMATION' && allowedChunks.length > 0) {
    const transformationCandidates: HybridSearchResult[] = allowedChunks.slice(0, 25).map((chunk, idx) => ({
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
      lexicalScore: 100 - idx,
      vectorRank: idx + 1,
      vectorScore: 0.95 - idx * 0.01,
      rrfScore: 1.0 / (60 + idx + 1),
      rank: idx + 1,
      chunk
    }));

    const seenTransformationParas = new Set<string>();
    const evidence: RetrievalEvidence[] = transformationCandidates.slice(0, maxEvidenceCount * 2).map((item, idx) => {
      const chunk = (item.chunk || item) as SermonChunk;
      const citationParagraphs = buildCitationParagraphsForChunk(chunk, seenTransformationParas);

      return {
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
        retrievalScore: item.rrfScore || 0.95,
        rank: idx + 1,
        sourceType: 'reranked',
        citationParagraphs
      };
    });

    return {
      answerable: true,
      confidenceScore: 0.98,
      reason: `Instruction de transformation (${intentResult.intent}) sur le contenu sélectionné dans l'AI Context.`,
      evidence,
      query: cleanQuery,
      totalCandidates: transformationCandidates.length,
      rejectedCount: 0,
      vectorMethod: 'selected_context_transformation'
    };
  }

  // ROUTAGE INTENTION B : DOCUMENT_RETRIEVAL (Pipeline RAG habituel inchangé)
  // Concaténation du texte intégral du contexte actif pour l'évaluation d'Answerability
  const contextCorpusText = allowedChunks.map(c => c.text).join(' ');

  // Expansion doctrinale & décomposition Multi-Hop (locale par défaut pour 0 latence et 0 consommation de quota)
  const expansionApiKey = aiConfig.featureFlags.useQueryRewrite ? options.apiKey : undefined;
  const queryExpansion = await expandTheologicalQuery(cleanQuery, expansionApiKey);
  const coreQueryTerms = extractUnifiedQueryTerms(cleanQuery);
  const effectiveQuery = queryExpansion.expandedQuery || cleanQuery;
  const allExpandedCandidates = extractUnifiedQueryTerms(effectiveQuery);
  const normalizedQuery = normalizeText(cleanQuery);
  const queryWords = normalizedQuery.split(/\s+/).filter(w => w.length > 2);

  // Termes additionnels issus des mots-clés doctrinaux et sous-requêtes multi-hop
  if (Array.isArray(queryExpansion.doctrinalKeywords) && queryExpansion.doctrinalKeywords.length > 0) {
    for (const kw of queryExpansion.doctrinalKeywords) {
      for (const t of extractUnifiedQueryTerms(kw)) {
        if (!allExpandedCandidates.includes(t)) allExpandedCandidates.push(t);
      }
    }
  }

  if (queryExpansion.isMultiHop && queryExpansion.subQueries.length > 1) {
    for (const sq of queryExpansion.subQueries) {
      for (const t of extractUnifiedQueryTerms(sq)) {
        if (!allExpandedCandidates.includes(t)) allExpandedCandidates.push(t);
      }
    }
  }

  const coreTermSet = new Set(coreQueryTerms);
  const expandedTerms = allExpandedCandidates.filter(t => !coreTermSet.has(t));
  const queryTerms = [...coreQueryTerms, ...expandedTerms];

  // Bigrammes de la requête pour détecter les syntagmes doctrinaux précis
  const bigrams: string[] = [];
  for (let i = 0; i < queryWords.length - 1; i++) {
    bigrams.push(queryWords[i] + ' ' + queryWords[i + 1]);
  }

  // ÉTAPE 6 : PRE-FILTERING STRICT DES MÉTADONNÉES
  // Restreint le bassin de recherche avant tout calcul lexical ou vectoriel
  const metadataFilteredPool = options.metadataFilter && Object.keys(options.metadataFilter).length > 0
    ? allowedChunks.filter(c => matchesMetadataFilter(c, options.metadataFilter))
    : allowedChunks;

  // Exclusion des chunks composés uniquement de bruit éditorial lorsqu'un document complet est exploré
  const nonNoisePool = metadataFilteredPool.length > 5
    ? metadataFilteredPool.filter(c => !isContentlessOrNoiseParagraph(c.text))
    : metadataFilteredPool;
  const searchPool = nonNoisePool.length > 0 ? nonNoisePool : metadataFilteredPool;

  // 2. Recherche lexicale BM25 Okapi formelle via Index Inversé O(|Q| × postings)
  let bm25Vocab = getActiveCorpusVocabulary();
  if (!bm25Vocab || bm25Vocab.terms.size === 0) {
    bm25Vocab = buildCorpusVocabulary(searchPool);
  }

  let scoredChunks = searchBM25WithInvertedIndex(
    searchPool,
    coreQueryTerms,
    expandedTerms,
    bm25Vocab,
    {
      k1: 1.5,
      b: 0.75,
      bigrams,
      fullPhrase: normalizedQuery.length > 3 ? normalizedQuery : undefined,
      coreWeight: 1.0,
      expandedWeight: 0.40
    },
    40
  );

  // 2b. Exécution Multi-Hop Réelle avec Quotas Équilibrés par Sous-Requête (Entité A vs Entité B)
  if (queryExpansion.isMultiHop && queryExpansion.subQueries.length >= 2) {
    const subQueryHitLists = queryExpansion.subQueries.map(sq => {
      const sqTerms = extractUnifiedQueryTerms(sq);
      return searchBM25WithInvertedIndex(
        searchPool,
        sqTerms.length > 0 ? sqTerms : coreQueryTerms,
        expandedTerms,
        bm25Vocab,
        { k1: 1.5, b: 0.75, coreWeight: 1.0, expandedWeight: 0.35 },
        15
      );
    });

    // Fusion entrelacée (Round-Robin) garantissant que chaque facette/document est représentée en tête de classement
    const mergedMap = new Map<string, typeof scoredChunks[0]>();
    const maxLen = Math.max(scoredChunks.length, ...subQueryHitLists.map(l => l.length));

    for (let i = 0; i < maxLen; i++) {
      if (i < scoredChunks.length) {
        const mainHit = scoredChunks[i];
        if (!mergedMap.has(mainHit.chunk.chunkId)) {
          mergedMap.set(mainHit.chunk.chunkId, mainHit);
        }
      }
      for (const sqList of subQueryHitLists) {
        if (i < sqList.length) {
          const sqHit = sqList[i];
          const existing = mergedMap.get(sqHit.chunk.chunkId);
          if (!existing || sqHit.score > existing.score) {
            mergedMap.set(sqHit.chunk.chunkId, sqHit);
          }
        }
      }
      if (mergedMap.size >= 40) break;
    }

    scoredChunks = Array.from(mergedMap.values());
  }

  const lexicalHits = scoredChunks.map((item, idx) => ({
    chunkId: item.chunk.chunkId,
    rank: idx + 1,
    score: item.score,
    matchedParagraphIds: item.chunk.paragraphIds
  }));

  // 3. Recherche vectorielle sémantique locale E5 (384D Int8) STRICTEMENT sur les chunks autorisés
  let vectorHits: Array<{ chunk: SermonChunk; score: number; rank: number }> = [];
  let vectorMethod: 'e5_384d_int8' | 'cosine_3072d' | 'none' = 'none';
  let queryVectorUsed = false;
  let queryVectorDim = 0;

  if (Array.isArray(options.mockVectorHits) && options.mockVectorHits.length > 0) {
    const allowedIds = new Set(searchPool.map(c => c.chunkId));
    vectorHits = options.mockVectorHits.filter(h => allowedIds.has(h.chunk?.chunkId));
    vectorMethod = 'e5_384d_int8';
    queryVectorUsed = true;
    queryVectorDim = 384;
  } else {
    try {
      let qVec: Int8Array | Float32Array | number[] | null = options.queryVector || null;

      if (!qVec) {
        // Encodage local E5 384D Int8 avec préfixe "query: " et normalisation L2
        qVec = await computeE5Embedding(cleanQuery, 'query: ');
      }

      if (qVec && qVec.length === 384) {
        queryVectorUsed = true;
        queryVectorDim = 384;

        // E5 accepte uniquement les chunks avec un vecteur E5 (384 octets Int8)
        const validE5Chunks = searchPool.filter(c => {
          if (!c.embedding) return false;
          if (c.embedding instanceof Int8Array && c.embedding.length === 384) return true;
          if (Array.isArray(c.embedding) && c.embedding.length === 384) return true;
          if (ArrayBuffer.isView(c.embedding) && (c.embedding as any).length === 384) return true;
          // BLOB Gemini de 12288 octets (3072D) ou 768D Float32 sont ignorés
          return false;
        });

        if (validE5Chunks.length > 0) {
          const vecResults = searchByVector(qVec, validE5Chunks, { topK: 40 });
          if (vecResults.length > 0) {
            vectorHits = vecResults.map((item, idx) => ({
              chunk: item.chunk,
              score: item.score,
              rank: idx + 1
            }));
            vectorMethod = 'e5_384d_int8';
          }
        } else {
          console.warn('[UnifiedRAG] Aucun chunk avec embedding E5 (384D Int8) disponible.');
          console.warn('[UnifiedRAG] VECTOR_UNAVAILABLE → BM25_ONLY');
        }
      } else {
        console.warn('[UnifiedRAG] VECTOR_UNAVAILABLE → BM25_ONLY');
      }
    } catch (err) {
      console.warn('[UnifiedRAG] VECTOR_UNAVAILABLE → BM25_ONLY', err);
    }
  }

  // 4. Routage dynamique de requête (Adaptive RRF Weights) selon la force lexicale directe vs paraphrase sémantique
  const topScoredLex = scoredChunks[0];
  const compoundQueryTokens = extractCompoundTheologicalTokens(cleanQuery);
  const adaptiveWeights = computeAdaptiveHybridWeights({
    coreTermsCount: coreQueryTerms.filter(t => !t.includes('_')).length,
    topCoreMatched: topScoredLex?.coreMatched || 0,
    topExpandedMatched: topScoredLex?.expandedMatched || 0,
    topBm25Score: topScoredLex?.score || 0,
    hasCompoundReference: compoundQueryTokens.length > 0
  });

  // Détection du mode Long-Context ("style NotebookLM") sur petites sélections (1-2 documents, <= 120 chunks)
  const isOverview = isOverviewOrSummaryQuery(cleanQuery);
  const isBroadStudy = isBroadOrExhaustiveContextQuery(cleanQuery);
  const distinctSelectedDocs = new Set(allowedChunks.map(c => c.sermonId)).size;
  const isLongContextBypassEligible = isBroadStudy && distinctSelectedDocs <= 2 && allowedChunks.length <= 120;
  const effectiveMaxEvidenceCount = (isLongContextBypassEligible && typeof options.maxEvidenceCount !== 'number')
    ? Math.min(25, Math.max(maxEvidenceCount, allowedChunks.length))
    : maxEvidenceCount;
  const effectiveTopK = Math.max(topK, effectiveMaxEvidenceCount);

  let hybridResults = fuseRankings({
    lexicalHits,
    vectorHits,
    allChunks: allowedChunks,
    options: {
      k: options.k || 60,
      topK: Math.max(20, effectiveTopK),
      lexicalWeight: options.lexicalWeight ?? adaptiveWeights.lexicalWeight,
      vectorWeight: options.vectorWeight ?? adaptiveWeights.vectorWeight
    }
  });

  // Cas spécial : Requête d'aperçu / synthèse ou mode Long-Context sur petite sélection
  if ((isOverview || isLongContextBypassEligible) && allowedChunks.length > 0) {
    const existingIds = new Set(hybridResults.map(h => h.chunkId));
    const targetCount = isLongContextBypassEligible ? Math.min(25, allowedChunks.length) : 15;
    const step = Math.max(1, Math.floor(allowedChunks.length / targetCount));
    for (let i = 0; i < allowedChunks.length && hybridResults.length < targetCount; i += step) {
      const chunk = allowedChunks[i];
      if (!existingIds.has(chunk.chunkId)) {
        const idx = hybridResults.length;
        hybridResults.push({
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
          lexicalScore: Math.max(10, 50 - idx * 2),
          vectorRank: idx + 1,
          vectorScore: Math.max(0.6, 0.95 - idx * 0.02),
          rrfScore: 1.0 / (60 + idx + 1),
          rank: idx + 1,
          chunk
        });
        existingIds.add(chunk.chunkId);
      }
    }
  }

  // 5. Reranking local multi-signaux avec fenêtrage contextuel ±1 paragraphe
  const rerankedResults = rerankHybridResults({
    query: cleanQuery,
    hybridResults,
    allChunks: searchPool,
    options: {
      topK: effectiveTopK,
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
    corpusTextIndex: contextCorpusText,
    corpusChunks: allowedChunks
  });

  // 7. Logs de diagnostic structurés (Requirement 12)
  console.log('=== LOGS DE DIAGNOSTIC RAG UNIFIÉ ===');
  console.log(`QUERY: ${cleanQuery}`);
  console.log(`INTENT: DOCUMENT_RETRIEVAL`);
  console.log(`ROUTE: ${isLongContextBypassEligible ? 'UNIFIED_RAG_LONG_CONTEXT' : 'UNIFIED_RAG'}`);
  console.log(`QUERY EMBEDDING: ${queryVectorUsed ? 'YES' : 'NO'}`);
  console.log(`EMBEDDING MODEL: ${EMBEDDING_CONFIG.model}`);
  console.log(`EMBEDDING DIMENSION: ${queryVectorDim}`);
  console.log(`VECTOR SEARCH: ${vectorHits.length > 0 ? 'YES' : 'NO'}`);
  console.log(`VECTOR CANDIDATES: ${vectorHits.length}`);
  console.log(`LEXICAL CANDIDATES: ${lexicalHits.length}`);
  console.log(`RRF CANDIDATES: ${hybridResults.length}`);
  console.log(`RERANKED RESULTS: ${rerankedResults.length}`);
  console.log(`ANSWERABILITY: ${assessment.answerable ? 'TRUE' : 'FALSE'}`);
  console.log(`GEMINI GENERATION: ${assessment.answerable ? 'YES' : 'NO'}`);
  console.log('======================================');

  // 7. Construction du Retrieval Evidence Package avec Diversification MMR (lambda = 0.75)
  const evidence: RetrievalEvidence[] = [];

  if (assessment.answerable && rerankedResults.length > 0) {
    const maxPerDoc = isLongContextBypassEligible
      ? 25
      : (effectiveMaxEvidenceCount > 10 ? 4 : 2);

    const selectedItems = selectDiverseEvidenceWithMMR(
      rerankedResults,
      effectiveMaxEvidenceCount,
      {
        lambda: 0.75,
        maxPerDoc,
        isMultiHop: queryExpansion.isMultiHop
      }
    );

    const seenCitationParagraphKeys = new Set<string>();

    for (const item of selectedItems) {
      const chunk = (item.chunk || item) as SermonChunk;
      const citationParagraphs = buildCitationParagraphsForChunk(chunk, seenCitationParagraphKeys);

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

  // ÉTAPE 7 : FENÊTRAGE CONTEXTUEL ADJACENT (±1 PARAGRAPHE §n-1 et §n+1)
  let finalEvidence = evidence;
  if (evidence.length > 0 && options.enableParentChild !== false) {
    const rawDocsMap = new Map<string, string>();
    for (const c of allowedChunks) {
      if (!rawDocsMap.has(c.sermonId)) {
        const sId = c.sermonId;
        if (options.loadedSermonsMap && options.loadedSermonsMap.has(sId)) {
          const sObj = options.loadedSermonsMap.get(sId);
          if (sObj && sObj.text) rawDocsMap.set(sId, sObj.text);
        }
      }
    }
    for (const ev of evidence) {
      if (!rawDocsMap.has(ev.sermonId)) {
        const docChunks = allowedChunks
          .filter(c => c.sermonId === ev.sermonId)
          .sort((a, b) => a.startParagraph - b.startParagraph);
        rawDocsMap.set(ev.sermonId, docChunks.map(dc => dc.text).join('\n\n'));
      }
    }

    if (options.enableParentChild === true) {
      // Mode Parent-Child complet avec fusion des évidences adjacentes et texte balisé [Précédent]/[Cible]/[Suivant]
      finalEvidence = applyParentChildToEvidencePackage(evidence, rawDocsMap, options.parentChildOptions);
    } else {
      // Mode fenêtrage adjacent non-destructif par défaut : peuple ev.adjacentContext (±1 paragraphe) tout en préservant ev.text
      finalEvidence = evidence.map(ev => {
        const docText = rawDocsMap.get(ev.sermonId) || '';
        const docParas = extractDocumentParagraphs(docText);
        const adjacentContext = buildAdjacentContextForEvidence(ev, docParas, options.parentChildOptions);
        return adjacentContext ? { ...ev, adjacentContext } : ev;
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
      evidenceCount: finalEvidence.length
    }, null, 2));
  }

  return {
    answerable: assessment.answerable,
    confidenceScore: assessment.confidenceScore,
    reason: assessment.reason,
    evidence: finalEvidence,
    query: cleanQuery,
    totalCandidates: rerankedResults.length,
    rejectedCount: Math.max(0, rerankedResults.length - finalEvidence.length),
    vectorMethod,
    closestPassages: assessment.closestPassages,
    refusalCategory: assessment.refusalCategory,
    decisionJournal: assessment.decisionJournal,
    forceSearchAvailable: assessment.forceSearchAvailable
  };
}
