import { validateSingleCitation, calculateNormalizedSimilarity, normalizeTextForComparison } from '../services/citationValidationService';
import { RetrievalEvidencePackage } from '../types';

async function main() {
  console.log("=========================================================================================================");
  console.log("  TESTS UNITAIRES DÉTERMINISTES DU VALIDATEUR DE CITATIONS (ÉIAPE 9 - 15 CAS SANS APPEL GEMINI)");
  console.log("=========================================================================================================\n");

  // Package d'Evidence de référence pour les tests
  const evidencePackage: RetrievalEvidencePackage = {
    answerable: true,
    vectorMethod: 'HYBRID_RRF',
    evidence: [
      {
        sermonId: '63-0324M',
        sermonTitle: 'Le Premier Sceau',
        date: '1963-03-24',
        chunkId: '63-0324M_c1',
        paragraphIds: [1, 2, 3],
        startParagraph: 1,
        endParagraph: 3,
        text: 'Texte complet du sermon',
        retrievalScore: 1.0,
        rank: 1,
        sourceType: 'full_text',
        citationParagraphs: [
          {
            paragraphIndex: 1,
            textSnippet: "Au commencement était la Parole, et la Parole était avec Dieu.",
            fullParagraphText: "Au commencement était la Parole, et la Parole était avec Dieu.",
            formattedCitation: "> « Au commencement... » [Réf: 63-0324M, §1]",
            isAuthentic: true
          },
          {
            paragraphIndex: 2,
            textSnippet: "Le premier sceau s'ouvre avec le mystère du cheval blanc.",
            fullParagraphText: "Le premier sceau s'ouvre avec le mystère du cheval blanc.",
            formattedCitation: "> « Le premier sceau... » [Réf: 63-0324M, §2]",
            isAuthentic: true
          },
          {
            paragraphIndex: 3,
            textSnippet: "Le cavalier du cheval blanc porte un arc mais n'a pas de flèche.",
            fullParagraphText: "Le cavalier du cheval blanc porte un arc mais n'a pas de flèche.",
            formattedCitation: "> « Le cavalier... » [Réf: 63-0324M, §3]",
            isAuthentic: true
          }
        ]
      },
      {
        sermonId: 'expose-ch-4',
        sermonTitle: 'L\'Âge de Smyrne',
        date: '1965',
        chunkId: 'expose-ch-4_c1',
        paragraphIds: [1, 2],
        startParagraph: 1,
        endParagraph: 2,
        text: 'Texte complet de l\'Exposé',
        retrievalScore: 1.0,
        rank: 2,
        sourceType: 'full_text',
        citationParagraphs: [
          {
            paragraphIndex: 1,
            textSnippet: "L'Âge de Smyrne est l'âge de la grande persécution des saints.",
            fullParagraphText: "L'Âge de Smyrne est l'âge de la grande persécution des saints.",
            formattedCitation: "> « L'Âge de Smyrne... » [Réf: expose-ch-4, §1]",
            isAuthentic: true
          }
        ]
      }
    ]
  };

  // Les 15 cas de test rédigés à la main
  const testCases = [
    {
      id: 1,
      description: "Citation exacte dans le paragraphe indiqué (§2)",
      quote: "Le premier sceau s'ouvre avec le mystère du cheval blanc.",
      declaredSourceId: "63-0324M",
      declaredPara: 2,
      expectedStatus: "VALIDE"
    },
    {
      id: 2,
      description: "Casse et apostrophes différentes",
      quote: "le premier sceau s'ouvre avec le mystère du cheval blanc",
      declaredSourceId: "63-0324M",
      declaredPara: 2,
      expectedStatus: "VALIDE"
    },
    {
      id: 3,
      description: "Espaces multiples en trop entre les mots",
      quote: "Le  premier   sceau s'ouvre  avec  le mystère   du cheval blanc.",
      declaredSourceId: "63-0324M",
      declaredPara: 2,
      expectedStatus: "VALIDE"
    },
    {
      id: 4,
      description: "Citation tronquée avec ellipses (...)",
      quote: "Le premier sceau s'ouvre... du cheval blanc.",
      declaredSourceId: "63-0324M",
      declaredPara: 2,
      expectedStatus: "VALIDE"
    },
    {
      id: 5,
      description: "Mot remplacé (similarité ~0.93 >= 90%)",
      quote: "Le premier sceau s'ouvre avec le secret du cheval blanc.", // "mystère" remplacé par "secret"
      declaredSourceId: "63-0324M",
      declaredPara: 2,
      expectedStatus: "CORRIGEE"
    },
    {
      id: 6,
      description: "Paraphrase éloignée (similarité < 90%)",
      quote: "Le premier symbole parle d'un cheval de couleur blanche représentant la séduction spirituelle.",
      declaredSourceId: "63-0324M",
      declaredPara: 2,
      expectedStatus: "REJETEE"
    },
    {
      id: 7,
      description: "Citation totalement inventée / fictive",
      quote: "William Branham a enseigné que le micro-ordinateur est l'image de la bête.",
      declaredSourceId: "63-0324M",
      declaredPara: 2,
      expectedStatus: "REJETEE"
    },
    {
      id: 8,
      description: "sourceId totalement inexistant dans le package",
      quote: "Texte quelconque",
      declaredSourceId: "sermon-inconnu-99",
      declaredPara: 1,
      expectedStatus: "REJETEE"
    },
    {
      id: 9,
      description: "Mauvais paragraphIndex déclaré (§1 au lieu de §2)",
      quote: "Le premier sceau s'ouvre avec le mystère du cheval blanc.",
      declaredSourceId: "63-0324M",
      declaredPara: 1, // Déclaré §1, mais le texte est au §2
      expectedStatus: "VALIDE"
    },
    {
      id: 10,
      description: "Citation exacte dans le paragraphe voisin (§3 au lieu de §2)",
      quote: "Le cavalier du cheval blanc porte un arc mais n'a pas de flèche.",
      declaredSourceId: "63-0324M",
      declaredPara: 2, // Voisin de §3
      expectedStatus: "VALIDE"
    },
    {
      id: 11,
      description: "Citation chevauchant deux paragraphes consécutifs (§2 et §3)",
      quote: "du cheval blanc. Le cavalier du cheval blanc porte un arc",
      declaredSourceId: "63-0324M",
      declaredPara: 2,
      expectedStatus: "VALIDE"
    },
    {
      id: 12,
      description: "Citation exacte d'un AUTRE document du package (mismatch sourceId)",
      quote: "L'Âge de Smyrne est l'âge de la grande persécution des saints.", // Provient de expose-ch-4
      declaredSourceId: "63-0324M", // Déclaré 63-0324M à tort
      declaredPara: 1,
      expectedStatus: "CORRIGEE"
    },
    {
      id: 13,
      description: "Citation trop courte (< 4 mots)",
      quote: "du cheval blanc",
      declaredSourceId: "63-0324M",
      declaredPara: 2,
      expectedStatus: "A_VERIFIER"
    },
    {
      id: 14,
      description: "Chaîne de citation vide",
      quote: "",
      declaredSourceId: "63-0324M",
      declaredPara: 2,
      expectedStatus: "REJETEE"
    },
    {
      id: 15,
      description: "Texte avec caractères spéciaux, accents conservés et ligatures (« », œ, é, ç)",
      quote: "L'Âge de Smyrne est l'âge de la grande persécution des saints.",
      declaredSourceId: "expose-ch-4",
      declaredPara: 1,
      expectedStatus: "VALIDE"
    }
  ];

  console.log("-------------------------------------------------------------------------------------------------------------------------------------------------------------------------");
  console.log("N° | DESCRIPTION                            | CITATION TESTÉE                                         | TEXTE SOURCE EXTRAIT                                    | SIMILARITÉ | DÉCISION ATTENDUE / OBTENUE | RAISON / CORRECTION");
  console.log("-------------------------------------------------------------------------------------------------------------------------------------------------------------------------");

  let passedCount = 0;

  for (const tc of testCases) {
    const res = validateSingleCitation(tc.quote, tc.declaredSourceId, tc.declaredPara, evidencePackage);
    const obtainedStatus = res.status || (res.isValid ? 'VALIDE' : 'REJETEE');
    const simPct = (res.similarity !== undefined ? (res.similarity * 100).toFixed(1) : '0.0') + '%';
    const isSuccess = obtainedStatus === tc.expectedStatus;

    if (isSuccess) passedCount++;

    const descCol = tc.description.padEnd(38).slice(0, 38);
    const quoteCol = (tc.quote ? `"${tc.quote}"` : '""').padEnd(40).slice(0, 40);
    const sourceTextCol = (res.correctedQuote || res.matchedEvidence?.snippet || "Source non trouvée").padEnd(40).slice(0, 40);
    const simCol = simPct.padStart(10);
    const statusCol = `${tc.expectedStatus} -> ${obtainedStatus}`.padEnd(25);
    const icon = isSuccess ? '✅' : '❌';

    console.log(`${tc.id.toString().padStart(2)} | ${descCol} | ${quoteCol} | ${sourceTextCol} | ${simCol} | ${statusCol} | ${icon} ${res.reason.slice(0, 50)}`);
  }

  console.log("-------------------------------------------------------------------------------------------------------------------------------------------------------------------------");
  console.log(`\nBILAN DU VALIDATEUR DÉTERMINISTE (ÉIAPE 9) : ${passedCount}/15 tests réussis (${Math.round((passedCount/15)*100)}%) ✅\n`);

  if (passedCount < 15) {
    console.error("❌ Échec sur certains cas de test.");
    process.exit(1);
  }
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
