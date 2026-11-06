/**
 * King's Sword — Classement « BM25 en tête » + reranking cross-encoder
 *
 * Mesuré sur le corpus complet (185 185 passages, 89 questions réelles dont 42 paraphrases) :
 * - le reranking pondéré historique (RRF + cosinus + lexical + couverture) dégradait le classement de BM25 ;
 * - garder les premiers passages BM25 en tête puis fusionner le reste par RRF (BM25 + E5) fait au moins
 *   aussi bien partout (top 5 : 66 % → 74 %, top 10 : 73 % → 81 %, top 24 inchangé à 83 %) ;
 * - le cross-encoder, appliqué à ce classement, apporte le gain principal sur les paraphrases.
 * Si le cross-encoder est indisponible (navigateur, modèle absent, délai dépassé), l'ordre BM25 en tête est conservé.
 */

import { HybridSearchResult } from '../types';
import { scoreWithCrossEncoder } from './crossEncoderService';

/**
 * Ordre BM25 en tête : les `headCount` premiers passages BM25 dans leur ordre, puis le reste des passages
 * BM25 et des passages E5 fusionnés par RRF (k).
 */
export function buildBm25LedOrder(lexicalIds: string[], vectorIds: string[], headCount = 5, k = 60): string[] {
  const head: string[] = [];
  const headSet = new Set<string>();
  for (const id of lexicalIds) {
    if (head.length >= headCount) break;
    if (!headSet.has(id)) { head.push(id); headSet.add(id); }
  }
  const scores = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  let seen = 0;
  const add = (ids: string[], offset: number) => {
    ids.forEach((id, i) => {
      if (headSet.has(id)) return;
      scores.set(id, (scores.get(id) || 0) + 1 / (k + i + 1 + offset));
      if (!firstSeen.has(id)) firstSeen.set(id, seen++);
    });
  };
  // Le reste de BM25 garde son rang d'origine (après la tête) ; E5 est pris depuis son 1er rang
  add(lexicalIds.slice(head.length), head.length);
  add(vectorIds, 0);
  const rest = Array.from(scores.entries())
    .sort((a, b) => (b[1] - a[1]) || ((firstSeen.get(a[0]) ?? 0) - (firstSeen.get(b[0]) ?? 0)))
    .map(([id]) => id);
  return [...head, ...rest];
}

/**
 * Réordonne les `poolSize` premiers candidats selon le cross-encoder (fusion de rangs pondérée par `weight` ;
 * weight = 1 : ordre du cross-encoder seul). Les candidats au-delà du bassin gardent leur ordre, à la suite.
 */
export async function rerankWithCrossEncoder<T extends { text: string }>(
  query: string,
  ordered: T[],
  options: { poolSize: number; maxLength: number; timeoutMs: number; weight: number; k?: number }
): Promise<{ ordered: T[]; usedCrossEncoder: boolean; latencyMs: number }> {
  const t0 = Date.now();
  const pool = ordered.slice(0, Math.max(0, options.poolSize));
  if (pool.length < 2) return { ordered, usedCrossEncoder: false, latencyMs: 0 };

  const scores = await scoreWithCrossEncoder(query, pool.map(c => c.text || ''), {
    maxLength: options.maxLength,
    timeoutMs: options.timeoutMs
  });
  if (!scores || scores.length !== pool.length) {
    return { ordered, usedCrossEncoder: false, latencyMs: Date.now() - t0 };
  }

  const k = options.k ?? 60;
  const w = Math.max(0, Math.min(1, options.weight));
  const ceRank = new Map<number, number>();
  pool
    .map((_, idx) => idx)
    .sort((a, b) => (scores[b] - scores[a]) || (a - b))
    .forEach((idx, r) => ceRank.set(idx, r));

  const fused = pool
    .map((item, idx) => ({ item, idx, s: w / (k + ceRank.get(idx)! + 1) + (1 - w) / (k + idx + 1) }))
    .sort((a, b) => (b.s - a.s) || (a.idx - b.idx))
    .map(x => x.item);

  return { ordered: [...fused, ...ordered.slice(pool.length)], usedCrossEncoder: true, latencyMs: Date.now() - t0 };
}

/**
 * Classement complet à partir des résultats fusionnés (qui portent rangs et scores BM25 / E5).
 */
export async function rankBm25Led(
  query: string,
  hybridResults: HybridSearchResult[],
  lexicalIds: string[],
  vectorIds: string[],
  options: {
    headCount: number;
    k: number;
    useCrossEncoder: boolean;
    crossEncoder: { poolSize: number; maxLength: number; timeoutMs: number; weight: number };
  }
): Promise<{ ordered: HybridSearchResult[]; usedCrossEncoder: boolean; crossEncoderLatencyMs: number }> {
  const byId = new Map(hybridResults.map(h => [h.chunkId, h]));
  const order = buildBm25LedOrder(lexicalIds, vectorIds, options.headCount, options.k).filter(id => byId.has(id));
  // Candidats éventuels absents des listes BM25 / E5 (ajouts spéciaux) : conservés à la suite, dans leur ordre
  const inOrder = new Set(order);
  for (const h of hybridResults) if (!inOrder.has(h.chunkId)) order.push(h.chunkId);
  let ordered = order.map(id => byId.get(id)!);

  let usedCrossEncoder = false;
  let crossEncoderLatencyMs = 0;
  if (options.useCrossEncoder) {
    const res = await rerankWithCrossEncoder(query, ordered, { ...options.crossEncoder, k: options.k });
    ordered = res.ordered;
    usedCrossEncoder = res.usedCrossEncoder;
    crossEncoderLatencyMs = res.latencyMs;
  }
  return { ordered, usedCrossEncoder, crossEncoderLatencyMs };
}
