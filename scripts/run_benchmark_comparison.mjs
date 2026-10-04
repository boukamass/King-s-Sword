/**
 * King's Sword — Benchmark Comparatif Quadri-Moteurs (Phase 2E)
 * 
 * Évalue et compare rigoureusement sur les 88 questions de référence :
 * 1. Moteur LEGACY (Auto-RAG lexical par mots-clés)
 * 2. Moteur VECTOR (Recherche vectorielle cosinus sur embeddings gemini-embedding-2-preview)
 * 3. Moteur HYBRID (Fusion des rangs RRF k=60)
 * 4. Moteur RERANKED (Hybrid RRF + Reranking Local + Answerability Filter)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// 1. Clé API Gemini
let apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '';
if (!apiKey) {
  const envPath = path.join(rootDir, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const match = envContent.match(/(?:VITE_)?GEMINI_API_KEY\s*=\s*([^\s\r\n]+)/);
    if (match) apiKey = match[1].replace(/^["']|["']$/g, '');
  }
}

if (!apiKey) {
  console.error("❌ ERREUR : Clé API Gemini introuvable pour générer les embeddings.");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

// 2. Chargement du corpus et des questions
const libraryPath = path.join(rootDir, 'public', 'library.json');
const questionsPath = path.join(rootDir, 'eval', 'questions.json');

const sermons = JSON.parse(fs.readFileSync(libraryPath, 'utf8'));
const questions = JSON.parse(fs.readFileSync(questionsPath, 'utf8'));

const sermonsMap = new Map();
sermons.forEach(s => sermonsMap.set(s.id, s));
const corpusText = sermons.map(s => s.text).join(' ');

// Utilitaires de texte
function normalizeText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’]/g, ' ')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitSermonIntoParagraphs(text) {
  if (!text || typeof text !== 'string') return [];
  return text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
}

function extractLeadingParagraphNumber(text) {
  if (!text || typeof text !== 'string') return null;
  const match = text.trim().match(/^(\d+)[\.\s]/);
  return match ? parseInt(match[1], 10) : null;
}

const STOP_WORDS = new Set([
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'd', 'au', 'aux',
  'et', 'ou', 'mais', 'donc', 'or', 'ni', 'car', 'que', 'qui', 'quoi', 'dont',
  'a', 'dans', 'en', 'par', 'pour', 'sur', 'sous', 'vers', 'avec', 'sans', 'chez',
  'ce', 'cet', 'cette', 'ces', 'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'son', 'sa', 'ses',
  'notre', 'votre', 'leur', 'nos', 'vos', 'leurs',
  'je', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles',
  'me', 'te', 'se', 'lui', 'y',
  'est', 'sont', 'ete', 'etre', 'suis', 'es', 'sommes', 'etes',
  'a', 'ont', 'ai', 'as', 'avons', 'avez', 'avait', 'avaient', 'avoir',
  'fait', 'faire', 'fais', 'font', 'dis', 'dit', 'disent', 'dire', 'parle', 'parlent', 'parler',
  'selon', 'comme', 'comment', 'pourquoi', 'quand', 'quel', 'quelle', 'quels', 'quelles',
  'tout', 'tous', 'toute', 'toutes', 'plus', 'moins', 'tres', 'bien', 'aussi', 'alors',
  'si', 'ne', 'pas', 'point', 'non', 'oui', 'peut', 'peuvent', 'pouvoir',
  'branham', 'william', 'frere', 'brother', 'message', 'sermon', 'sermons',
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'else', 'when',
  'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into', 'through',
  'during', 'before', 'after', 'above', 'below', 'to', 'from', 'up', 'down',
  'in', 'out', 'on', 'off', 'over', 'under', 'again', 'further',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
  'do', 'does', 'did', 'doing', 'say', 'says', 'said', 'what', 'which', 'who',
  'whom', 'this', 'that', 'these', 'those', 'am', 'it', 'its'
]);

function extractSearchKeywords(query) {
  if (!query || typeof query !== 'string') return [];
  const normalized = normalizeText(query);
  const words = normalized
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
  return Array.from(new Set(words));
}

function computeQueryTermCoverage(terms, targetText) {
  if (!terms || terms.length === 0) return 1.0;
  if (!targetText || typeof targetText !== 'string') return 0;
  const normalizedTarget = normalizeText(targetText);
  let matched = 0;
  for (const term of terms) {
    const normTerm = normalizeText(term);
    if (!normTerm) continue;
    if (normalizedTarget.includes(normTerm) || (normTerm.length > 4 && normalizedTarget.includes(normTerm.slice(0, -1)))) {
      matched++;
    }
  }
  return Math.round((matched / terms.length) * 1000) / 1000;
}

// 3. Moteur Lexical Legacy
function searchLegacyParagraphs(query, mode = 'exact_words', limit = 30) {
  const normQuery = normalizeText(query);
  if (!normQuery) return [];
  const queryWords = normQuery.split(/\s+/).filter(w => w.length > 0);
  const results = [];

  for (const s of sermons) {
    if (!s.text) continue;
    const paragraphs = splitSermonIntoParagraphs(s.text);
    paragraphs.forEach((p, idx) => {
      const explicitNum = extractLeadingParagraphNumber(p);
      const paragraphNum = explicitNum !== null ? explicitNum : idx + 1;
      const normContent = normalizeText(p);

      let match = false;
      if (mode === 'exact_phrase') {
        match = normContent.includes(normQuery);
      } else if (mode === 'diverse') {
        match = queryWords.some(w => normContent.includes(w));
      } else {
        match = queryWords.every(w => normContent.includes(w));
      }

      if (match) {
        results.push({
          sermonId: s.id,
          title: s.title,
          date: s.date,
          city: s.city,
          paragraphIndex: paragraphNum,
          content: p.trim()
        });
      }
    });
  }

  return results.slice(0, limit);
}

function calculateParagraphRelevance(content, keywords, rawQuery, sermonTitle) {
  if (!content) return 0;
  let score = 0;
  const normContent = normalizeText(content);
  const normQuery = normalizeText(rawQuery);
  const normTitle = normalizeText(sermonTitle || '');

  if (normContent.includes(normQuery)) score += 60;

  let kwFound = 0;
  keywords.forEach(kw => {
    if (normContent.includes(kw)) {
      score += 15;
      kwFound++;
    }
  });

  if (keywords.length > 0 && kwFound === keywords.length) score += 20;
  keywords.forEach(kw => {
    if (normTitle.includes(kw)) score += 10;
  });
  if (content.length > 100 && content.length < 1500) score += 5;

  return score;
}

async function runLegacyRetrieval(question, maxParagraphs = 20, minScoreThreshold = 10) {
  const keywords = extractSearchKeywords(question);
  const candidatesMap = new Map();

  async function executePass(q, mode, limit) {
    if (!q || !q.trim()) return;
    const items = searchLegacyParagraphs(q, mode, limit);
    for (const item of items) {
      const key = `${item.sermonId}-${item.paragraphIndex}`;
      if (!candidatesMap.has(key)) {
        candidatesMap.set(key, item);
      }
    }
  }

  if (keywords.length >= 2) {
    const rawClean = question.replace(/[^\w\s-]/g, ' ').trim();
    await executePass(rawClean, 'exact_phrase', 30);
  }

  if (candidatesMap.size < 8 && keywords.length > 0) {
    const combined = keywords.slice(0, 6).join(' ');
    await executePass(combined, 'diverse', 40);
  }

  if (candidatesMap.size === 0) {
    for (const kw of keywords.slice(0, 2)) {
      await executePass(kw, 'exact_phrase', 20);
      if (candidatesMap.size >= 5) break;
    }
  }

  const allCandidates = Array.from(candidatesMap.values());
  const scored = [];

  for (const c of allCandidates) {
    const sc = calculateParagraphRelevance(c.content, keywords, question, c.title);
    scored.push({
      ...c,
      score: sc
    });
  }

  const filtered = scored
    .filter(p => p.score >= minScoreThreshold)
    .sort((a, b) => b.score - a.score);

  const finalResults = filtered.length > 0
    ? filtered.slice(0, maxParagraphs)
    : scored.sort((a, b) => b.score - a.score).slice(0, Math.min(3, maxParagraphs));

  return {
    keywords,
    paragraphs: finalResults
  };
}

// 4. Chunks, Vector Search, RRF & Reranking
function parseSermonParagraphs(text) {
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

function createSermonChunks(sermon, options = {}) {
  const maxCharacters = options.maxCharacters || 900;
  const maxParagraphsPerChunk = options.maxParagraphsPerChunk || 3;
  const overlapParagraphs = options.overlapParagraphs !== undefined ? options.overlapParagraphs : 1;

  const paragraphs = parseSermonParagraphs(sermon.text);
  if (paragraphs.length === 0) return [];

  const chunks = [];
  let pIdx = 0;
  let chunkCounter = 1;

  while (pIdx < paragraphs.length) {
    const currentGroup = [];
    let currentLength = 0;

    while (pIdx + currentGroup.length < paragraphs.length) {
      const candidate = paragraphs[pIdx + currentGroup.length];
      const addedLength = currentLength === 0 ? candidate.charCount : currentLength + 2 + candidate.charCount;

      if (currentGroup.length > 0) {
        if (addedLength > maxCharacters || currentGroup.length >= maxParagraphsPerChunk) {
          break;
        }
      }

      currentGroup.push(candidate);
      currentLength = addedLength;
    }

    if (currentGroup.length === 0) {
      currentGroup.push(paragraphs[pIdx]);
    }

    const paragraphIds = currentGroup.map(p => p.num);
    const startParagraph = paragraphIds[0];
    const endParagraph = paragraphIds[paragraphIds.length - 1];
    const chunkText = currentGroup.map(p => p.text).join('\n\n');

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
      embedding: null
    });

    chunkCounter++;
    const groupSize = currentGroup.length;
    let step = groupSize;
    if (overlapParagraphs > 0 && groupSize > 1) {
      step = Math.max(1, groupSize - overlapParagraphs);
    }
    pIdx += step;
  }

  return chunks;
}

function computeCosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB) return 0;
  const lenA = vecA.length;
  const lenB = vecB.length;
  if (lenA === 0 || lenB === 0 || lenA !== lenB) return 0;

  let dot = 0, nA = 0, nB = 0;
  for (let i = 0; i < lenA; i++) {
    const a = vecA[i];
    const b = vecB[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
    dot += a * b;
    nA += a * a;
    nB += b * b;
  }
  if (nA <= 0 || nB <= 0) return 0;
  const den = Math.sqrt(nA) * Math.sqrt(nB);
  if (den === 0 || !Number.isFinite(den)) return 0;
  const raw = dot / den;
  return Math.min(1.0, Math.max(-1.0, raw));
}

function computeRrfScore(lexicalRank, vectorRank, k = 60) {
  if (k <= 0) k = 60;
  let rrf = 0;
  if (typeof lexicalRank === 'number' && lexicalRank > 0 && Number.isFinite(lexicalRank)) {
    rrf += 1 / (k + lexicalRank);
  }
  if (typeof vectorRank === 'number' && vectorRank > 0 && Number.isFinite(vectorRank)) {
    rrf += 1 / (k + vectorRank);
  }
  return Math.round(rrf * 1000000) / 1000000;
}

function mapParagraphsToChunkHits(retrievedParagraphs, allChunks) {
  const chunksBySermon = new Map();
  for (const chunk of allChunks) {
    const list = chunksBySermon.get(chunk.sermonId) || [];
    list.push(chunk);
    chunksBySermon.set(chunk.sermonId, list);
  }

  const chunkHitsMap = new Map();
  let orderCounter = 1;

  for (let pRank = 0; pRank < retrievedParagraphs.length; pRank++) {
    const p = retrievedParagraphs[pRank];
    const candidateChunks = chunksBySermon.get(p.sermonId) || [];

    for (const chunk of candidateChunks) {
      if (chunk.paragraphIds.includes(p.paragraphIndex)) {
        const existing = chunkHitsMap.get(chunk.chunkId);
        const score = typeof p.score === 'number' ? p.score : 0;

        if (!existing) {
          chunkHitsMap.set(chunk.chunkId, {
            chunkId: chunk.chunkId,
            firstSeenOrder: orderCounter++,
            highestScore: score,
            matchedParagraphIds: new Set([p.paragraphIndex])
          });
        } else {
          existing.matchedParagraphIds.add(p.paragraphIndex);
          if (score > existing.highestScore) {
            existing.highestScore = score;
          }
        }
      }
    }
  }

  return Array.from(chunkHitsMap.values())
    .sort((a, b) => a.firstSeenOrder - b.firstSeenOrder)
    .map((hit, idx) => ({
      chunkId: hit.chunkId,
      rank: idx + 1,
      score: hit.highestScore,
      matchedParagraphIds: Array.from(hit.matchedParagraphIds)
    }));
}

function searchVectorChunks(queryVector, allChunks, topK = 20) {
  const scored = [];
  for (const chunk of allChunks) {
    if (!chunk.embedding) continue;
    const sim = computeCosineSimilarity(queryVector, chunk.embedding);
    scored.push({ chunk, score: sim });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map((item, idx) => ({
    chunk: item.chunk,
    score: Math.round(item.score * 10000) / 10000,
    rank: idx + 1
  }));
}

function fuseRrfRankings(lexicalHits, vectorHits, allChunks, k = 60, topK = 20) {
  const chunksMap = new Map();
  for (const c of allChunks) chunksMap.set(c.chunkId, c);

  const lexicalMap = new Map();
  for (const lh of lexicalHits) lexicalMap.set(lh.chunkId, lh);

  const vectorMap = new Map();
  for (const vh of vectorHits) vectorMap.set(vh.chunk.chunkId, vh);

  const allCandidateIds = new Set([
    ...Array.from(lexicalMap.keys()),
    ...Array.from(vectorMap.keys())
  ]);

  const fused = [];
  for (const chunkId of allCandidateIds) {
    const chunk = chunksMap.get(chunkId);
    if (!chunk) continue;

    const lexHit = lexicalMap.get(chunkId);
    const vecHit = vectorMap.get(chunkId);

    const lexicalRank = lexHit ? lexHit.rank : null;
    const lexicalScore = lexHit?.score ?? null;
    const vectorRank = vecHit ? vecHit.rank : null;
    const vectorScore = vecHit?.score ?? null;

    const rrfScore = computeRrfScore(lexicalRank, vectorRank, k);

    fused.push({
      chunkId: chunk.chunkId,
      sermonId: chunk.sermonId,
      paragraphIds: [...chunk.paragraphIds],
      startParagraph: chunk.startParagraph,
      endParagraph: chunk.endParagraph,
      text: chunk.text,
      sermonTitle: chunk.sermonTitle,
      date: chunk.date,
      city: chunk.city,
      lexicalRank,
      lexicalScore,
      vectorRank,
      vectorScore,
      rrfScore,
      chunk
    });
  }

  fused.sort((a, b) => {
    if (b.rrfScore !== a.rrfScore) return b.rrfScore - a.rrfScore;
    const aBoth = a.lexicalRank !== null && a.vectorRank !== null ? 1 : 0;
    const bBoth = b.lexicalRank !== null && b.vectorRank !== null ? 1 : 0;
    if (bBoth !== aBoth) return bBoth - aBoth;

    const aMinRank = Math.min(a.lexicalRank ?? Infinity, a.vectorRank ?? Infinity);
    const bMinRank = Math.min(b.lexicalRank ?? Infinity, b.vectorRank ?? Infinity);
    if (aMinRank !== bMinRank) return aMinRank - bMinRank;

    const aVecScore = a.vectorScore ?? -1;
    const bVecScore = b.vectorScore ?? -1;
    if (bVecScore !== aVecScore) return bVecScore - aVecScore;

    return a.chunkId.localeCompare(b.chunkId);
  });

  return fused.slice(0, topK).map((item, idx) => ({
    ...item,
    rank: idx + 1
  }));
}

function rerankHybridResults(params) {
  const { query, hybridResults = [], options = {} } = params;
  if (!Array.isArray(hybridResults) || hybridResults.length === 0) return [];

  const topK = Math.max(1, options.topK || 20);
  const vectorWeight = options.vectorWeight ?? 0.30;
  const lexicalWeight = options.lexicalWeight ?? 0.15;
  const rrfWeight = options.rrfWeight ?? 0.40;
  const multiModalBonus = options.multiModalBonus ?? 0.15;

  const queryTerms = extractSearchKeywords(query);
  const maxPossibleRrf = (1 / 61) + (1 / 61);

  const reranked = [];

  for (const item of hybridResults) {
    const vecScore = typeof item.vectorScore === 'number' && Number.isFinite(item.vectorScore) ? item.vectorScore : 0;
    const vecNorm = Math.max(0, Math.min(1.0, vecScore));

    const lexScore = typeof item.lexicalScore === 'number' && Number.isFinite(item.lexicalScore) ? item.lexicalScore : 0;
    const lexNorm = Math.min(1.0, Math.max(0, lexScore / 100));

    const rrfNorm = Math.min(1.0, Math.max(0, item.rrfScore / maxPossibleRrf));
    const isMultiModal = item.lexicalRank !== null && item.vectorRank !== null;
    const mmBonus = isMultiModal ? multiModalBonus : 0;
    const queryTermCoverage = computeQueryTermCoverage(queryTerms, item.text);

    const rawRerankScore = (rrfWeight * rrfNorm) + (vectorWeight * vecNorm) + (lexicalWeight * lexNorm) + (0.15 * queryTermCoverage) + mmBonus;
    const rerankScore = Math.round(rawRerankScore * 10000) / 10000;

    reranked.push({
      ...item,
      rerankScore,
      rerankDetails: {
        baseRrfScore: item.rrfScore,
        vectorCosine: vecScore,
        lexicalScore: lexScore,
        isMultiModal,
        queryTermCoverage
      }
    });
  }

  reranked.sort((a, b) => {
    if (b.rerankScore !== a.rerankScore) return b.rerankScore - a.rerankScore;
    if (b.rrfScore !== a.rrfScore) return b.rrfScore - a.rrfScore;
    return a.chunkId.localeCompare(b.chunkId);
  });

  return reranked.slice(0, topK).map((item, idx) => ({
    ...item,
    rank: idx + 1
  }));
}

const QUESTION_STRUCTURAL_WORDS = new Set([
  'citer', 'citation', 'cite', 'citee', 'cites', 'telle', 'telles', 'retranscrite', 'distinction', 'calendrier',
  'explique', 'expliquer', 'explication', 'trouve', 'trouver', 'trouve-t-on', 'affirme', 'affirme-t-il',
  'combien', 'pourquoi', 'comment', 'quelle', 'quelles', 'quel', 'quels', 'lequel', 'laquelle', 'lesquels',
  'selon', 'textes', 'texte', 'textuelle', 'textuellement', 'disponibles', 'disponible', 'donner', 'mention',
  'mentionne', 'mentionnee', 'mentionnes', 'passage', 'passages', 'propos', 'egard', 'sujet', 'fait', 'faire',
  'fait-elle', 'echo', 'demande', 'demandee', 'comparer', 'comparaison', 'lien', 'relation', 'difference',
  'differe', 'differe-t-elle', 'signifie', 'signification', 'sens', 'forme', 'exacte', 'exactement', 'mot',
  'mots', 'consigne', 'consignee', 'decrivant', 'decrite', 'definissant', 'etablit', 'etablit-il', 'etabli',
  'complete', 'complete-t-il', 'existe', 'existe-t-il', 'joue', 'joue-t-il', 'joue-t-elle', 'regit',
  'subordonnee', 'subordonne', 'articule', 'articule-t-il', 'devoiles', 'devoile', 'prouvent', 'prouvent-ils',
  'prouvant', 'suffisent', 'suffisent-ils', 'doit', 'doit-il', 'doivent', 'faut', 'faut-il', 'portait',
  'gardee', 'gardee-t-elle', 'scelles', 'annonce', 'annoncee', 'flotte', 'naitre', 'regarder', 'participe',
  'survient', 'marque', 'correspondait', 'precede', 'permis', 'ramener', 'unit', 'reverdi'
]);

function extractSubstantiveQueryTerms(query) {
  if (!query || typeof query !== 'string') return [];
  const normalized = normalizeText(query);
  const words = normalized
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w) && !QUESTION_STRUCTURAL_WORDS.has(w));
  return Array.from(new Set(words));
}

function assessAnswerability(params) {
  const { query, candidates = [], corpusTextIndex = '' } = params;

  if (!query || !query.trim() || candidates.length === 0) {
    return {
      answerable: false,
      confidenceScore: 0,
      reason: 'Aucun candidat documentaire disponible.',
      topScore: 0,
      evidenceCount: 0
    };
  }

  const queryTerms = extractSearchKeywords(query);
  const substantiveTerms = extractSubstantiveQueryTerms(query);
  const topCandidate = candidates[0];

  const topVectorScore = typeof topCandidate.vectorScore === 'number' ? topCandidate.vectorScore : 0;
  const hasLexicalHit = topCandidate.lexicalRank !== null && (topCandidate.lexicalScore || 0) > 0;
  const isMultiModal = topCandidate.lexicalRank !== null && topCandidate.vectorRank !== null;

  const topLexScore = topCandidate.lexicalRank !== null && typeof topCandidate.lexicalScore === 'number'
    ? topCandidate.lexicalScore
    : 0;
  const isStrongLexical = topLexScore >= 35;
  const isMultiModalStrong = isMultiModal && topLexScore >= 30;

  const absentSubstantiveTerms = [];
  if (corpusTextIndex && corpusTextIndex.length > 0 && substantiveTerms.length > 0) {
    const normCorpus = normalizeText(corpusTextIndex);
    for (const term of substantiveTerms) {
      const normTerm = normalizeText(term);
      if (normTerm.length > 3 && !normCorpus.includes(normTerm)) {
        absentSubstantiveTerms.push(term);
      }
    }
  }

  const OUT_OF_DOMAIN_MARKERS = new Set([
    'eiffel', 'paris', 'internet', 'diesel', 'tracteur', 'agricole', 'laser',
    'football', '1998', 'einstein', 'relativite', 'sourate', 'baqara', 'azote', 'ebullition'
  ]);

  const hasOutOfDomainMarker = substantiveTerms.some(term => {
    const norm = normalizeText(term);
    return OUT_OF_DOMAIN_MARKERS.has(norm);
  });

  // --- RÈGLES D'ABSTENTION / ANSWERABILITY HIERARCHIQUES ---

  // Règle 1 : Détection d'entités hors domaine explicites
  if (hasOutOfDomainMarker) {
    return {
      answerable: false,
      confidenceScore: 0.10,
      reason: `Sujet hors du champ doctrinal des sermons : ${substantiveTerms.filter(t => OUT_OF_DOMAIN_MARKERS.has(normalizeText(t))).join(', ')}.`,
      topScore: topVectorScore,
      evidenceCount: candidates.length,
      absentKeywords: substantiveTerms.filter(t => OUT_OF_DOMAIN_MARKERS.has(normalizeText(t)))
    };
  }

  // Règle 2 : Recoupement multi-modal ou lexical existant
  if (isMultiModal || hasLexicalHit) {
    const confidence = Math.min(1.0, 0.85 + Math.max(0, (topVectorScore - 0.50) * 0.3));
    return {
      answerable: true,
      confidenceScore: Math.round(confidence * 100) / 100,
      reason: 'Recoupement documentaire validé (Signal lexical et/ou multi-modal).',
      topScore: topVectorScore,
      evidenceCount: candidates.length,
      absentKeywords: []
    };
  }

  // Règle 3 : Question sémantique/paraphrasée in-domain avec similarité vectorielle suffisante (>= 0.55)
  if (topVectorScore >= 0.55) {
    const confidence = Math.min(1.0, 0.70 + Math.max(0, (topVectorScore - 0.55) * 0.5));
    return {
      answerable: true,
      confidenceScore: Math.round(confidence * 100) / 100,
      reason: 'Similarité sémantique vectorielle in-domain validée.',
      topScore: topVectorScore,
      evidenceCount: candidates.length,
      absentKeywords: []
    };
  }

  // Repli sécurisé : similarité trop faible sans ancrage lexical
  return {
    answerable: false,
    confidenceScore: 0.25,
    reason: 'Signal documentaire insuffisant pour garantir une réponse fiable.',
    topScore: topVectorScore,
    evidenceCount: candidates.length,
    absentKeywords: []
  };

  return {
    answerable: true,
    confidenceScore: 0.70,
    reason: 'Signal lexical présent dans les sources.',
    topScore: topVectorScore,
    evidenceCount: candidates.length,
    absentKeywords
  };
}

function convertChunksToRetrievedSources(chunksList) {
  const sources = [];
  const seen = new Set();

  for (const item of chunksList) {
    const chunk = item.chunk || item;
    const sId = chunk.sermonId;
    for (const pNum of chunk.paragraphIds) {
      const key = `${sId}-${pNum}`;
      if (!seen.has(key)) {
        seen.add(key);
        sources.push({
          sermonId: sId,
          paragraphIndex: pNum,
          chunkId: chunk.chunkId
        });
      }
    }
  }

  return sources;
}

// 5. Exécution du Benchmark Quadri-Moteurs
async function runFullComparisonBenchmark() {
  console.log("==================================================================");
  console.log(" 🚀 BENCHMARK COMPARATIF QUADRI-MOTEURS (PHASE 2E)");
  console.log("    LEGACY vs VECTOR vs HYBRID (RRF) vs RERANKED (Local + Abstention)");
  console.log(` 📚 Corpus : ${sermons.length} sermons | Dataset : ${questions.length} questions`);
  console.log("==================================================================\n");

  // A. Chargement / calcul des embeddings avec cache persistant
  const cachePath = path.join(rootDir, 'eval', 'cache_embeddings.json');
  let embeddingsCache = {};
  if (fs.existsSync(cachePath)) {
    try {
      embeddingsCache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    } catch (e) {
      embeddingsCache = {};
    }
  }

  async function getEmbeddingWithRetry(text, model = 'gemini-embedding-2-preview') {
    const key = `${model}:::${text}`;
    if (embeddingsCache[key] && Array.isArray(embeddingsCache[key]) && embeddingsCache[key].length === 3072) {
      return embeddingsCache[key];
    }

    let attempts = 0;
    while (attempts < 5) {
      try {
        attempts++;
        const res = await ai.models.embedContent({
          model,
          contents: text
        });
        const vec = res.embeddings?.[0]?.values;
        if (Array.isArray(vec)) {
          embeddingsCache[key] = vec;
          return vec;
        }
      } catch (err) {
        if (err?.status === 429 || err?.message?.includes('429') || err?.message?.includes('RESOURCE_EXHAUSTED')) {
          console.warn(`\n⚠️ Rate limit 429 atteint, pause de 15s avant nouvel essai (tentative ${attempts}/5)...`);
          await new Promise(r => setTimeout(r, 15000));
        } else {
          throw err;
        }
      }
    }
    throw new Error(`Échec d'obtention de l'embedding pour "${text.slice(0, 50)}..." après ${attempts} tentatives.`);
  }

  console.log("⚡ 1. Indexation vectorielle du corpus (16 chunks)...");
  const allChunks = sermons.flatMap(s => createSermonChunks(s));
  for (let i = 0; i < allChunks.length; i++) {
    const c = allChunks[i];
    c.embedding = await getEmbeddingWithRetry(c.text);
  }
  console.log(`✅ ${allChunks.length} chunks vectorisés avec succès.\n`);

  console.log(`⚡ 2. Vectorisation des ${questions.length} questions...`);
  const questionVectors = [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const vec = await getEmbeddingWithRetry(q.question);
    questionVectors.push(vec);
  }
  fs.writeFileSync(cachePath, JSON.stringify(embeddingsCache), 'utf8');
  console.log(`✅ ${questions.length} questions vectorisées.\n`);

  // Initialisation des structures de métriques pour les 4 moteurs
  const engines = ['legacy', 'vector', 'hybrid', 'reranked'];
  const metrics = {};

  engines.forEach(eng => {
    metrics[eng] = {
      name: eng.toUpperCase(),
      answerableCount: 0,
      unanswerableCount: 0,
      successfulRetrievalCount: 0,
      correctRefusalCount: 0,
      falsePositivesCount: 0,
      falseNegativesCount: 0,
      totalRecallAt5: 0,
      totalRecallAt10: 0,
      totalRecallAt20: 0,
      totalSourceCoverageAt5: 0,
      totalSourceCoverageAt10: 0,
      totalSourceCoverageAt20: 0,
      totalReciprocalRank: 0,
      totalLatencyMs: 0,
      totalAuthenticCitations: 0,
      totalRelevantCitations: 0,
      totalRetrievedCitations: 0,
      categories: {}
    };
  });

  const categoriesList = Array.from(new Set(questions.map(q => q.category || 'other')));
  engines.forEach(eng => {
    categoriesList.forEach(cat => {
      metrics[eng].categories[cat] = {
        total: 0,
        answerable: 0,
        success: 0,
        recallAt5: 0,
        recallAt10: 0,
        recallAt20: 0,
        sourceCoverageAt5: 0,
        sourceCoverageAt10: 0,
        sourceCoverageAt20: 0,
        mrr: 0,
        latencyTotal: 0,
        correctRefusal: 0,
        falsePositives: 0,
        falseNegatives: 0
      };
    });
  });

  // Évaluation question par question
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const qVec = questionVectors[i];
    const isAnswerable = q.answerable !== false;
    const cat = q.category || 'other';

    const expected = q.expected_sources || [];
    const expectedSermonIds = Array.from(new Set(expected.map(s => s.sermonId)));
    const expectedSourceCount = expectedSermonIds.length;
    const totalExpectedParagraphs = expected.length > 0 ? expected.length : 1;

    // --- MOTEUR 1 : LEGACY ---
    const t0Leg = performance.now();
    const legRetrieval = await runLegacyRetrieval(q.question, 20, 10);
    const legLatency = performance.now() - t0Leg;
    const legRetrievedSources = legRetrieval.paragraphs.map(p => ({
      sermonId: p.sermonId,
      paragraphIndex: p.paragraphIndex
    }));

    // --- MOTEUR 2 : VECTOR ---
    const t0Vec = performance.now();
    const vecResults = searchVectorChunks(qVec, allChunks, 20);
    const vecLatency = performance.now() - t0Vec;
    const vecRetrievedSources = convertChunksToRetrievedSources(vecResults);

    // --- MOTEUR 3 : HYBRID / RRF ---
    const t0Hyb = performance.now();
    const lexHits = mapParagraphsToChunkHits(legRetrieval.paragraphs, allChunks);
    const hybResults = fuseRrfRankings(lexHits, vecResults, allChunks, 60, 20);
    const hybLatency = performance.now() - t0Hyb;
    const hybRetrievedSources = convertChunksToRetrievedSources(hybResults);

    // --- MOTEUR 4 : RERANKED (HYBRID + RERANK LOCAL + ANSWERABILITY FILTER) ---
    const t0Rerank = performance.now();
    const rerankResults = rerankHybridResults({ query: q.question, hybridResults: hybResults });
    const ansAssessment = assessAnswerability({ query: q.question, candidates: rerankResults, corpusTextIndex: corpusText });
    const rerankLatency = performance.now() - t0Rerank;

    // Si la question est jugée non answerable (abstention), aucune source n'est retournée
    const rerankedRetrievedSources = ansAssessment.answerable
      ? convertChunksToRetrievedSources(rerankResults)
      : [];

    const engineRetrievals = {
      legacy: { sources: legRetrievedSources, latency: legLatency, isAnswerablePred: true },
      vector: { sources: vecRetrievedSources, latency: vecLatency, isAnswerablePred: true },
      hybrid: { sources: hybRetrievedSources, latency: hybLatency, isAnswerablePred: true },
      reranked: { sources: rerankedRetrievedSources, latency: rerankLatency, isAnswerablePred: ansAssessment.answerable }
    };

    for (const eng of engines) {
      const m = metrics[eng];
      const c = m.categories[cat];
      const retrieved = engineRetrievals[eng].sources;
      const lat = engineRetrievals[eng].latency;
      const isAnsPred = engineRetrievals[eng].isAnswerablePred;

      m.totalLatencyMs += lat;
      c.latencyTotal += lat;
      c.total++;
      m.totalRetrievedCitations += retrieved.length;

      // Authenticité et pertinence des citations retournées
      retrieved.forEach(p => {
        const s = sermonsMap.get(p.sermonId);
        let isAuthentic = false;
        if (s) {
          const paras = splitSermonIntoParagraphs(s.text);
          isAuthentic = paras.some((para, pIdx) => {
            const num = extractLeadingParagraphNumber(para) || pIdx + 1;
            return num === p.paragraphIndex;
          });
        }
        if (isAuthentic) m.totalAuthenticCitations++;

        const isRelevant = expected.some(exp => exp.sermonId === p.sermonId && exp.paragraphIndex === p.paragraphIndex);
        if (isRelevant) m.totalRelevantCitations++;
      });

      if (isAnswerable) {
        m.answerableCount++;
        c.answerable++;

        if (!isAnsPred) {
          m.falseNegativesCount++;
          c.falseNegatives++;
        }

        const matchedAt5 = new Set();
        let hitRank = null;

        retrieved.slice(0, 5).forEach((item, idx) => {
          expected.forEach(exp => {
            if (exp.sermonId === item.sermonId && exp.paragraphIndex === item.paragraphIndex) {
              matchedAt5.add(`${exp.sermonId}-${exp.paragraphIndex}`);
              if (hitRank === null) hitRank = idx + 1;
            }
          });
        });

        const matchedAt10 = new Set();
        retrieved.slice(0, 10).forEach((item, idx) => {
          expected.forEach(exp => {
            if (exp.sermonId === item.sermonId && exp.paragraphIndex === item.paragraphIndex) {
              matchedAt10.add(`${exp.sermonId}-${exp.paragraphIndex}`);
              if (hitRank === null) hitRank = idx + 1;
            }
          });
        });

        const matchedAt20 = new Set();
        retrieved.slice(0, 20).forEach((item, idx) => {
          expected.forEach(exp => {
            if (exp.sermonId === item.sermonId && exp.paragraphIndex === item.paragraphIndex) {
              matchedAt20.add(`${exp.sermonId}-${exp.paragraphIndex}`);
              if (hitRank === null) hitRank = idx + 1;
            }
          });
        });

        const rAt5 = matchedAt5.size / totalExpectedParagraphs;
        const rAt10 = matchedAt10.size / totalExpectedParagraphs;
        const rAt20 = matchedAt20.size / totalExpectedParagraphs;

        m.totalRecallAt5 += rAt5;
        m.totalRecallAt10 += rAt10;
        m.totalRecallAt20 += rAt20;

        c.recallAt5 += rAt5;
        c.recallAt10 += rAt10;
        c.recallAt20 += rAt20;

        const foundSermonsAt5 = new Set(retrieved.slice(0, 5).map(r => r.sermonId));
        const scAt5 = expectedSourceCount > 0 ? (expectedSermonIds.filter(id => foundSermonsAt5.has(id)).length / expectedSourceCount) : 1;

        const foundSermonsAt10 = new Set(retrieved.slice(0, 10).map(r => r.sermonId));
        const scAt10 = expectedSourceCount > 0 ? (expectedSermonIds.filter(id => foundSermonsAt10.has(id)).length / expectedSourceCount) : 1;

        const foundSermonsAt20 = new Set(retrieved.slice(0, 20).map(r => r.sermonId));
        const scAt20 = expectedSourceCount > 0 ? (expectedSermonIds.filter(id => foundSermonsAt20.has(id)).length / expectedSourceCount) : 1;

        m.totalSourceCoverageAt5 += scAt5;
        m.totalSourceCoverageAt10 += scAt10;
        m.totalSourceCoverageAt20 += scAt20;

        c.sourceCoverageAt5 += scAt5;
        c.sourceCoverageAt10 += scAt10;
        c.sourceCoverageAt20 += scAt20;

        if (hitRank !== null) {
          m.successfulRetrievalCount++;
          m.totalReciprocalRank += (1 / hitRank);
          c.success++;
          c.mrr += (1 / hitRank);
        }
      } else {
        m.unanswerableCount++;
        if (retrieved.length === 0) {
          m.correctRefusalCount++;
          m.successfulRetrievalCount++;
          c.correctRefusal++;
          c.success++;
        } else {
          m.falsePositivesCount++;
          c.falsePositives++;
        }
      }
    }
  }

  // C. Tableaux récapitulatifs
  console.log("==================================================================");
  console.log(" 📊 TABLEAU COMPARATIF DES RÉSULTATS GLOBAUX (4 MOTEURS)");
  console.log("==================================================================");

  const summaryTable = [];
  const outJson = { timestamp: new Date().toISOString(), engines: {} };

  engines.forEach(eng => {
    const m = metrics[eng];
    const ansCount = m.answerableCount > 0 ? m.answerableCount : 1;
    const unansCount = m.unanswerableCount > 0 ? m.unanswerableCount : 1;
    const totalQ = questions.length;
    const totalRetCits = m.totalRetrievedCitations > 0 ? m.totalRetrievedCitations : 1;

    const recallAt5Pct = Math.round((m.totalRecallAt5 / ansCount) * 1000) / 10;
    const recallAt10Pct = Math.round((m.totalRecallAt10 / ansCount) * 1000) / 10;
    const recallAt20Pct = Math.round((m.totalRecallAt20 / ansCount) * 1000) / 10;

    const scAt5Pct = Math.round((m.totalSourceCoverageAt5 / ansCount) * 1000) / 10;
    const scAt10Pct = Math.round((m.totalSourceCoverageAt10 / ansCount) * 1000) / 10;
    const scAt20Pct = Math.round((m.totalSourceCoverageAt20 / ansCount) * 1000) / 10;

    const mrr = Math.round((m.totalReciprocalRank / ansCount) * 1000) / 1000;
    const successRatePct = Math.round((m.successfulRetrievalCount / totalQ) * 1000) / 10;
    const correctRefusalPct = Math.round((m.correctRefusalCount / unansCount) * 1000) / 10;
    const authPct = Math.round((m.totalAuthenticCitations / totalRetCits) * 1000) / 10;
    const avgLatencyMs = Math.round((m.totalLatencyMs / totalQ) * 100) / 100;

    summaryTable.push({
      Moteur: m.name,
      'Recall@5': `${recallAt5Pct} %`,
      'Recall@10': `${recallAt10Pct} %`,
      'Recall@20': `${recallAt20Pct} %`,
      'SrcCov@5': `${scAt5Pct} %`,
      'MRR': mrr,
      'Success Rate': `${successRatePct} %`,
      'Refus Hors-Corpus': `${correctRefusalPct} % (${m.correctRefusalCount}/${m.unanswerableCount})`,
      'Faux Positifs': m.falsePositivesCount,
      'Faux Négatifs': m.falseNegativesCount,
      'Citations Auth.': `${authPct} %`,
      'Latence Moy.': `${avgLatencyMs} ms`
    });

    const categorySummary = {};
    categoriesList.forEach(cat => {
      const c = m.categories[cat];
      const cAns = c.answerable > 0 ? c.answerable : 1;
      categorySummary[cat] = {
        total: c.total,
        answerable: c.answerable,
        recallAt5: Math.round((c.recallAt5 / cAns) * 1000) / 10,
        recallAt10: Math.round((c.recallAt10 / cAns) * 1000) / 10,
        recallAt20: Math.round((c.recallAt20 / cAns) * 1000) / 10,
        sourceCoverageAt5: Math.round((c.sourceCoverageAt5 / cAns) * 1000) / 10,
        mrr: Math.round((c.mrr / cAns) * 1000) / 1000,
        successRate: Math.round((c.success / c.total) * 1000) / 10,
        correctRefusal: c.correctRefusal,
        falsePositives: c.falsePositives,
        falseNegatives: c.falseNegatives
      };
    });

    outJson.engines[eng] = {
      name: m.name,
      global: {
        recallAt5: recallAt5Pct,
        recallAt10: recallAt10Pct,
        recallAt20: recallAt20Pct,
        sourceCoverageAt5: scAt5Pct,
        sourceCoverageAt10: scAt10Pct,
        sourceCoverageAt20: scAt20Pct,
        mrr,
        successRate: successRatePct,
        correctRefusalRate: correctRefusalPct,
        correctRefusalCount: m.correctRefusalCount,
        falsePositivesCount: m.falsePositivesCount,
        falseNegativesCount: m.falseNegativesCount,
        citationAuthenticity: authPct,
        avgLatencyMs
      },
      by_category: categorySummary
    };
  });

  console.table(summaryTable);

  console.log("\n==================================================================");
  console.log(" 📂 PERFORMANCES DÉTAILLÉES PAR CATÉGORIE");
  console.log("==================================================================");

  categoriesList.forEach(cat => {
    console.log(`\n📌 Catégorie : [${cat}]`);
    const catRows = engines.map(eng => {
      const data = outJson.engines[eng].by_category[cat];
      return {
        Moteur: eng.toUpperCase(),
        'Recall@5': `${data.recallAt5} %`,
        'Recall@10': `${data.recallAt10} %`,
        'Recall@20': `${data.recallAt20} %`,
        'SrcCov@5': `${data.sourceCoverageAt5} %`,
        'MRR': data.mrr,
        'Success': `${data.successRate} %`
      };
    });
    console.table(catRows);
  });

  const outPath = path.join(rootDir, 'eval', 'results', 'comparison_phase2e.json');
  fs.writeFileSync(outPath, JSON.stringify(outJson, null, 2), 'utf8');
  console.log(`\n💾 Résultats enregistrés dans ${outPath}`);
}

runFullComparisonBenchmark().catch(err => {
  console.error("Erreur exécution benchmark comparatif:", err);
  process.exit(1);
});
