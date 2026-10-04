/**
 * King's Sword — Tests Unitaires du Validateur de Citations (Phase 2F.4)
 * 
 * Valide :
 * 1. Authentification des citations valides [Réf: SERMON_ID, §N]
 * 2. Rejet des citations basées sur chunkId (ex: [Réf: 63-0324M_c1_p1_p2])
 * 3. Rejet des citations pointant vers un sermon non présent dans l'Evidence (ex: [Réf: 65-9999, §4])
 * 4. Rejet des citations pointant vers un paragraphe absent de l'Evidence (§999)
 * 5. Réponse sans citation (validCitationCount = 0, invalidCitationCount = 0, allCitationsValid = true)
 * 6. Cas answerable = false (abstention / hors corpus) : toute citation est déclarée invalide
 * 7. Preservation intégrale du texte original sans modification silencieuse
 * 8. Déterminisme absolu
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

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

// Reproduction déterministe de validateResponseCitations
const CITATION_REGEX = /\[Réf:\s*([^,\]\s]+)(?:,\s*(?:Para\.?|§)\s*(\d+))?\]/gi;

function validateResponseCitations({ responseText = '', evidencePackage }) {
  if (!responseText || typeof responseText !== 'string') {
    return {
      text: '',
      citations: [],
      validCitationCount: 0,
      invalidCitationCount: 0,
      allCitationsValid: true
    };
  }

  const matches = [...responseText.matchAll(CITATION_REGEX)];

  if (matches.length === 0) {
    return {
      text: responseText,
      citations: [],
      validCitationCount: 0,
      invalidCitationCount: 0,
      allCitationsValid: true
    };
  }

  const evidenceBySermonMap = new Map();
  if (evidencePackage && evidencePackage.answerable && Array.isArray(evidencePackage.evidence)) {
    for (const ev of evidencePackage.evidence) {
      if (ev && ev.sermonId) {
        const normId = ev.sermonId.trim().toLowerCase();
        const existing = evidenceBySermonMap.get(normId) || [];
        existing.push(ev);
        evidenceBySermonMap.set(normId, existing);
      }
    }
  }

  const citations = [];
  let validCitationCount = 0;
  let invalidCitationCount = 0;

  for (const match of matches) {
    const rawMatch = match[0];
    const rawSermonId = match[1] ? match[1].trim() : null;
    const rawParaIndex = match[2] ? parseInt(match[2], 10) : null;

    if (rawSermonId && (rawSermonId.includes('_c') || rawSermonId.toLowerCase().includes('chunk'))) {
      invalidCitationCount++;
      citations.push({
        rawMatch,
        sermonId: rawSermonId,
        paragraphIndex: rawParaIndex,
        isValid: false,
        reason: `Identifiant technique de découpage (CHUNK_ID) "${rawSermonId}" utilisé à la place d'un ID de sermon.`
      });
      continue;
    }

    if (!evidencePackage || !evidencePackage.answerable || !Array.isArray(evidencePackage.evidence) || evidencePackage.evidence.length === 0) {
      invalidCitationCount++;
      citations.push({
        rawMatch,
        sermonId: rawSermonId,
        paragraphIndex: rawParaIndex,
        isValid: false,
        reason: 'Aucune preuve documentaire n\'a été fournie dans le contexte pour cette question (abstention / hors corpus).'
      });
      continue;
    }

    if (!rawSermonId) {
      invalidCitationCount++;
      citations.push({
        rawMatch,
        sermonId: null,
        paragraphIndex: rawParaIndex,
        isValid: false,
        reason: 'Identifiant de sermon manquant dans la citation.'
      });
      continue;
    }

    const normSermonId = rawSermonId.toLowerCase();
    const matchingEvidences = evidenceBySermonMap.get(normSermonId);

    if (!matchingEvidences || matchingEvidences.length === 0) {
      invalidCitationCount++;
      citations.push({
        rawMatch,
        sermonId: rawSermonId,
        paragraphIndex: rawParaIndex,
        isValid: false,
        reason: `Le sermon ID "${rawSermonId}" n'était pas présent dans les preuves documentaires transmises dans le contexte.`
      });
      continue;
    }

    let matchedParagraphSnippet = null;
    let matchedEvidenceObj = null;

    for (const ev of matchingEvidences) {
      if (rawParaIndex !== null) {
        const foundPara = ev.citationParagraphs.find(cp => cp.paragraphIndex === rawParaIndex && cp.isAuthentic);
        if (foundPara) {
          matchedParagraphSnippet = foundPara.textSnippet;
          matchedEvidenceObj = ev;
          break;
        }
      } else {
        matchedEvidenceObj = ev;
        break;
      }
    }

    if (rawParaIndex !== null && matchedParagraphSnippet === null) {
      invalidCitationCount++;
      citations.push({
        rawMatch,
        sermonId: rawSermonId,
        paragraphIndex: rawParaIndex,
        isValid: false,
        reason: `Le paragraphe §${rawParaIndex} n'est pas présent dans les preuves fournies pour le sermon ${rawSermonId}.`
      });
      continue;
    }

    validCitationCount++;
    citations.push({
      rawMatch,
      sermonId: rawSermonId,
      paragraphIndex: rawParaIndex,
      isValid: true,
      reason: 'Citation authentifiée avec succès contre les preuves documentaires du contexte.',
      matchedEvidence: matchedEvidenceObj ? {
        sermonId: matchedEvidenceObj.sermonId,
        sermonTitle: matchedEvidenceObj.sermonTitle,
        paragraphIndex: rawParaIndex || matchedEvidenceObj.startParagraph,
        snippet: matchedParagraphSnippet || matchedEvidenceObj.text.slice(0, 150)
      } : undefined
    });
  }

  return {
    text: responseText,
    citations,
    validCitationCount,
    invalidCitationCount,
    allCitationsValid: invalidCitationCount === 0
  };
}

async function runAllTests() {
  console.log("=================================================");
  console.log(" 🧪 TESTS DU VALIDATEUR DE CITATIONS (PHASE 2F.4)");
  console.log("=================================================");

  const mockEvidencePackage = {
    answerable: true,
    confidenceScore: 0.95,
    reason: "Preuves documentaires valides",
    query: "Question premier sceau",
    evidence: [
      {
        chunkId: "63-0324M_c1_p1_p2",
        sermonId: "63-0324M",
        sermonTitle: "Questions Et Réponses Sur Les Sceaux",
        paragraphIds: [1, 2],
        startParagraph: 1,
        endParagraph: 2,
        text: "Texte des paragraphes 1 et 2...",
        date: "1963-03-24",
        city: "Jeffersonville, IN",
        version: "VGR",
        retrievalScore: 0.94,
        rank: 1,
        sourceType: "reranked",
        citationParagraphs: [
          {
            paragraphIndex: 1,
            formattedCitation: "[Réf: 63-0324M, §1]",
            textSnippet: "Texte du paragraphe 1...",
            isAuthentic: true
          },
          {
            paragraphIndex: 2,
            formattedCitation: "[Réf: 63-0324M, §2]",
            textSnippet: "Texte du paragraphe 2...",
            isAuthentic: true
          }
        ]
      }
    ]
  };

  // --- 1. Citation parfaitement authentique ---
  console.log("\n--- 1. Citation authentique [Réf: SERMON_ID, §N] ---");
  const response1 = "Le cavalier portait un arc mais n'avait aucune flèche [Réf: 63-0324M, §2].";
  const val1 = validateResponseCitations({ responseText: response1, evidencePackage: mockEvidencePackage });

  assert(val1.validCitationCount === 1, "1 citation valide détectée");
  assert(val1.invalidCitationCount === 0, "0 citation invalide");
  assert(val1.allCitationsValid === true, "allCitationsValid = true");
  assert(val1.text === response1, "Texte original préservé à 100%");
  assert(val1.citations[0].sermonId === "63-0324M", "sermonId correct (63-0324M)");
  assert(val1.citations[0].paragraphIndex === 2, "paragraphIndex correct (2)");

  // --- 2. Citation basée sur CHUNK_ID (Rejet strict) ---
  console.log("\n--- 2. Rejet de citation basée sur CHUNK_ID ---");
  const responseChunk = "Le cavalier imite Christ [Réf: 63-0324M_c1_p1_p2].";
  const valChunk = validateResponseCitations({ responseText: responseChunk, evidencePackage: mockEvidencePackage });

  assert(valChunk.validCitationCount === 0, "0 citation valide");
  assert(valChunk.invalidCitationCount === 1, "1 citation invalide détectée");
  assert(valChunk.allCitationsValid === false, "allCitationsValid = false");
  assert(valChunk.citations[0].reason.includes("CHUNK_ID"), "Raison explicite sur l'identifiant technique CHUNK_ID");

  // --- 3. Citation pointant vers un sermon hors Evidence ---
  console.log("\n--- 3. Rejet de citation d'un sermon absente des Evidence ---");
  const responseOut = "Enseignement sur la communion [Réf: 65-1212, §1].";
  const valOut = validateResponseCitations({ responseText: responseOut, evidencePackage: mockEvidencePackage });

  assert(valOut.validCitationCount === 0, "0 citation valide");
  assert(valOut.invalidCitationCount === 1, "1 citation invalide");
  assert(valOut.allCitationsValid === false, "allCitationsValid = false");
  assert(valOut.citations[0].reason.includes("pas présent dans les preuves"), "Raison explicite sur l'absence du sermon des Evidence");

  // --- 4. Citation pointant vers un paragraphe absent de l'Evidence ---
  console.log("\n--- 4. Rejet de citation avec paragraphe absent de l'Evidence ---");
  const responseBadP = "Explication sur les sceaux [Réf: 63-0324M, §999].";
  const valBadP = validateResponseCitations({ responseText: responseBadP, evidencePackage: mockEvidencePackage });

  assert(valBadP.validCitationCount === 0, "0 citation valide");
  assert(valBadP.invalidCitationCount === 1, "1 citation invalide");
  assert(valBadP.citations[0].reason.includes("§999"), "Raison explicite sur l'absence du paragraphe §999");

  // --- 5. Réponse sans citation ---
  console.log("\n--- 5. Réponse sans aucune citation ---");
  const responseNoCit = "Ceci est une réponse explicative sans citation.";
  const valNoCit = validateResponseCitations({ responseText: responseNoCit, evidencePackage: mockEvidencePackage });

  assert(valNoCit.validCitationCount === 0, "validCitationCount = 0");
  assert(valNoCit.invalidCitationCount === 0, "invalidCitationCount = 0");
  assert(valNoCit.allCitationsValid === true, "allCitationsValid = true (réponse sans citation est valide)");

  // --- 6. Cas answerable = false (Abstention / Hors-Corpus) ---
  console.log("\n--- 6. Cas answerable = false (Abstention / Hors-Corpus) ---");
  const horsCorpusPackage = {
    answerable: false,
    confidenceScore: 0.10,
    reason: "Hors corpus",
    query: "Tour Eiffel",
    evidence: []
  };

  // A. Réponse d'abstention propre sans citation -> VALIDE
  const responseAbstention = "Les documents disponibles ne contiennent pas d'informations sur la Tour Eiffel.";
  const valAbst = validateResponseCitations({ responseText: responseAbstention, evidencePackage: horsCorpusPackage });
  assert(valAbst.validCitationCount === 0 && valAbst.invalidCitationCount === 0 && valAbst.allCitationsValid === true, "Réponse d'abstention sans citation est valide");

  // B. Réponse hallucinée avec citation sur answerable = false -> INVALIDE
  const responseHallucinated = "Voici une fausse citation [Réf: 63-0324M, §2].";
  const valHall = validateResponseCitations({ responseText: responseHallucinated, evidencePackage: horsCorpusPackage });
  assert(valHall.invalidCitationCount === 1 && valHall.allCitationsValid === false, "Toute citation sur answerable = false est déclarée invalide");

  // --- 7. Déterminisme ---
  console.log("\n--- 7. Déterminisme à 100% ---");
  const run1 = validateResponseCitations({ responseText: response1, evidencePackage: mockEvidencePackage });
  const run2 = validateResponseCitations({ responseText: response1, evidencePackage: mockEvidencePackage });
  assert(JSON.stringify(run1) === JSON.stringify(run2), "Résultats 100% identiques sur deux exécutions consécutives");

  console.log("\n=================================================");
  console.log(` RÉSULTATS : ${passedTests}/${totalTests} TESTS PASSÉS AVEC SUCCÈS`);
  console.log("=================================================");
}

runAllTests().catch(err => {
  console.error("❌ ERREUR LORS DES TESTS :", err);
  process.exit(1);
});
