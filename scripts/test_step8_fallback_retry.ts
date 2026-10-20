import { generateNewRagResponse } from '../services/generationAdapter';
import { RetrievalEvidencePackage } from '../types';

async function testFallbackAndRetry() {
  console.log("===============================================================");
  console.log("  TEST DU REPLI & DE LA RELANCE UNIQUE (INVALID_JSON_SCHEMA)");
  console.log("===============================================================\n");

  const evidencePackage: RetrievalEvidencePackage = {
    answerable: true,
    vectorMethod: 'HYBRID_RRF',
    evidence: [
      {
        sermonId: '63-0324M',
        sermonTitle: 'Le Premier Sceau',
        date: '1963-03-24',
        citationParagraphs: [
          {
            paragraphIndex: 2,
            textSnippet: "Exemple de paragraphe de test.",
            fullParagraphText: "Exemple de paragraphe de test complet.",
            formattedCitation: "> « Exemple » [Réf: 63-0324M, Para. 2]"
          }
        ]
      }
    ]
  };

  // CAS A : Mock Gemini renvoyant un JSON invalide/tronqué au 1er essai, puis un JSON valide au 2nd essai (relance réussie)
  console.log("--- CAS A : 1er essai tronqué -> Relance unique -> Succès ---");
  let callCountA = 0;
  const mockClientRetrySuccess = {
    generateContent: async () => {
      callCountA++;
      if (callCountA === 1) {
        return { text: '{"answerability": true, "summary": "JSON tronqué...' }; // Synthèse JSON invalide
      }
      return {
        text: JSON.stringify({
          answerability: true,
          summary: "Synthèse valide après relance unique.",
          arguments: [
            {
              pointTitle: "Point 1",
              explanation: "Explication 1",
              citations: [
                { sourceId: "63-0324M", paragraphIndex: 2, exactQuote: "Exemple" }
              ]
            }
          ],
          deepDiveQuestions: ["Question 1 ?"]
        })
      };
    }
  };

  const resA = await generateNewRagResponse({
    query: "Test de relance",
    evidencePackage,
    geminiClient: mockClientRetrySuccess as any
  });

  console.log(`- Nombre d'appels client Gemini: ${callCountA} (Attendu: 2 - 1er essai + 1 relance)`);
  console.log(`- Statut de la réponse: ${resA.status} (Attendu: success)`);
  console.log(`- Contenu analysé: ${resA.structuredResponse ? 'JSON valide extrait ✅' : 'Échec'}`);

  // CAS B : Mock Gemini renvoyant un JSON invalide au 1er ET au 2nd essai (échec -> INVALID_JSON_SCHEMA)
  console.log("\n--- CAS B : 1er et 2nd essais tronqués -> Erreur INVALID_JSON_SCHEMA ---");
  let callCountB = 0;
  const mockClientRetryFailure = {
    generateContent: async () => {
      callCountB++;
      return { text: 'Texte non JSON ou tronqué ' + callCountB };
    }
  };

  const resB = await generateNewRagResponse({
    query: "Test d'échec de relance",
    evidencePackage,
    geminiClient: mockClientRetryFailure as any
  });

  console.log(`- Nombre d'appels client Gemini: ${callCountB} (Attendu: 2 - 1er essai + 1 relance)`);
  console.log(`- Statut de la réponse: ${resB.status} (Attendu: error)`);
  console.log(`- Code d'erreur: ${resB.errorCode} (Attendu: INVALID_JSON_SCHEMA)`);
  console.log(`- Message d'erreur: ${resB.errorMessage}`);

  if (callCountA === 2 && resA.status === 'success' && callCountB === 2 && resB.errorCode === 'INVALID_JSON_SCHEMA') {
    console.log("\n✅ TEST DU REPLI ET DE LA RELANCE UNIQUE VALIDÉ SANS RÉGRESSION.");
  } else {
    console.error("\n❌ ÉCHEC DU TEST DE REPLI.");
    process.exit(1);
  }
}

testFallbackAndRetry().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
