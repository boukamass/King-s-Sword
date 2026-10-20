/**
 * King's Sword — Service d'Index de Métadonnées Pré-calculées (Étape 6.5)
 * 
 * Accélère le pré-filtrage en évitant le parcours linéaire complet (filter()) de tous les
 * chunks à chaque requête utilisateur.
 * Maintient des tables d'accès O(1) par :
 * - Source documentaire ('sermon', 'expose', 'bible', 'song')
 * - Année (1947–1965)
 * - Identifiant de sermon / document (sermonId)
 * - Séries thématiques (Sceaux, Âges, etc.)
 */

import { SermonChunk, MetadataFilter, DocumentSourceType } from '../types';
import { extractChunkYear, extractChunkSourceType, matchesMetadataFilter } from './vectorSearchService';

export interface PrecalculatedMetadataIndices {
  bySource: Map<DocumentSourceType, SermonChunk[]>;
  byYear: Map<number, SermonChunk[]>;
  bySermonId: Map<string, SermonChunk[]>;
  bySeries: Map<string, SermonChunk[]>;
  chunkIdToChunk: Map<string, SermonChunk>;
  allChunks: SermonChunk[];
}

let cachedIndices: PrecalculatedMetadataIndices | null = null;

/**
 * Construit les index de métadonnées en mémoire en un seul passage O(N).
 */
export function buildPrecalculatedMetadataIndices(chunks: SermonChunk[]): PrecalculatedMetadataIndices {
  const bySource = new Map<DocumentSourceType, SermonChunk[]>();
  const byYear = new Map<number, SermonChunk[]>();
  const bySermonId = new Map<string, SermonChunk[]>();
  const bySeries = new Map<string, SermonChunk[]>();
  const chunkIdToChunk = new Map<string, SermonChunk>();

  // Liste des séries courantes à indexer
  const KNOWN_SERIES = ['sceaux', 'ages', 'mariage', 'adoption', 'hebreux', 'foi', 'sept'];

  for (const c of chunks) {
    if (!c || !c.chunkId) continue;
    chunkIdToChunk.set(c.chunkId, c);

    // 1. Index par Source
    const srcType = extractChunkSourceType(c);
    let srcList = bySource.get(srcType);
    if (!srcList) {
      srcList = [];
      bySource.set(srcType, srcList);
    }
    srcList.push(c);

    // 2. Index par Année
    const yr = extractChunkYear(c);
    if (yr !== null) {
      let yrList = byYear.get(yr);
      if (!yrList) {
        yrList = [];
        byYear.set(yr, yrList);
      }
      yrList.push(c);
    }

    // 3. Index par sermonId / documentId
    let sList = bySermonId.get(c.sermonId);
    if (!sList) {
      sList = [];
      bySermonId.set(c.sermonId, sList);
    }
    sList.push(c);

    // 4. Index par Séries thématiques
    const title = (c.sermonTitle || c.sectionTitle || '').toLowerCase();
    for (const ser of KNOWN_SERIES) {
      if (title.includes(ser)) {
        let serList = bySeries.get(ser);
        if (!serList) {
          serList = [];
          bySeries.set(ser, serList);
        }
        serList.push(c);
      }
    }
  }

  cachedIndices = {
    bySource,
    byYear,
    bySermonId,
    bySeries,
    chunkIdToChunk,
    allChunks: chunks
  };

  return cachedIndices;
}

/**
 * Récupère les index pré-calculés en cache.
 */
export function getPrecalculatedMetadataIndices(): PrecalculatedMetadataIndices | null {
  return cachedIndices;
}

/**
 * Filtre les chunks ultra-rapidement via les index pré-calculés.
 * Effectue des intersections ciblées sans balayer l'intégralité du corpus.
 */
export function filterChunksViaMetadataIndices(
  filter: MetadataFilter | undefined,
  fallbackChunks?: SermonChunk[]
): SermonChunk[] {
  if (!filter || Object.keys(filter).length === 0) {
    return cachedIndices ? cachedIndices.allChunks : (fallbackChunks || []);
  }

  const indices = cachedIndices || (fallbackChunks ? buildPrecalculatedMetadataIndices(fallbackChunks) : null);
  if (!indices) {
    return (fallbackChunks || []).filter(c => matchesMetadataFilter(c, filter));
  }

  // 1. Filtrage par sermonIds direct
  if (filter.sermonIds && filter.sermonIds.length > 0) {
    const candidateChunks: SermonChunk[] = [];
    for (const sid of filter.sermonIds) {
      const list = indices.bySermonId.get(sid);
      if (list) {
        for (const c of list) {
          candidateChunks.push(c);
        }
      }
    }
    // Si d'autres filtres sont présents, affiner ce petit sous-ensemble
    return candidateChunks.filter(c => matchesMetadataFilter(c, filter));
  }

  // 2. Filtrage par années
  if (filter.years && filter.years.length > 0) {
    const candidateChunks: SermonChunk[] = [];
    for (const yr of filter.years) {
      const list = indices.byYear.get(yr);
      if (list) {
        for (const c of list) {
          candidateChunks.push(c);
        }
      }
    }
    return candidateChunks.filter(c => matchesMetadataFilter(c, filter));
  }

  // 3. Filtrage par plage d'années (yearMin / yearMax)
  if (filter.yearMin !== undefined || filter.yearMax !== undefined) {
    const candidateChunks: SermonChunk[] = [];
    for (const [yr, list] of indices.byYear.entries()) {
      if ((filter.yearMin === undefined || yr >= filter.yearMin) &&
          (filter.yearMax === undefined || yr <= filter.yearMax)) {
        for (const c of list) candidateChunks.push(c);
      }
    }
    return candidateChunks.filter(c => matchesMetadataFilter(c, filter));
  }

  // 4. Filtrage par source
  if (filter.sources && filter.sources.length > 0) {
    const candidateChunks: SermonChunk[] = [];
    for (const src of filter.sources) {
      const list = indices.bySource.get(src);
      if (list) {
        for (const c of list) candidateChunks.push(c);
      }
    }
    return candidateChunks.filter(c => matchesMetadataFilter(c, filter));
  }

  // Repli sécurisé sur le prédicat
  return indices.allChunks.filter(c => matchesMetadataFilter(c, filter));
}
