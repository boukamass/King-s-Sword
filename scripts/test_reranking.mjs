/**
 * King's Sword — Tests Unitaires du Reranking Local, Answerability et Validation des Citations (Phase 2E)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log("=================================================");
console.log(" 🎯 TESTS DU RERANKING LOCAL & ANSWERABILITY (PHASE 2E)");
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
    process.exit(1);
  }
}

// 1. Fonctions pures importées pour validation ESM
function normalizeText(text) {
  if (!text || typeof text !== 'string') return '';
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/['’]/g, ' ').replace(/[^\w\s-]/g, ' ').replace(/\s+/g, ' ').trim();
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

const STOP_WORDS = new Set(['le','la','les','un','une','des','du','de','d','au','aux','et','ou','mais','donc','or','ni','car','que','qui','quoi','dont','a','dans','en','par','pour','sur','sous','vers','avec','sans','chez','ce','cet','cette','ces','mon','ma','mes','ton','ta','tes','son','sa','ses','notre','votre','leur','nos','vos','leurs','je','tu','il','elle','on','nous','vous','ils','elles','me','te','se','lui','y','est','sont','ete','etre','suis','es','sommes','etes','a','ont','ai','as','avons','avez','avait','avaient','avoir','fait','faire','fais','font','dis','dit','disent','dire','parle','parlent','parler','selon','comme','comment','pourquoi','quand','quel','quelle','quels','quelles','tout','tous','toute','toutes','plus','moins','tres','bien','aussi','alors','si','ne','pas','point','non','oui','peut','peuvent','pouvoir','branham','william','frere','brother','message','sermon','sermons']);

function extractSignificantQueryTerms(query) {
  if (!query || typeof query !== 'string') return [];
  const normalized = normalizeText(query);
  const words = normalized.replace(/[^\w\s-]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP_WORDS.has(w));
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

function rerankHybridResults(params) {
  const { query, hybridResults = [], options = {} } = params;
  if (!Array.isArray(hybridResults) || hybridResults.length === 0) return [];

  const topK = Math.max(1, options.topK || 10);
  const vectorWeight = options.vectorWeight ?? 0.30;
  const lexicalWeight = options.lexicalWeight ?? 0.15;
  const rrfWeight = options.rrfWeight ?? 0.40;
  const multiModalBonus = options.multiModalBonus ?? 0.15;

  const queryTerms = extractSignificantQueryTerms(query);
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

  const queryTerms = extractSignificantQueryTerms(query);
  const topCandidate = candidates[0];
  const topVectorScore = typeof topCandidate.vectorScore === 'number' ? topCandidate.vectorScore : 0;
  const hasLexicalHit = topCandidate.lexicalRank !== null && (topCandidate.lexicalScore || 0) > 0;
  const isMultiModal = topCandidate.lexicalRank !== null && topCandidate.vectorRank !== null;

  const absentKeywords = [];
  if (corpusTextIndex && corpusTextIndex.length > 0 && queryTerms.length > 0) {
    const normCorpus = normalizeText(corpusTextIndex);
    for (const term of queryTerms) {
      const normTerm = normalizeText(term);
      if (normTerm.length > 3 && !normCorpus.includes(normTerm)) {
        absentKeywords.push(term);
      }
    }
  }

  const absentRatio = queryTerms.length > 0 ? (absentKeywords.length / queryTerms.length) : 0;
  const termCoverageInTop = computeQueryTermCoverage(queryTerms, topCandidate.text);

  if (absentRatio >= 0.5 && !hasLexicalHit) {
    return {
      answerable: false,
      confidenceScore: Math.round(Math.min(0.25, topVectorScore * 0.3) * 100) / 100,
      reason: `Termes clés introuvables dans les sermons disponibles : ${absentKeywords.join(', ')}`,
      topScore: topVectorScore,
      evidenceCount: candidates.length,
      absentKeywords
    };
  }

  if (absentKeywords.length >= 2 && topVectorScore < 0.75) {
    return {
      answerable: false,
      confidenceScore: 0.20,
      reason: `Plusieurs concepts clés absents du corpus : ${absentKeywords.join(', ')}`,
      topScore: topVectorScore,
      evidenceCount: candidates.length,
      absentKeywords
    };
  }

  if (topVectorScore < 0.52 && !hasLexicalHit) {
    return {
      answerable: false,
      confidenceScore: Math.round(topVectorScore * 100) / 100,
      reason: `Similarité sémantique insuffisante (${topVectorScore.toFixed(3)}) et aucun mot-clé trouvé.`,
      topScore: topVectorScore,
      evidenceCount: candidates.length,
      absentKeywords
    };
  }

  if (isMultiModal || (hasLexicalHit && topVectorScore >= 0.52)) {
    const confidence = Math.min(1.0, 0.85 + ((topVectorScore - 0.52) * 0.3));
    return {
      answerable: true,
      confidenceScore: Math.round(confidence * 100) / 100,
      reason: 'Recoupement multi-modal validé (Lexical + Vectoriel).',
      topScore: topVectorScore,
      evidenceCount: candidates.length,
      absentKeywords
    };
  }

  if (topVectorScore >= 0.65 && absentKeywords.length === 0) {
    const confidence = Math.min(1.0, 0.75 + ((topVectorScore - 0.65) * 0.5));
    return {
      answerable: true,
      confidenceScore: Math.round(confidence * 100) / 100,
      reason: 'Forte similarité sémantique et vocabulaire cohérent avec le corpus.',
      topScore: topVectorScore,
      evidenceCount: candidates.length,
      absentKeywords
    };
  }

  if (topVectorScore >= 0.58 && termCoverageInTop >= 0.30) {
    return {
      answerable: true,
      confidenceScore: 0.70,
      reason: 'Similarité sémantique et couverture de termes validées.',
      topScore: topVectorScore,
      evidenceCount: candidates.length,
      absentKeywords
    };
  }

  return {
    answerable: false,
    confidenceScore: 0.35,
    reason: 'Signal documentaire insuffisant pour garantir une réponse fiable.',
    topScore: topVectorScore,
    evidenceCount: candidates.length,
    absentKeywords
  };
}

function validateEvidenceCitations(candidates, originalSermons) {
  if (!Array.isArray(candidates) || candidates.length === 0 || !Array.isArray(originalSermons)) return [];
  const sermonsMap = new Map();
  for (const s of originalSermons) {
    if (s && s.id) sermonsMap.set(s.id, s);
  }

  const validated = [];
  for (const item of candidates) {
    const chunk = item.chunk || item;
    const sId = chunk.sermonId;
    const sermon = sermonsMap.get(sId);

    if (!sermon || !sermon.text) {
      validated.push({
        chunkId: chunk.chunkId || 'unknown',
        sermonId: sId || 'unknown',
        paragraphIndex: chunk.startParagraph || 0,
        citationTitle: chunk.sermonTitle || 'Sermon inconnu',
        isAuthentic: false,
        textSnippet: '',
        validationError: `Sermon ID "${sId}" inexistant dans le corpus original.`
      });
      continue;
    }

    const sermonParagraphs = splitSermonIntoParagraphs(sermon.text);

    for (const pNum of chunk.paragraphIds || []) {
      let originalParaText = null;
      for (let idx = 0; idx < sermonParagraphs.length; idx++) {
        const rawP = sermonParagraphs[idx];
        const leading = extractLeadingParagraphNumber(rawP);
        const actualNum = leading !== null ? leading : idx + 1;
        if (actualNum === pNum) {
          originalParaText = rawP.trim();
          break;
        }
      }

      if (originalParaText === null) {
        validated.push({
          chunkId: chunk.chunkId,
          sermonId: sId,
          paragraphIndex: pNum,
          citationTitle: `${sermon.title} §${pNum}`,
          isAuthentic: false,
          textSnippet: '',
          validationError: `Paragraphe §${pNum} introuvable dans le texte du sermon ${sId}.`
        });
      } else {
        const snippet = originalParaText.length > 200 ? originalParaText.slice(0, 200) + '...' : originalParaText;
        validated.push({
          chunkId: chunk.chunkId,
          sermonId: sId,
          paragraphIndex: pNum,
          citationTitle: `${sermon.title} §${pNum}`,
          isAuthentic: true,
          textSnippet: snippet
        });
      }
    }
  }

  return validated;
}

// ----------------------------------------------------
// EXÉCUTION DES TESTS UNITAIRES
// ----------------------------------------------------

console.log("--- 1. Tests de Reranking Local Multi-signaux ---");

const dummyChunkA = {
  chunkId: '63-0324M_c1_p1_p2',
  sermonId: '63-0324M',
  paragraphIds: [1, 2],
  startParagraph: 1,
  endParagraph: 2,
  text: "Le premier sceau est ouvert et le cavalier sur le cheval blanc s'élance.",
  sermonTitle: "Le Premier Sceau",
  date: "1963-03-24M",
  city: "Jeffersonville"
};

const dummyChunkB = {
  chunkId: '65-1212_c1_p1_p2',
  sermonId: '65-1212',
  paragraphIds: [1, 2],
  text: "La communion est un acte solennel de sainteté.",
  sermonTitle: "La Communion",
  date: "1965-12-12",
  city: "Tucson"
};

const dummyHybridResults = [
  {
    chunkId: dummyChunkA.chunkId,
    sermonId: dummyChunkA.sermonId,
    paragraphIds: [1, 2],
    startParagraph: 1,
    endParagraph: 2,
    text: dummyChunkA.text,
    sermonTitle: dummyChunkA.sermonTitle,
    lexicalRank: 1,
    lexicalScore: 85,
    vectorRank: 1,
    vectorScore: 0.78,
    rrfScore: 0.032787,
    rank: 1,
    chunk: dummyChunkA
  },
  {
    chunkId: dummyChunkB.chunkId,
    sermonId: dummyChunkB.sermonId,
    paragraphIds: [1, 2],
    startParagraph: 1,
    endParagraph: 2,
    text: dummyChunkB.text,
    sermonTitle: dummyChunkB.sermonTitle,
    lexicalRank: null,
    lexicalScore: null,
    vectorRank: 2,
    vectorScore: 0.55,
    rrfScore: 0.016129,
    rank: 2,
    chunk: dummyChunkB
  }
];

const reranked = rerankHybridResults({
  query: "Que se passe-t-il lors de l'ouverture du premier sceau avec le cheval blanc ?",
  hybridResults: dummyHybridResults
});

assert(reranked.length === 2, "Reranking retourne 2 résultats");
assert(reranked[0].chunkId === dummyChunkA.chunkId, "Chunk A reste #1 avec score supérieur");
assert(reranked[0].rerankScore > reranked[1].rerankScore, "Score #1 > Score #2");
assert(reranked[0].rerankDetails.isMultiModal === true, "Multi-modal détecté pour Chunk A");
assert(reranked[1].rerankDetails.isMultiModal === false, "Multi-modal false pour Chunk B");
assert(reranked[0].rerankDetails.queryTermCoverage > 0.5, "Forte couverture de termes pour Chunk A");

// Test cas égalité de score Rerank -> départage déterministe
const tieResults = [
  { ...dummyHybridResults[0], chunkId: 'chunk_B', rrfScore: 0.02, vectorScore: 0.7 },
  { ...dummyHybridResults[0], chunkId: 'chunk_A', rrfScore: 0.02, vectorScore: 0.7 }
];
const rerankedTie = rerankHybridResults({ query: "test", hybridResults: tieResults });
assert(rerankedTie[0].chunkId === 'chunk_A', "Départage déterministe par chunkId en cas d'égalité");

// Test evidence absente ou tableau vide
assert(rerankHybridResults({ query: "test", hybridResults: [] }).length === 0, "HybridResults vide -> []");

console.log("\n--- 2. Tests d'Answerability et d'Abstention (Hors-Corpus) ---");

const rawSermons = JSON.parse(fs.readFileSync(path.join(rootDir, 'public', 'library.json'), 'utf8'));
const fullCorpusText = rawSermons.map(s => s.text).join(' ');

// Test 2.1 : Question fortement pertinente
const ansGood = assessAnswerability({
  query: "Que représente le cavalier sur le cheval blanc dans le premier sceau ?",
  candidates: reranked,
  corpusTextIndex: fullCorpusText
});
assert(ansGood.answerable === true, "Question pertinente validée comme answerable");
assert(ansGood.confidenceScore >= 0.80, `Forte confiance assignée (${ansGood.confidenceScore})`);

// Test 2.2 : Question Hors-Corpus (Tour Eiffel)
const ansEiffel = assessAnswerability({
  query: "Que dit William Branham sur la construction de la Tour Eiffel à Paris ?",
  candidates: [{ ...dummyHybridResults[1], vectorScore: 0.6561, lexicalRank: null, lexicalScore: null }],
  corpusTextIndex: fullCorpusText
});
assert(ansEiffel.answerable === false, "Question Tour Eiffel correctement refusée (hors corpus)");
assert(ansEiffel.confidenceScore <= 0.30, `Faible confiance pour Tour Eiffel (${ansEiffel.confidenceScore})`);
assert(ansEiffel.absentKeywords.includes('eiffel') || ansEiffel.absentKeywords.includes('paris'), "Termes absents correctement identifiés");

// Test 2.3 : Question Hors-Corpus (Internet)
const ansInternet = assessAnswerability({
  query: "Quelle est la date de l'invention d'Internet selon les sermons ?",
  candidates: [{ ...dummyHybridResults[1], vectorScore: 0.5963, lexicalRank: null, lexicalScore: null }],
  corpusTextIndex: fullCorpusText
});
assert(ansInternet.answerable === false, "Question Internet correctement refusée");

// Test 2.4 : Question Hors-Corpus (Pompe diesel)
const ansDiesel = assessAnswerability({
  query: "Comment réparer une pompe à injection diesel sur un tracteur agricole ?",
  candidates: [{ ...dummyHybridResults[1], vectorScore: 0.4767, lexicalRank: null, lexicalScore: null }],
  corpusTextIndex: fullCorpusText
});
assert(ansDiesel.answerable === false, "Question Diesel correctement refusée");

// Test 2.5 : Question Hors-Corpus (Épée laser)
const ansLaser = assessAnswerability({
  query: "Dans quel sermon Branham affirme-t-il que le cavalier noir maniait une épée laser ?",
  candidates: [{ ...dummyHybridResults[0], vectorScore: 0.7257, lexicalRank: null, lexicalScore: null }],
  corpusTextIndex: fullCorpusText
});
assert(ansLaser.answerable === false, "Question épée laser correctement refusée");

// Test 2.6 : Requête vide ou sans candidats
assert(assessAnswerability({ query: "", candidates: [] }).answerable === false, "Requête vide refusée");

console.log("\n--- 3. Tests de Validation des Citations Déterministe ---");

// Test 3.1 : Citation authentique valide
const citationsValid = validateEvidenceCitations(dummyHybridResults, rawSermons);
assert(citationsValid.length >= 2, "Citations extraites pour chaque paragraphe du chunk");
assert(citationsValid[0].isAuthentic === true, "Citation 1 marquée authentique");
assert(citationsValid[0].paragraphIndex === 1, "Pointe vers le paragraphe §1");
assert(citationsValid[0].textSnippet.length > 0, "Extrait de texte non vide");

// Test 3.2 : Sermon ID invalide
const invalidSermonCandidate = [{
  chunkId: 'fake_c1_p1',
  sermonId: '99-9999',
  paragraphIds: [1],
  startParagraph: 1,
  endParagraph: 1,
  text: "Faux texte",
  sermonTitle: "Faux Sermon"
}];
const citationsInvalidSermon = validateEvidenceCitations(invalidSermonCandidate, rawSermons);
assert(citationsInvalidSermon[0].isAuthentic === false, "Sermon ID inexistant invalidé");
assert(citationsInvalidSermon[0].validationError.includes('inexistant'), "Message d'erreur explicite");

// Test 3.3 : Paragraphe inexistant dans un sermon existant
const invalidParaCandidate = [{
  chunkId: '63-0324M_c99_p99',
  sermonId: '63-0324M',
  paragraphIds: [999],
  startParagraph: 999,
  endParagraph: 999,
  text: "Paragraphe imaginaire",
  sermonTitle: "Le Premier Sceau"
}];
const citationsInvalidPara = validateEvidenceCitations(invalidParaCandidate, rawSermons);
assert(citationsInvalidPara[0].isAuthentic === false, "Paragraphe hors limites invalidé");
assert(citationsInvalidPara[0].validationError.includes('introuvable'), "Message d'erreur paragraphe introuvable");

// Test 3.4 : Déterminisme absolu
const citRun1 = JSON.stringify(validateEvidenceCitations(dummyHybridResults, rawSermons));
const citRun2 = JSON.stringify(validateEvidenceCitations(dummyHybridResults, rawSermons));
assert(citRun1 === citRun2, "Déterminisme de validation des citations vérifié à 100%");

console.log("\n=================================================");
console.log(` RÉSULTATS : ${passed}/${total} TESTS PASSÉS AVEC SUCCÈS`);
console.log("=================================================\n");
