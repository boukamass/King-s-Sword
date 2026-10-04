/**
 * Suite de validation automatisée du benchmark et de la baseline RAG (Phase 1)
 * Vérifie l'intégrité du dataset, la rigueur méthodologique des métriques (Recall@5/10/20, Coverage, Citations)
 * et la non-régression stricte.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log("=================================================");
console.log(" 🧪 TESTS DE VALIDATION DU BENCHMARK RAG (PHASE 1)");
console.log("=================================================\n");

let passed = 0;
let total = 0;

function assert(condition, message) {
  total++;
  if (condition) {
    console.log(`  ✅ [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${message}`);
  }
}

// =========================================================================
// 1. Vérification mathématique du calcul différencié de Recall@5, 10 et 20
// =========================================================================
function computeRecallAtK(retrievedList, expectedList, k) {
  const sliced = retrievedList.slice(0, k);
  const matched = new Set();
  sliced.forEach(item => {
    expectedList.forEach(exp => {
      if (exp.sermonId === item.sermonId && exp.paragraphIndex === item.paragraphIndex) {
        matched.add(`${exp.sermonId}-${exp.paragraphIndex}`);
      }
    });
  });
  return matched.size / (expectedList.length || 1);
}

// Test A : Résultat pertinent positionné au rang 6
const mockExpected = [{ sermonId: "S1", paragraphIndex: 1 }];
const mockRetrievedRank6 = Array.from({ length: 20 }, (_, i) => ({
  sermonId: i === 5 ? "S1" : `Distractor_${i}`,
  paragraphIndex: i === 5 ? 1 : 99
}));

const recall5_rank6 = computeRecallAtK(mockRetrievedRank6, mockExpected, 5);
const recall10_rank6 = computeRecallAtK(mockRetrievedRank6, mockExpected, 10);
const recall20_rank6 = computeRecallAtK(mockRetrievedRank6, mockExpected, 20);

assert(recall5_rank6 === 0, "Test Recall différencié : Rang 6 donne Recall@5 = 0%");
assert(recall10_rank6 === 1, "Test Recall différencié : Rang 6 donne Recall@10 = 100%");
assert(recall20_rank6 === 1, "Test Recall différencié : Rang 6 donne Recall@20 = 100%");

// Test B : Résultat pertinent positionné au rang 11
const mockRetrievedRank11 = Array.from({ length: 20 }, (_, i) => ({
  sermonId: i === 10 ? "S1" : `Distractor_${i}`,
  paragraphIndex: i === 10 ? 1 : 99
}));

const recall5_rank11 = computeRecallAtK(mockRetrievedRank11, mockExpected, 5);
const recall10_rank11 = computeRecallAtK(mockRetrievedRank11, mockExpected, 10);
const recall20_rank11 = computeRecallAtK(mockRetrievedRank11, mockExpected, 20);

assert(recall5_rank11 === 0, "Test Recall différencié : Rang 11 donne Recall@5 = 0%");
assert(recall10_rank11 === 0, "Test Recall différencié : Rang 11 donne Recall@10 = 0%");
assert(recall20_rank11 === 1, "Test Recall différencié : Rang 11 donne Recall@20 = 100%");

// =========================================================================
// 2. Vérification du corpus documentaire
// =========================================================================
const libraryPath = path.join(rootDir, 'public', 'library.json');
assert(fs.existsSync(libraryPath), "Le fichier public/library.json existe");
const library = JSON.parse(fs.readFileSync(libraryPath, 'utf8'));
assert(Array.isArray(library) && library.length === 4, `Le corpus contient exactement 4 sermons (${library.length} trouvés)`);

const sermonIds = new Set(library.map(s => s.id));
const sermonsMap = new Map();
library.forEach(s => {
  const paragraphs = s.text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  sermonsMap.set(s.id, {
    ...s,
    paragraphs: paragraphs.map((p, idx) => {
      const match = p.trim().match(/^(\d+)[\.\s]/);
      const num = match ? parseInt(match[1], 10) : idx + 1;
      return { num, text: p.trim() };
    })
  });
});

// =========================================================================
// 3. Vérification du dataset d'évaluation
// =========================================================================
const questionsPath = path.join(rootDir, 'eval', 'questions.json');
assert(fs.existsSync(questionsPath), "Le fichier eval/questions.json existe");
const questions = JSON.parse(fs.readFileSync(questionsPath, 'utf8'));
assert(Array.isArray(questions) && questions.length === 88, `Le dataset contient exactement 88 questions (${questions.length} trouvées)`);

const REQUIRED_CATEGORIES = [
  'enseignement_precis',
  'theme_biblique',
  'phrase_expression',
  'doctrine',
  'personne_biblique',
  'evenement_biblique',
  'relations_passages',
  'multi_sermons',
  'ambigue',
  'hors_corpus',
  'citation_precise'
];

const foundCategories = new Set(questions.map(q => q.category));
const allCategoriesPresent = REQUIRED_CATEGORIES.every(c => foundCategories.has(c));
assert(allCategoriesPresent, `Toutes les 11 catégories obligatoires sont présentes (${[...foundCategories].join(', ')})`);

let validSnippetsCount = 0;
let answerableCount = 0;
let unanswerableCount = 0;
let questionsWithoutRequiredFields = 0;

questions.forEach(q => {
  const hasFields = q.id && q.question && q.category && q.difficulty && 
    (typeof q.answerable === 'boolean') && q.expected_sermons && q.expected_paragraphs &&
    q.expected_sources && (q.relevant_snippet !== undefined) && q.expected_answer;
  if (!hasFields) questionsWithoutRequiredFields++;

  if (q.answerable) {
    answerableCount++;
    let snippetOk = false;
    for (const src of q.expected_sources) {
      assert(sermonIds.has(src.sermonId), `Question ${q.id}: sermonId valide (${src.sermonId})`);
      const s = sermonsMap.get(src.sermonId);
      const p = s.paragraphs.find(para => para.num === src.paragraphIndex);
      assert(p !== undefined, `Question ${q.id}: paragraphe valide (${src.sermonId} §${src.paragraphIndex})`);
      if (p && p.text.includes(q.relevant_snippet)) {
        snippetOk = true;
      }
    }
    if (snippetOk) validSnippetsCount++;
  } else {
    unanswerableCount++;
    assert(q.expected_sources.length === 0, `Question hors corpus ${q.id}: aucune source attendue`);
  }
});

assert(questionsWithoutRequiredFields === 0, "Chaque question possède la totalité des champs requis");
assert(validSnippetsCount === answerableCount, `100% des extraits textuels sont fidèles au corpus (${validSnippetsCount}/${answerableCount})`);
assert(unanswerableCount === 8, `Présence d'un jeu de 8 questions négatives / hors corpus (${unanswerableCount} questions)`);

// =========================================================================
// 4. Vérification des résultats du Baseline Legacy et des métriques enrichies
// =========================================================================
const baselinePath = path.join(rootDir, 'eval', 'results', 'baseline_legacy.json');
assert(fs.existsSync(baselinePath), "Le fichier eval/results/baseline_legacy.json existe");
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));

assert(baseline.engine === "Legacy Auto-RAG", `Moteur documenté : ${baseline.engine}`);
assert(typeof baseline.metrics.recall_at_5 === 'number', `Recall@5 calculé : ${baseline.metrics.recall_at_5}%`);
assert(typeof baseline.metrics.recall_at_10 === 'number', `Recall@10 calculé : ${baseline.metrics.recall_at_10}%`);
assert(typeof baseline.metrics.recall_at_20 === 'number', `Recall@20 calculé : ${baseline.metrics.recall_at_20}%`);

assert(typeof baseline.metrics.source_coverage_at_5 === 'number', `Source Coverage@5 calculé : ${baseline.metrics.source_coverage_at_5}%`);
assert(typeof baseline.metrics.source_coverage_at_10 === 'number', `Source Coverage@10 calculé : ${baseline.metrics.source_coverage_at_10}%`);
assert(typeof baseline.metrics.source_coverage_at_20 === 'number', `Source Coverage@20 calculé : ${baseline.metrics.source_coverage_at_20}%`);

assert(typeof baseline.metrics.mrr === 'number', `MRR calculé : ${baseline.metrics.mrr}`);
assert(typeof baseline.metrics.success_rate === 'number', `Taux de succès calculé : ${baseline.metrics.success_rate}%`);
assert(typeof baseline.metrics.correct_refusal_rate === 'number', `Taux de refus calculé : ${baseline.metrics.correct_refusal_rate}%`);

assert(typeof baseline.metrics.citation_authenticity_rate === 'number', `Citation Authenticity Rate : ${baseline.metrics.citation_authenticity_rate}%`);
assert(typeof baseline.metrics.citation_relevance_rate === 'number', `Citation Relevance Rate : ${baseline.metrics.citation_relevance_rate}%`);

assert(typeof baseline.metrics.retrieval_latency_p50_ms === 'number', `Retrieval Latency p50 calculée : ${baseline.metrics.retrieval_latency_p50_ms} ms`);
assert(typeof baseline.metrics.retrieval_latency_p95_ms === 'number', `Retrieval Latency p95 calculée : ${baseline.metrics.retrieval_latency_p95_ms} ms`);
assert(baseline.metrics.latency_documentation_note.includes("exclusivement"), "Documentation explicite de la portée des latences locales");

// Portée statistique
assert(baseline.statistical_scope && baseline.statistical_scope.total_questions === 88, "Portée statistique documentée dans la baseline");

// =========================================================================
// 5. Structure de comparaison future (HYBRID RAG vs BASELINE LEGACY)
// =========================================================================
assert(Array.isArray(baseline.details) && baseline.details.length === questions.length, `Le tableau détaillé contient toutes les évaluations (${baseline.details.length})`);
const firstDetail = baseline.details[0];
const expectedComparisonKeys = [
  'id', 'question', 'category', 'difficulty', 'expected_sources', 'expected_source_count',
  'retrieved_sources', 'retrieved_source_count_at_5', 'source_coverage_at_5',
  'rank', 'citation_authenticity', 'citation_relevance_count', 'answerable', 'retrieval_latency_ms'
];
const hasAllComparisonKeys = expectedComparisonKeys.every(k => k in firstDetail);
assert(hasAllComparisonKeys, `Format de comparaison future conforme : ${expectedComparisonKeys.join(' | ')}`);

// =========================================================================
// 6. Non-régression : aucun composant Phase 2 n'est activé en production
// =========================================================================
const storeContent = fs.readFileSync(path.join(rootDir, 'store.ts'), 'utf8');
assert(!storeContent.includes('useHybridRag') && !storeContent.includes('rrfScore'), "Store non pollué par du code Phase 2");

console.log("\n=================================================");
console.log(` RÉSULTATS : ${passed}/${total} TESTS PASSÉS AVEC SUCCÈS`);
console.log("=================================================");

if (passed !== total) {
  process.exit(1);
}
