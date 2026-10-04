/**
 * King's Sword — Service de Chunking Déterministe pour Sermons (Phase 2A)
 * 
 * Découpe les sermons en chunks sémantiques cohérents basés sur les paragraphes originaux.
 * RÈGLE D'OR : Le chunk est uniquement une unité de retrieval vectoriel / lexical.
 * La source de vérité pour les citations reste toujours SERMON -> PARAGRAPHE ORIGINAL.
 */

import { Sermon, SermonChunk, ChunkingOptions } from '../types';

export interface ParsedParagraph {
  num: number;
  text: string;
  charCount: number;
  wordCount: number;
}

export interface ChunkStatistics {
  totalSermons: number;
  totalParagraphs: number;
  totalChunks: number;
  avgParagraphsPerChunk: number;
  avgChunkLengthChars: number;
  minChunkLengthChars: number;
  maxChunkLengthChars: number;
  avgChunkLengthWords: number;
  coverageRate: number;
}

export const DEFAULT_CHUNKING_OPTIONS: Required<ChunkingOptions> = {
  maxCharacters: 900,
  minCharacters: 200,
  overlapParagraphs: 1,
  maxParagraphsPerChunk: 3
};

/**
 * Calcule un hash déterministe (64-bit FNV-1a combiné) pour un chunk.
 * Permet de détecter instantanément les modifications sans comparaison textuelle lourde.
 */
