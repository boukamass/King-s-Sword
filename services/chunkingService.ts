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
  sha1?: string;
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
 * Calcule le hash SHA-1 via le module standard node:crypto ou Web Crypto API.
 */
export function computeSha1(text: string): string {
  if (!text) return 'da39a3ee5e6b4b0d3255bfef95601890afd80709';

  // 1. Environnement Node.js / Electron (synchrone via node:crypto)
  try {
    const nodeCrypto = typeof require !== 'undefined' ? require('crypto') : null;
    if (nodeCrypto && typeof nodeCrypto.createHash === 'function') {
      return nodeCrypto.createHash('sha1').update(text, 'utf8').digest('hex').toLowerCase();
    }
  } catch {}

  // 2. Si nodeCrypto est disponible sur globalThis
  try {
    const gCrypto = typeof globalThis !== 'undefined' ? (globalThis as any).crypto : null;
    if (gCrypto && typeof gCrypto.createHash === 'function') {
      return gCrypto.createHash('sha1').update(text, 'utf8').digest('hex').toLowerCase();
    }
  } catch {}

// 3. Implémentation standard RFC 3174 SHA-1 conforme à 100% avec Node crypto & crypto.subtle
  const enc = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(text) : Buffer.from(text, 'utf8');
  const len = enc.length;
  const bitLen = len * 8;
  const padLen = (len % 64 < 56) ? (56 - (len % 64)) : (120 - (len % 64));
  const totalLen = len + padLen + 8;
  const bytes = new Uint8Array(totalLen);
  bytes.set(enc);
  bytes[len] = 0x80;
  const view = new DataView(bytes.buffer);
  view.setUint32(totalLen - 4, bitLen >>> 0);
  view.setUint32(totalLen - 8, Math.floor(bitLen / 0x100000000));

  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);

  for (let i = 0; i < totalLen; i += 64) {
    for (let t = 0; t < 16; t++) {
      w[t] = view.getUint32(i + t * 4);
    }
    for (let t = 16; t < 80; t++) {
      const v = w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16];
      w[t] = (v << 1) | (v >>> 31);
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let t = 0; t < 80; t++) {
      let f: number, k: number;
      if (t < 20) {
        f = (b & c) | ((~b) & d);
        k = 0x5a827999;
      } else if (t < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (t < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[t]) >>> 0;
      e = d;
      d = c;
      c = ((b << 30) | (b >>> 2)) >>> 0;
      b = a;
      a = temp;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }
  const hex = (n: number) => n.toString(16).padStart(8, '0');
  return (hex(h0) + hex(h1) + hex(h2) + hex(h3) + hex(h4)).toLowerCase();
}

/**
 * Version asynchrone utilisant crypto.subtle dans les navigateurs modernes (Web Crypto API standard).
 */
export async function computeSha1Subtle(text: string): Promise<string> {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) {
    const enc = new TextEncoder();
    const data = enc.encode(text);
    const hashBuf = await globalThis.crypto.subtle.digest('SHA-1', data);
    const hashArr = Array.from(new Uint8Array(hashBuf));
    return hashArr.map(b => b.toString(16).padStart(2, '0')).join('').toLowerCase();
  }
  return computeSha1(text);
}

/**
 * Calcule le hash SHA-1 du texte de chaque paragraphe (Étape 5).
 */
export function computeParagraphSha1(text: string): string {
  return computeSha1(text ? text.trim() : '');
}

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
 * Calcule pour chaque paragraphe son hash SHA-1 conforme à l'Étape 5.
 */
export function parseSermonParagraphs(text: string): ParsedParagraph[] {
  if (!text || typeof text !== 'string') return [];
  
  const rawParagraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  
  return rawParagraphs.map((raw, idx) => {
    const trimmed = raw.trim();
    const leadingNumMatch = trimmed.match(/^(\d+)[\.\s]/);
    const num = leadingNumMatch ? parseInt(leadingNumMatch[1], 10) : idx + 1;
    const sha1 = computeParagraphSha1(trimmed);
    
    return {
      num,
      text: trimmed,
      sha1,
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
    const paragraphSha1s = currentGroup.map(p => p.sha1 || computeParagraphSha1(p.text));
    const paragraphSha1 = computeParagraphSha1(chunkText);
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
      paragraphSha1,
      paragraphSha1s,
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
 * Normalise un sermon brut (depuis library.json ou autre source) exactement comme
 * main.js (db:importSermons L376-397 + db:getAllSermonsWithParagraphs L235-240) :
 * - Identifiant : `${baseId}-${s.version}` si `s.version` est présent (idempotent si déjà suffixé)
 * - Texte : découpage par `/\n\s*\n/`, `.trim()` de chaque paragraphe non vide, jointure par `'\n\n'`
 */
export function normalizeSermonForSqlite(s: Sermon): Sermon {
  const baseId = s.id || `gen-${Math.random().toString(36).substr(2, 9)}`;
  const isSpecialDoc = baseId.startsWith('expose-ch-') || baseId.startsWith('bible-') || baseId.startsWith('song-');
  const sId = (!isSpecialDoc && s.version && !baseId.endsWith(`-${s.version}`))
    ? `${baseId}-${s.version}`
    : baseId;
  const sText = s.text || '...';
  const segments = sText.split(/\n\s*\n/);
  const cleanParagraphs: string[] = [];
  segments.forEach((p) => {
    const content = p.trim();
    if (content) {
      cleanParagraphs.push(content);
    }
  });

  return {
    ...s,
    id: sId,
    title: s.title || 'Sermon sans titre',
    date: s.date || '0000-00-00',
    city: s.city || '',
    version: s.version || 'VGR',
    time: s.time || 'Inconnu',
    audio_url: s.audio_url || '',
    text: cleanParagraphs.join('\n\n')
  };
}

/**
 * Normalise et ordonne une liste de sermons exactement comme le cycle SQLite
 * `db:importSermons` (INSERT OR REPLACE INTO sermons) + `db:getAllSermonsWithParagraphs` (SELECT * FROM sermons ORDER BY date DESC).
 */
export function normalizeSermonsForSqlite(sermons: Sermon[]): Sermon[] {
  if (!Array.isArray(sermons)) return [];
  const byId = new Map<string, Sermon>();
  for (const s of sermons) {
    if (!s) continue;
    const norm = normalizeSermonForSqlite(s);
    byId.set(norm.id, norm);
  }
  return Array.from(byId.values()).sort((a, b) => {
    const dA = a.date || '0000-00-00';
    const dB = b.date || '0000-00-00';
    if (dB > dA) return 1;
    if (dB < dA) return -1;
    return 0;
  });
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
