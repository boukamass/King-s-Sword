/**
 * King's Sword — Framework d'évaluation et de Benchmark RAG
 * Mesure déterministe et reproductible des performances de retrieval
 * (Recall@5/10/20, MRR, Source Coverage@5/10/20, Citation Authenticity/Relevance, Latence locale)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// 1. Chargement de la bibliothèque
const libraryPath = path.join(rootDir, 'public', 'library.json');
if (!fs.existsSync(libraryPath)) {
  console.error("❌ Erreur : public/library.json introuvable.");
  process.exit(1);
}
const sermons = JSON.parse(fs.readFileSync(libraryPath, 'utf8'));
const sermonsMap = new Map();
sermons.forEach(s => sermonsMap.set(s.id, s));

// 2. Chargement du dataset d'évaluation
const questionsPath = path.join(rootDir, 'eval', 'questions.json');
if (!fs.existsSync(questionsPath)) {
  console.error("❌ Erreur : eval/questions.json introuvable.");
  process.exit(1);
}
const questions = JSON.parse(fs.readFileSync(questionsPath, 'utf8'));

// 3. Utilitaires de normalisation et découpage textuel (identiques au pipeline de production)
function normalizeText(text) {
  return (text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function splitSermonIntoParagraphs(text) {
  if (!text) return [];
  return text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
}

function extractLeadingParagraphNumber(text) {
  const match = text.trim().match(/^(\d+)[\.\s]/);
  return match ? parseInt(match[1], 10) : null;
}

const STOP_WORDS = new Set([
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'd', 'au', 'aux',
  'et', 'ou', 'mais', 'donc', 'or', 'ni', 'car', 'que', 'qui', 'quoi', 'dont', 'ou',
  'a', 'dans', 'en', 'par', 'pour', 'sur', 'sous', 'vers', 'avec', 'sans', 'chez',
  'ce', 'cet', 'cette', 'ces', 'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'son', 'sa', 'ses',
  'notre', 'votre', 'leur', 'nos', 'vos', 'leurs',
  'je', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles',
  'me', 'te', 'se', 'lui', 'leur', 'y', 'en',
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
    .filter(w => w.length > 2);
  const filtered = words.filter(w => !STOP_WORDS.has(w));
  if (filtered.length === 0) return words.filter(w => w.length > 3);
  return Array.from(new Set(filtered));
}

// 4. Implémentation fidèle du moteur Legacy Auto-RAG (Mode Web in-memory)
async function searchLegacyParagraphs(query, mode, limit = 50) {
  const normQuery = normalizeText(query);
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
    const items = await searchLegacyParagraphs(q, mode, limit);
    for (const item of items) {
      const key = `${item.sermonId}-${item.paragraphIndex}`;
      if (!candidatesMap.has(key)) {
        candidatesMap.set(key, item);
      }
    }
  }

  // Passe 1: Phrase exacte
  if (keywords.length >= 2) {
    const rawClean = question.replace(/[^\w\s-]/g, ' ').trim();
    await executePass(rawClean, 'exact_phrase', 30);
  }

  // Passe 2: Recherche large combinée (6 premiers mots-clés)
  if (candidatesMap.size < 8 && keywords.length > 0) {
    const combined = keywords.slice(0, 6).join(' ');
    await executePass(combined, 'diverse', 40);
  }

  // Passe 3: Mots-clés individuels si nécessaire
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

// 5. Exécution du benchmark complet
async function evaluateBenchmark() {
  console.log("==================================================================");
  console.log(" 🚀 EXÉCUTION DU BENCHMARK RAG — BASELINE LEGACY (KING'S SWORD)");
  console.log(` 📚 Corpus : ${sermons.length} sermons | Dataset : ${questions.length} questions`);
  console.log("==================================================================\n");

  const results = [];
  const latencies = [];

  let totalRecallAt5 = 0;
  let totalRecallAt10 = 0;
  let totalRecallAt20 = 0;
  let totalSourceCoverageAt5 = 0;
  let totalSourceCoverageAt10 = 0;
  let totalSourceCoverageAt20 = 0;
  let totalReciprocalRank = 0;
  let successfulRetrievalCount = 0;
  let answerableCount = 0;
  let correctRefusalCount = 0;
  let unanswerableCount = 0;
  let totalRetrievedCitations = 0;
  let totalAuthenticCitations = 0;
  let totalRelevantCitations = 0;

  const categoryStats = {};

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const isAnswerable = q.answerable !== false;
    if (isAnswerable) answerableCount++;
    else unanswerableCount++;

    const cat = q.category || 'other';
    if (!categoryStats[cat]) {
      categoryStats[cat] = {
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
        latencyTotal: 0
      };
    }
    categoryStats[cat].total++;
    if (isAnswerable) categoryStats[cat].answerable++;

    const t0 = performance.now();
    const retrieval = await runLegacyRetrieval(q.question, 20, 10);
    const latencyMs = Math.round((performance.now() - t0) * 100) / 100;
    latencies.push(latencyMs);
    categoryStats[cat].latencyTotal += latencyMs;

    const retrieved = retrieval.paragraphs;
    totalRetrievedCitations += retrieved.length;

    const expected = q.expected_sources || [];
    const expectedSermonIds = Array.from(new Set(expected.map(s => s.sermonId)));
    const expectedSourceCount = expectedSermonIds.length;

    // Analyse détaillée de chaque paragraphe récupéré : Authenticité vs Pertinence
    let questionAuthenticCount = 0;
    let questionRelevantCount = 0;

    const retrievedSourcesWithValidity = retrieved.map(p => {
      const s = sermonsMap.get(p.sermonId);
      let isAuthentic = false;
      if (s) {
        const paras = splitSermonIntoParagraphs(s.text);
        isAuthentic = paras.some((para, pIdx) => {
          const num = extractLeadingParagraphNumber(para) || pIdx + 1;
          return num === p.paragraphIndex;
        });
      }
      if (isAuthentic) {
        totalAuthenticCitations++;
        questionAuthenticCount++;
      }

      const isRelevant = expected.some(exp => 
        exp.sermonId === p.sermonId && exp.paragraphIndex === p.paragraphIndex
      );
      if (isRelevant) {
        totalRelevantCitations++;
        questionRelevantCount++;
      }

      return {
        sermonId: p.sermonId,
        paragraphIndex: p.paragraphIndex,
        title: p.title,
        score: p.score,
        citation_authenticity: isAuthentic,
        citation_relevance: isRelevant
      };
    });

    const isAllAuthentic = retrievedSourcesWithValidity.length === 0 
      ? true 
      : retrievedSourcesWithValidity.every(r => r.citation_authenticity);

    let hitRank = null;
    let hitAt5 = 0;
    let hitAt10 = 0;
    let hitAt20 = 0;
    let retrievedSourceCountAt5 = 0;
    let retrievedSourceCountAt10 = 0;
    let retrievedSourceCountAt20 = 0;
    let sourceCoverageAt5 = 0;
    let sourceCoverageAt10 = 0;
    let sourceCoverageAt20 = 0;

    if (isAnswerable) {
      // 1. Calcul strict de Recall@5, Recall@10, Recall@20 (au niveau paragraphe)
      const totalExpectedParagraphs = expected.length > 0 ? expected.length : 1;

      const matchedAt5 = new Set();
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

      hitAt5 = matchedAt5.size / totalExpectedParagraphs;
      hitAt10 = matchedAt10.size / totalExpectedParagraphs;
      hitAt20 = matchedAt20.size / totalExpectedParagraphs;

      // 2. Calcul strict de Source Coverage (au niveau sermon dédoublonné)
      const foundSermonsAt5 = new Set(retrieved.slice(0, 5).map(r => r.sermonId));
      const matchedSermonsAt5 = expectedSermonIds.filter(id => foundSermonsAt5.has(id));
      retrievedSourceCountAt5 = matchedSermonsAt5.length;
      sourceCoverageAt5 = expectedSourceCount > 0 ? (retrievedSourceCountAt5 / expectedSourceCount) : 1;

      const foundSermonsAt10 = new Set(retrieved.slice(0, 10).map(r => r.sermonId));
      const matchedSermonsAt10 = expectedSermonIds.filter(id => foundSermonsAt10.has(id));
      retrievedSourceCountAt10 = matchedSermonsAt10.length;
      sourceCoverageAt10 = expectedSourceCount > 0 ? (retrievedSourceCountAt10 / expectedSourceCount) : 1;

      const foundSermonsAt20 = new Set(retrieved.slice(0, 20).map(r => r.sermonId));
      const matchedSermonsAt20 = expectedSermonIds.filter(id => foundSermonsAt20.has(id));
      retrievedSourceCountAt20 = matchedSermonsAt20.length;
      sourceCoverageAt20 = expectedSourceCount > 0 ? (retrievedSourceCountAt20 / expectedSourceCount) : 1;

      if (hitRank !== null) {
        successfulRetrievalCount++;
        totalReciprocalRank += (1 / hitRank);
      }

      totalRecallAt5 += hitAt5;
      totalRecallAt10 += hitAt10;
      totalRecallAt20 += hitAt20;

      totalSourceCoverageAt5 += sourceCoverageAt5;
      totalSourceCoverageAt10 += sourceCoverageAt10;
      totalSourceCoverageAt20 += sourceCoverageAt20;

      if (hitRank !== null) {
        categoryStats[cat].success += 1;
        categoryStats[cat].mrr += (1 / hitRank);
      }
      categoryStats[cat].recallAt5 += hitAt5;
      categoryStats[cat].recallAt10 += hitAt10;
      categoryStats[cat].recallAt20 += hitAt20;
      categoryStats[cat].sourceCoverageAt5 += sourceCoverageAt5;
      categoryStats[cat].sourceCoverageAt10 += sourceCoverageAt10;
      categoryStats[cat].sourceCoverageAt20 += sourceCoverageAt20;
    } else {
      // Question hors corpus : le RAG doit refuser (aucun résultat pertinent ou score non concluant)
      const refused = retrieved.length === 0 || retrieved.every(p => (p.score || 0) < 15);
      if (refused) correctRefusalCount++;
    }

    const detailItem = {
      id: q.id,
      question: q.question,
      category: q.category,
      difficulty: q.difficulty,
      answerable: isAnswerable,
      expected_sources: q.expected_sources,
      expected_source_count: expectedSourceCount,
      retrieved_sources: retrievedSourcesWithValidity,
      retrieved_source_count_at_5: retrievedSourceCountAt5,
      retrieved_source_count_at_10: retrievedSourceCountAt10,
      retrieved_source_count_at_20: retrievedSourceCountAt20,
      source_coverage_at_5: Math.round(sourceCoverageAt5 * 1000) / 1000,
      source_coverage_at_10: Math.round(sourceCoverageAt10 * 1000) / 1000,
      source_coverage_at_20: Math.round(sourceCoverageAt20 * 1000) / 1000,
      rank: hitRank,
      citation_authenticity: isAllAuthentic,
      citation_relevance_count: questionRelevantCount,
      citation_relevance_precision: retrieved.length > 0 ? Math.round((questionRelevantCount / retrieved.length) * 1000) / 1000 : 0,
      recall_at_5: Math.round(hitAt5 * 1000) / 1000,
      recall_at_10: Math.round(hitAt10 * 1000) / 1000,
      recall_at_20: Math.round(hitAt20 * 1000) / 1000,
      retrieval_latency_ms: latencyMs
    };

    results.push(detailItem);

    const mark = isAnswerable 
      ? (hitRank !== null ? `✅ [Rank ${hitRank}]` : "❌ [Miss]")
      : (retrieved.length === 0 ? "🛡️ [Refusé]" : `⚠️ [${retrieved.length} faux positifs]`);
    console.log(`  [${q.id}] (${latencyMs}ms) ${mark} ${q.question.substring(0, 60)}...`);
  }

  // Calcul des percentiles de latence de recherche locale
  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.50)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];

  const finalMetrics = {
    total_questions: questions.length,
    answerable_questions: answerableCount,
    unanswerable_questions: unanswerableCount,
    recall_at_5: answerableCount > 0 ? Math.round((totalRecallAt5 / answerableCount) * 1000) / 10 : 0,
    recall_at_10: answerableCount > 0 ? Math.round((totalRecallAt10 / answerableCount) * 1000) / 10 : 0,
    recall_at_20: answerableCount > 0 ? Math.round((totalRecallAt20 / answerableCount) * 1000) / 10 : 0,
    source_coverage_at_5: answerableCount > 0 ? Math.round((totalSourceCoverageAt5 / answerableCount) * 1000) / 10 : 0,
    source_coverage_at_10: answerableCount > 0 ? Math.round((totalSourceCoverageAt10 / answerableCount) * 1000) / 10 : 0,
    source_coverage_at_20: answerableCount > 0 ? Math.round((totalSourceCoverageAt20 / answerableCount) * 1000) / 10 : 0,
    mrr: answerableCount > 0 ? Math.round((totalReciprocalRank / answerableCount) * 1000) / 1000 : 0,
    success_rate: answerableCount > 0 ? Math.round((successfulRetrievalCount / answerableCount) * 1000) / 10 : 0,
    correct_refusal_rate: unanswerableCount > 0 ? Math.round((correctRefusalCount / unanswerableCount) * 1000) / 10 : 0,
    citation_authenticity_rate: totalRetrievedCitations > 0 ? Math.round((totalAuthenticCitations / totalRetrievedCitations) * 1000) / 10 : 100,
    citation_relevance_rate: totalRetrievedCitations > 0 ? Math.round((totalRelevantCitations / totalRetrievedCitations) * 1000) / 10 : 0,
    retrieval_latency_p50_ms: p50,
    retrieval_latency_p95_ms: p95,
    latency_documentation_note: "Les latences retrieval_latency_p50_ms et retrieval_latency_p95_ms mesurent exclusivement le temps d'exécution de la recherche documentaire locale (in-memory / SQLite FTS5) et n'incluent pas les appels réseau LLM Gemini ni le rendu UI."
  };

  const byCategoryReport = {};
  for (const [c, stat] of Object.entries(categoryStats)) {
    const ans = stat.answerable;
    byCategoryReport[c] = {
      total: stat.total,
      answerable: stat.answerable,
      recall_at_5: ans > 0 ? Math.round((stat.recallAt5 / ans) * 1000) / 10 : 'N/A',
      recall_at_10: ans > 0 ? Math.round((stat.recallAt10 / ans) * 1000) / 10 : 'N/A',
      recall_at_20: ans > 0 ? Math.round((stat.recallAt20 / ans) * 1000) / 10 : 'N/A',
      source_coverage_at_5: ans > 0 ? Math.round((stat.sourceCoverageAt5 / ans) * 1000) / 10 : 'N/A',
      source_coverage_at_10: ans > 0 ? Math.round((stat.sourceCoverageAt10 / ans) * 1000) / 10 : 'N/A',
      source_coverage_at_20: ans > 0 ? Math.round((stat.sourceCoverageAt20 / ans) * 1000) / 10 : 'N/A',
      mrr: ans > 0 ? Math.round((stat.mrr / ans) * 1000) / 1000 : 'N/A',
      success_rate: ans > 0 ? Math.round((stat.success / ans) * 1000) / 10 : 'N/A',
      avg_retrieval_latency_ms: Math.round((stat.latencyTotal / stat.total) * 100) / 100
    };
  }

  const statisticalScope = {
    total_questions: questions.length,
    categories_count: Object.keys(byCategoryReport).length,
    questions_per_category: 8,
    is_preliminary_baseline: true,
    statistical_statement: "Cet ensemble de 88 questions (8 par catégorie) constitue la baseline initiale comparative du projet. Bien qu'il couvre rigoureusement 11 dimensions documentaires, un échantillon de 8 questions par catégorie ne constitue pas une validation statistique définitive à grande échelle mais une base de comparaison objective, déterministe et reproductible pour le futur moteur Hybrid RAG."
  };

  const benchmarkPayload = {
    timestamp: new Date().toISOString(),
    engine: "Legacy Auto-RAG",
    environment: "Node / Web In-Memory",
    statistical_scope: statisticalScope,
    metrics: finalMetrics,
    by_category: byCategoryReport,
    details: results
  };

  const outputDir = path.join(rootDir, 'eval', 'results');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const outputPath = path.join(outputDir, 'baseline_legacy.json');
  fs.writeFileSync(outputPath, JSON.stringify(benchmarkPayload, null, 2), 'utf8');

  console.log("\n==================================================================");
  console.log(" 📊 RÉSULTATS DE LA BASELINE LEGACY AUTO-RAG (MÉTHODOLOGIE CORRIGÉE)");
  console.log("==================================================================");
  console.log(` • Recall@5                     : ${finalMetrics.recall_at_5}%`);
  console.log(` • Recall@10                    : ${finalMetrics.recall_at_10}%`);
  console.log(` • Recall@20                    : ${finalMetrics.recall_at_20}%`);
  console.log(` • Source Coverage@5            : ${finalMetrics.source_coverage_at_5}% (dédoublonné)`);
  console.log(` • Source Coverage@10           : ${finalMetrics.source_coverage_at_10}% (dédoublonné)`);
  console.log(` • Source Coverage@20           : ${finalMetrics.source_coverage_at_20}% (dédoublonné)`);
  console.log(` • MRR (Mean Reciprocal Rank)   : ${finalMetrics.mrr}`);
  console.log(` • Taux de succès global        : ${finalMetrics.success_rate}%`);
  console.log(` • Taux de refus correct        : ${finalMetrics.correct_refusal_rate}% (questions hors corpus)`);
  console.log(` • Citation Authenticity        : ${finalMetrics.citation_authenticity_rate}% (citations réelles)`);
  console.log(` • Citation Relevance           : ${finalMetrics.citation_relevance_rate}% (citations pertinentes)`);
  console.log(` • Retrieval Latency p50        : ${finalMetrics.retrieval_latency_p50_ms} ms (recherche locale)`);
  console.log(` • Retrieval Latency p95        : ${finalMetrics.retrieval_latency_p95_ms} ms (recherche locale)`);
  console.log("==================================================================");
  console.log(` 💾 Rapport complet sauvegardé : eval/results/baseline_legacy.json\n`);

  return finalMetrics;
}

evaluateBenchmark().catch(err => {
  console.error("Erreur durant l'évaluation :", err);
  process.exit(1);
});
