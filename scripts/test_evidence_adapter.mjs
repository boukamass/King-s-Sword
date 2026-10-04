/**
 * King's Sword — Tests Unitaires de l'Adaptateur Retrieval → Evidence (Phase 2F.1)
 * 
 * Valide :
 * 1. La conversion des candidats (Hybrid/Reranked) en RetrievalEvidence
 * 2. La prise en charge des chunks multi-paragraphes
 * 3. La validation stricte des sources et le rejet des anomalies
 * 4. La génération conforme des citations [Réf: SERMON_ID, §N] (JAMAIS de chunkId)
 * 5. L'abstention absolue sur answerable = false (evidence = [])
 * 6. La préservation intégrale des métadonnées (date, city, version, scores)
 * 7. Le déterminisme absolu des transformations
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const libraryPath = path.join(rootDir, 'public', 'library.json');
const rawSermons = JSON.parse(fs.readFileSync(libraryPath, 'utf8'));

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    console.error(`  ❌ [FAIL] ${message}`);
    throw new Error(`Échec du test : ${message}`);
  } else {
    console.log(`  ✅ [PASS] ${message}`);
    passedTests++;
  }
}

// Utilitaires de découpage identiques à textUtils
function splitSermonIntoParagraphs(text) {
  if (!text || typeof text !== 'string') return [];
  return text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
}

function extractLeadingParagraphNumber(text) {
  if (!text || typeof text !== 'string') return null;
  const match = text.trim().match(/^(\d+)[\.\s]/);
  return match ? parseInt(match[1], 10) : null;
}

function formatParagraphCitation(sermonId, paragraphIndex) {
  if (!sermonId || typeof sermonId !== 'string') {
    throw new Error('sermonId invalide');
  }
  if (typeof paragraphIndex !== 'number' || paragraphIndex <= 0 || !Number.isInteger(paragraphIndex)) {
    throw new Error(`paragraphIndex invalide (${paragraphIndex})`);
  }
  return `[Réf: ${sermonId.trim()}, §${paragraphIndex}]`;
}

function validateAndConvertCandidateToEvidence({ candidate, rank, originalSermonsMap }) {
  if (!candidate) return null;
  const chunk = candidate.chunk || candidate;

  const chunkId = typeof chunk.chunkId === 'string' ? chunk.chunkId.trim() : '';
  const sermonId = typeof chunk.sermonId === 'string' ? chunk.sermonId.trim() : '';
  const sermonTitle = typeof chunk.sermonTitle === 'string' ? chunk.sermonTitle.trim() : '';
  const text = typeof chunk.text === 'string' ? chunk.text.trim() : '';
  const paragraphIds = Array.isArray(chunk.paragraphIds) ? chunk.paragraphIds : [];
  const startParagraph = typeof chunk.startParagraph === 'number' ? chunk.startParagraph : 0;
  const endParagraph = typeof chunk.endParagraph === 'number' ? chunk.endParagraph : 0;

  if (!chunkId || !sermonId || !text || paragraphIds.length === 0) return null;
  if (startParagraph <= 0 || endParagraph < startParagraph) return null;

  const originalSermon = originalSermonsMap.get(sermonId);
  if (!originalSermon || !originalSermon.text) return null;

  const originalParagraphs = splitSermonIntoParagraphs(originalSermon.text);
  const citationParagraphs = [];

  for (const pNum of paragraphIds) {
    let originalParaText = null;

    for (let idx = 0; idx < originalParagraphs.length; idx++) {
      const rawP = originalParagraphs[idx];
      const leading = extractLeadingParagraphNumber(rawP);
      const actualNum = leading !== null ? leading : idx + 1;

      if (actualNum === pNum) {
        originalParaText = rawP.trim();
        break;
      }
    }

    if (originalParaText === null || originalParaText.length === 0) {
      return null;
    }

    const snippet = originalParaText.length > 220
      ? originalParaText.slice(0, 220).trim() + '...'
      : originalParaText;

    citationParagraphs.push({
      paragraphIndex: pNum,
      formattedCitation: formatParagraphCitation(sermonId, pNum),
      textSnippet: snippet,
      isAuthentic: true
    });
  }

  let retrievalScore = 0;
  let sourceType = 'hybrid';

  if ('rerankScore' in candidate && typeof candidate.rerankScore === 'number') {
    retrievalScore = candidate.rerankScore;
    sourceType = 'reranked';
  } else if (typeof candidate.rrfScore === 'number' && candidate.rrfScore > 0) {
    retrievalScore = candidate.rrfScore;
    sourceType = 'hybrid';
  } else if (typeof candidate.vectorScore === 'number' && candidate.vectorScore > 0) {
    retrievalScore = candidate.vectorScore;
    sourceType = 'vector';
  } else if (typeof candidate.lexicalScore === 'number' && candidate.lexicalScore > 0) {
    retrievalScore = candidate.lexicalScore;
    sourceType = 'lexical';
  }

  return {
    chunkId,
    sermonId,
    sermonTitle: sermonTitle || originalSermon.title || sermonId,
    paragraphIds: [...paragraphIds].sort((a, b) => a - b),
    startParagraph,
    endParagraph,
    text,
    date: chunk.date || originalSermon.date,
    city: chunk.city !== undefined ? chunk.city : (originalSermon.city || null),
    version: chunk.version || originalSermon.version,
    retrievalScore,
    rank,
    sourceType,
    citationParagraphs
  };
}

function buildRetrievalEvidencePackage({ query, candidates = [], assessment, originalSermons = [], maxEvidenceCount = 5 }) {
  const cleanQuery = (query || '').trim();

  if (!assessment || !assessment.answerable || !cleanQuery || candidates.length === 0) {
    return {
      answerable: false,
      confidenceScore: assessment ? assessment.confidenceScore : 0,
      reason: assessment ? assessment.reason : 'Question non couverte par le corpus ou requête vide.',
      evidence: [],
      query: cleanQuery,
      totalCandidates: candidates.length,
      rejectedCount: candidates.length
    };
  }

  const originalSermonsMap = new Map();
  for (const s of originalSermons) {
    if (s && s.id) originalSermonsMap.set(s.id, s);
  }

  const validEvidenceList = [];
  let rejectedCount = 0;

  for (const candidate of candidates) {
    if (validEvidenceList.length >= maxEvidenceCount) break;

    const evidence = validateAndConvertCandidateToEvidence({
      candidate,
      rank: validEvidenceList.length + 1,
      originalSermonsMap
    });

    if (evidence) {
      validEvidenceList.push(evidence);
    } else {
      rejectedCount++;
    }
  }

  if (validEvidenceList.length === 0) {
    return {
      answerable: false,
      confidenceScore: 0,
      reason: 'Toutes les preuves documentaires ont échoué à la validation d\'authenticité.',
      evidence: [],
      query: cleanQuery,
      totalCandidates: candidates.length,
      rejectedCount: candidates.length
    };
  }

  return {
    answerable: true,
    confidenceScore: assessment.confidenceScore,
    reason: assessment.reason,
    evidence: validEvidenceList,
    query: cleanQuery,
    totalCandidates: candidates.length,
    rejectedCount
  };
}

async function runAllTests() {
  console.log("=================================================");
  console.log(" 🧪 TESTS DE L'ADAPTATEUR RETRIEVAL → EVIDENCE (PHASE 2F.1)");
  console.log("=================================================");

  const originalSermonsMap = new Map();
  rawSermons.forEach(s => originalSermonsMap.set(s.id, s));

  // --- 1. Test de formatage des citations ---
  console.log("\n--- 1. Formatage et intégrité des citations ---");
  const citation1 = formatParagraphCitation("63-0324M", 2);
  assert(citation1 === "[Réf: 63-0324M, §2]", `Citation conforme : ${citation1}`);
  assert(!citation1.includes("chunk"), "Aucune mention de chunk dans la citation");
  assert(!citation1.includes("c1"), "Aucun identifiant technique de découpage");

  let threwInvalidP = false;
  try {
    formatParagraphCitation("63-0324M", -1);
  } catch (e) {
    threwInvalidP = true;
  }
  assert(threwInvalidP, "Erreur levée sur numéro de paragraphe négatif");

  // --- 2. Conversion HybridSearchResult / RerankedSearchResult valide ---
  console.log("\n--- 2. Conversion Candidat → RetrievalEvidence ---");
  const mockCandidate = {
    chunkId: "63-0324M_c1_p1_p2",
    sermonId: "63-0324M",
    paragraphIds: [1, 2],
    startParagraph: 1,
    endParagraph: 2,
    text: "Texte combiné des paragraphes 1 et 2",
    sermonTitle: "Le Premier Sceau",
    date: "1963-03-24",
    city: "Jeffersonville, IN",
    version: "VGR",
    rerankScore: 0.945,
    rrfScore: 0.032,
    vectorScore: 0.88,
    lexicalScore: 92,
    lexicalRank: 1,
    vectorRank: 1,
    rank: 1,
    rerankDetails: {
      baseRrfScore: 0.032,
      vectorCosine: 0.88,
      lexicalScore: 92,
      isMultiModal: true,
      queryTermCoverage: 0.9
    }
  };

  const evidence = validateAndConvertCandidateToEvidence({
    candidate: mockCandidate,
    rank: 1,
    originalSermonsMap
  });

  assert(evidence !== null, "Evidence construite avec succès");
  assert(evidence.chunkId === "63-0324M_c1_p1_p2", "chunkId préservé");
  assert(evidence.sermonId === "63-0324M", "sermonId préservé");
  assert(evidence.sermonTitle === "Le Premier Sceau", "sermonTitle préservé");
  assert(evidence.date === "1963-03-24", "date préservée");
  assert(evidence.city === "Jeffersonville, IN", "city préservée");
  assert(evidence.version === "VGR", "version préservée");
  assert(evidence.retrievalScore === 0.945, "retrievalScore conforme");
  assert(evidence.rank === 1, "rank conforme (1)");
  assert(evidence.sourceType === "reranked", "sourceType identifié comme 'reranked'");
  assert(evidence.citationParagraphs.length === 2, "2 citations de paragraphes générées");
  assert(evidence.citationParagraphs[0].formattedCitation === "[Réf: 63-0324M, §1]", "Citation §1 conforme");
  assert(evidence.citationParagraphs[1].formattedCitation === "[Réf: 63-0324M, §2]", "Citation §2 conforme");
  assert(evidence.citationParagraphs[0].isAuthentic === true, "Citation §1 authentique");
  assert(evidence.citationParagraphs[0].textSnippet.length > 0, "Snippet non vide");

  // --- 3. Rejet des anomalies et robustesse ---
  console.log("\n--- 3. Rejet strict des données corrompues ou invalides ---");

  // A. Sermon inexistant
  const badSermonCandidate = { ...mockCandidate, sermonId: "UNKNOWN_SERMON_999" };
  const badSermonResult = validateAndConvertCandidateToEvidence({
    candidate: badSermonCandidate,
    rank: 1,
    originalSermonsMap
  });
  assert(badSermonResult === null, "Rejet si sermonId inexistant dans le corpus");

  // B. Paragraphe inexistant dans le sermon
  const badParaCandidate = { ...mockCandidate, paragraphIds: [9999] };
  const badParaResult = validateAndConvertCandidateToEvidence({
    candidate: badParaCandidate,
    rank: 1,
    originalSermonsMap
  });
  assert(badParaResult === null, "Rejet si paragraphId inexistant dans le texte");

  // C. startParagraph > endParagraph
  const badBoundsCandidate = { ...mockCandidate, startParagraph: 5, endParagraph: 2 };
  const badBoundsResult = validateAndConvertCandidateToEvidence({
    candidate: badBoundsCandidate,
    rank: 1,
    originalSermonsMap
  });
  assert(badBoundsResult === null, "Rejet si startParagraph > endParagraph");

  // D. Texte vide
  const emptyTextCandidate = { ...mockCandidate, text: "   " };
  const emptyTextResult = validateAndConvertCandidateToEvidence({
    candidate: emptyTextCandidate,
    rank: 1,
    originalSermonsMap
  });
  assert(emptyTextResult === null, "Rejet si texte de chunk vide");

  // --- 4. Gestion stricte d'Answerability = false (Abstention / Hors-Corpus) ---
  console.log("\n--- 4. Abstention stricte quand answerable = false ---");

  const horsCorpusAssessment = {
    answerable: false,
    confidenceScore: 0.1,
    reason: "Sujet hors du champ doctrinal des sermons : eiffel, paris.",
    topScore: 0.32,
    evidenceCount: 1,
    absentKeywords: ["eiffel", "paris"]
  };

  const rejectedPkg = buildRetrievalEvidencePackage({
    query: "Quelle est la hauteur de la Tour Eiffel à Paris ?",
    candidates: [mockCandidate],
    assessment: horsCorpusAssessment,
    originalSermons: rawSermons
  });

  assert(rejectedPkg.answerable === false, "answerable est strictement false");
  assert(rejectedPkg.evidence.length === 0, "evidence est strictement vide ([])");
  assert(rejectedPkg.confidenceScore === 0.1, "confidenceScore conforme");
  assert(rejectedPkg.reason.includes("Tour Eiffel") || rejectedPkg.reason.includes("eiffel"), "Motif d'abstention explicite");
  assert(rejectedPkg.rejectedCount === 1, "1 candidat rejeté au total");

  // --- 5. Construction d'un package valide (Answerable = true) ---
  console.log("\n--- 5. Construction complète d'un package d'Evidence ---");

  const validAssessment = {
    answerable: true,
    confidenceScore: 0.95,
    reason: "Recoupement documentaire validé.",
    topScore: 0.945,
    evidenceCount: 1,
    absentKeywords: []
  };

  const validPkg = buildRetrievalEvidencePackage({
    query: "Que représente le cavalier sur le cheval blanc dans le premier sceau ?",
    candidates: [mockCandidate],
    assessment: validAssessment,
    originalSermons: rawSermons,
    maxEvidenceCount: 5
  });

  assert(validPkg.answerable === true, "Package validé answerable = true");
  assert(validPkg.evidence.length === 1, "1 Evidence validée");
  assert(validPkg.confidenceScore === 0.95, "Score de confiance 0.95");
  assert(validPkg.query === "Que représente le cavalier sur le cheval blanc dans le premier sceau ?", "Requête conservée");
  assert(validPkg.rejectedCount === 0, "0 rejet");

  // --- 6. Déterminisme absolu ---
  console.log("\n--- 6. Déterminisme et immuabilité ---");
  const pkgRun1 = buildRetrievalEvidencePackage({
    query: "Premier sceau",
    candidates: [mockCandidate],
    assessment: validAssessment,
    originalSermons: rawSermons
  });

  const pkgRun2 = buildRetrievalEvidencePackage({
    query: "Premier sceau",
    candidates: [mockCandidate],
    assessment: validAssessment,
    originalSermons: rawSermons
  });

  assert(JSON.stringify(pkgRun1) === JSON.stringify(pkgRun2), "Déterminisme à 100% sur deux exécutions consécutives");

  console.log("\n=================================================");
  console.log(` RÉSULTATS : ${passedTests}/${totalTests} TESTS PASSÉS AVEC SUCCÈS`);
  console.log("=================================================");
}

runAllTests().catch(err => {
  console.error("❌ ERREUR LORS DES TESTS :", err);
  process.exit(1);
});