export function computeChunkHash(sermonId: string, paragraphIds: number[], text: string): string {
  const payload = `${sermonId}:${paragraphIds.join(',')}:${text}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x84222325;
  for (let i = 0; i < payload.length; i++) {
    const code = payload.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= (code + i);
    h2 = Math.imul(h2, 0x01000193);
  }
  const part1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const part2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `h_${part1}${part2}`;
}

/**
 * Découpe un texte de sermon en liste de paragraphes ordonnés avec leur indexation originale.
 */
export function parseSermonParagraphs(text: string): ParsedParagraph[] {
  if (!text || typeof text !== 'string') return [];
  
  const rawParagraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  
  return rawParagraphs.map((raw, idx) => {
    const trimmed = raw.trim();
    const leadingNumMatch = trimmed.match(/^(\d+)[\.\s]/);
    const num = leadingNumMatch ? parseInt(leadingNumMatch[1], 10) : idx + 1;
    
    return {
      num,
      text: trimmed,
      charCount: trimmed.length,
      wordCount: trimmed.split(/\s+/).filter(Boolean).length
    };
  });
}

/**
 * Construit les chunks d'un sermon de façon déterministe en respectant les frontières de paragraphes.
 */
export function createSermonChunks(sermon: Sermon, options?: ChunkingOptions): SermonChunk[] {
  if (!sermon || !sermon.text) return [];

  const opts: Required<ChunkingOptions> = {
    ...DEFAULT_CHUNKING_OPTIONS,
    ...(options || {})
  };

  const paragraphs = parseSermonParagraphs(sermon.text);
  if (paragraphs.length === 0) return [];

  const chunks: SermonChunk[] = [];
  let pIdx = 0;
  let chunkCounter = 1;

  while (pIdx < paragraphs.length) {
    const currentGroup: ParsedParagraph[] = [];
    let currentLength = 0;

    // Accumulation des paragraphes jusqu'à la limite maxCharacters ou maxParagraphsPerChunk
    while (pIdx + currentGroup.length < paragraphs.length) {
      const candidate = paragraphs[pIdx + currentGroup.length];
      const addedLength = currentLength === 0 ? candidate.charCount : currentLength + 2 + candidate.charCount;

      // Si le groupe contient déjà des paragraphes et que l'ajout dépasse le seuil, arrêter
      if (currentGroup.length > 0) {
        if (addedLength > opts.maxCharacters || currentGroup.length >= opts.maxParagraphsPerChunk) {
          break;
        }
      }

      currentGroup.push(candidate);
      currentLength = addedLength;
    }

    if (currentGroup.length === 0) {
      // Cas de repli sécurisé : au moins un paragraphe
      currentGroup.push(paragraphs[pIdx]);
    }

    const paragraphIds = currentGroup.map(p => p.num);
    const startParagraph = paragraphIds[0];
    const endParagraph = paragraphIds[paragraphIds.length - 1];
    const chunkText = currentGroup.map(p => p.text).join('\n\n');
    const contentHash = computeChunkHash(sermon.id, paragraphIds, chunkText);
    const nowIso = new Date().toISOString();

    chunks.push({
      chunkId: `${sermon.id}_c${chunkCounter}_p${startParagraph}_p${endParagraph}`,
      sermonId: sermon.id,
      paragraphIds,
      startParagraph,
      endParagraph,
      text: chunkText,
      sermonTitle: sermon.title,
      date: sermon.date,
      city: sermon.city,
      version: sermon.version,
      characterCount: chunkText.length,
      wordCount: chunkText.split(/\s+/).filter(Boolean).length,
      contentHash,
      createdAt: nowIso,
      updatedAt: nowIso
    });

    chunkCounter++;

    // Calcul de l'avancement avec overlap contrôlé
    const groupSize = currentGroup.length;
    let step = groupSize;
    if (opts.overlapParagraphs > 0 && groupSize > 1) {
      step = Math.max(1, groupSize - opts.overlapParagraphs);
    }

    pIdx += step;
  }

  return chunks;
}

/**
 * Construit les chunks pour l'intégralité d'un corpus documentaire.
 */
export function createLibraryChunks(sermons: Sermon[], options?: ChunkingOptions): SermonChunk[] {
  if (!Array.isArray(sermons)) return [];
  const allChunks: SermonChunk[] = [];
  
  for (const s of sermons) {
    const sChunks = createSermonChunks(s, options);
    allChunks.push(...sChunks);
  }

  return allChunks;
}

/**
 * Calcule les statistiques descriptives et le taux de couverture des chunks.
 */
export function calculateChunkStatistics(
  sermons: Sermon[],
  chunks: SermonChunk[]
): ChunkStatistics {
  const totalSermons = sermons.length;
  
  let totalParagraphs = 0;
  const allExpectedParagraphKeys = new Set<string>();

  for (const s of sermons) {
    const paras = parseSermonParagraphs(s.text);
    totalParagraphs += paras.length;
    paras.forEach(p => allExpectedParagraphKeys.add(`${s.id}_${p.num}`));
  }

  const coveredParagraphKeys = new Set<string>();
  let totalChars = 0;
  let totalWords = 0;
  let totalParasInChunks = 0;
  let minChars = chunks.length > 0 ? Infinity : 0;
  let maxChars = 0;

  for (const c of chunks) {
    totalChars += c.characterCount;
    totalWords += c.wordCount;
    totalParasInChunks += c.paragraphIds.length;
    
    if (c.characterCount < minChars) minChars = c.characterCount;
    if (c.characterCount > maxChars) maxChars = c.characterCount;

    c.paragraphIds.forEach(pNum => {
      coveredParagraphKeys.add(`${c.sermonId}_${pNum}`);
    });
  }

  const coveredCount = Array.from(allExpectedParagraphKeys).filter(k => coveredParagraphKeys.has(k)).length;
  const coverageRate = allExpectedParagraphKeys.size > 0
    ? Math.round((coveredCount / allExpectedParagraphKeys.size) * 1000) / 10
    : 100;

  return {
    totalSermons,
    totalParagraphs,
    totalChunks: chunks.length,
    avgParagraphsPerChunk: chunks.length > 0 ? Math.round((totalParasInChunks / chunks.length) * 10) / 10 : 0,
    avgChunkLengthChars: chunks.length > 0 ? Math.round(totalChars / chunks.length) : 0,
    minChunkLengthChars: minChars === Infinity ? 0 : minChars,
    maxChunkLengthChars: maxChars,
    avgChunkLengthWords: chunks.length > 0 ? Math.round(totalWords / chunks.length) : 0,
    coverageRate
  };
}
