import fs from 'fs';
import path from 'path';
import { generateNewRagResponse, STEP8_RESPONSE_SCHEMA } from '../services/generationAdapter';
import { RetrievalEvidencePackage } from '../types';
import { loadExposeAsCanonicalDocuments } from '../services/exposeDocumentService';

async function main() {
  console.log("===============================================================");
  console.log("  TEST ÉTAPE 8 : SORTIE STRUCTURÉE (responseSchema JSON)");
  console.log("===============================================================\n");

  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    console.error("❌ CLÉ API MANQUANTE dans l'environnement (GEMINI_API_KEY ou VITE_GEMINI_API_KEY).");
    process.exit(1);
  }

  // Charger le corpus de test (librairie locale + Exposé)
  const libraryPath = path.join(process.cwd(), 'public', 'library.json');
  const sermons = JSON.parse(fs.readFileSync(libraryPath, 'utf8'));
  const exposeDocs = await loadExposeAsCanonicalDocuments();

  // Fabriquer un evidence package de test pour une question couverte
  const sermonS24 = sermons.find((s: any) => s.id === '63-0324M') || sermons[0];
  const exposeDoc4 = exposeDocs.find(d => d.id === 'expose-ch-4') || exposeDocs[0];

  const answerableEvidencePackage: RetrievalEvidencePackage = {
    answerable: true,
    vectorMethod: 'HYBRID_RRF',
    evidence: [
      {
        sermonId: sermonS24.id || '63-0324M',
        sermonTitle: sermonS24.title || 'Le Premier Sceau',
        date: '1963-03-24',
        citationParagraphs: [
          {
            paragraphIndex: 2,
            textSnippet: sermonS24.text ? sermonS24.text.slice(0, 300) : "Le premier sceau s'ouvre avec le mystère du cheval blanc.",
            fullParagraphText: sermonS24.text ? sermonS24.text.slice(0, 500) : "Le premier sceau s'ouvre avec le mystère du cheval blanc.",
            formattedCitation: `> « ${sermonS24.text ? sermonS24.text.slice(0, 200) : "Le premier sceau s'ouvre avec le mystère du cheval blanc."} » [Réf: ${sermonS24.id || '63-0324M'}, Para. 2]`
          }
        ]
      },
      {
        sermonId: exposeDoc4.id || 'expose-ch-4',
        sermonTitle: exposeDoc4.title || 'L\'Âge de Smyrne',
        date: '1965',
        citationParagraphs: [
          {
            paragraphIndex: 1,
            textSnippet: exposeDoc4.paragraphs?.[0]?.text?.slice(0, 300) || "L'Âge de Smyrne est l'âge de la persécution de l'Église.",
            fullParagraphText: exposeDoc4.paragraphs?.[0]?.text?.slice(0, 500) || "L'Âge de Smyrne est l'âge de la persécution de l'Église.",
            formattedCitation: `> « ${exposeDoc4.paragraphs?.[0]?.text?.slice(0, 200) || "L'Âge de Smyrne est l'âge de la persécution de l'Église."} » [Réf: ${exposeDoc4.id || 'expose-ch-4'}, Para. 1]`
          }
        ]
      }
    ]
  };

  const unanswerableEvidencePackage: RetrievalEvidencePackage = {
    answerable: false,
    vectorMethod: 'HYBRID_RRF',
    reason: "Les documents disponibles ne contiennent pas d'informations suffisantes.",
    evidence: []
  };

  const testQueries = [
    { query: "Que révèle le premier sceau sur le cheval blanc ?", package: answerableEvidencePackage, expectedAnswerable: true },
    { query: "Quel est le sens spirituel de l'Âge de Smyrne ?", package: answerableEvidencePackage, expectedAnswerable: true },
    { query: "Comment programmer en Python une pile LIFO ?", package: unanswerableEvidencePackage, expectedAnswerable: false },
    { query: "Quelle est la recette de la tarte aux pommes ?", package: unanswerableEvidencePackage, expectedAnswerable: false }
  ];

  console.log("--- Executing Real Gemini Calls with responseSchema ---");
  let validJsonCount = 0;
  let totalLatency = 0;

  for (let i = 0; i < testQueries.length; i++) {
    const t = testQueries[i];
    console.log(`\n[Test ${i + 1}/${testQueries.length}] Query: "${t.query}"`);
    console.log(`Expected Answerable: ${t.expectedAnswerable}`);

    const res = await generateNewRagResponse({
      query: t.query,
      evidencePackage: t.package,
      apiKey,
      model: 'gemini-3.8-flash',
      temperature: 0.1
    });

    console.log(`- Status: ${res.status}`);
    console.log(`- Provider: ${res.provider}`);
    console.log(`- Latency: ${res.latencyMs}ms`);

    if (t.expectedAnswerable) {
      if (res.status === 'success' && res.structuredResponse) {
        const sr = res.structuredResponse;
        validJsonCount++;
        totalLatency += (res.latencyMs || 0);

        console.log(`- JSON Valid: TRUE ✅`);
        console.log(`- answerability: ${sr.answerability}`);
        console.log(`- summary: "${sr.summary.slice(0, 100)}..."`);
        console.log(`- arguments count: ${sr.arguments?.length || 0}`);
        console.log(`- deepDiveQuestions count: ${sr.deepDiveQuestions?.length || 0}`);

        // Vérification de restriction des sourceId
        const allowedSourceIds = new Set(t.package.evidence.map(e => e.sermonId));
        let invalidSources: string[] = [];

        sr.arguments.forEach(arg => {
          arg.citations.forEach(c => {
            if (!allowedSourceIds.has(c.sourceId)) {
              invalidSources.push(c.sourceId);
            }
          });
        });

        if (invalidSources.length === 0) {
          console.log(`- sourceId Check: PASSED (All cited sourceIds belong to evidence package) ✅`);
        } else {
          console.error(`- sourceId Check: FAILED (Forbidden sourceIds cited: ${invalidSources.join(', ')}) ❌`);
        }
      } else {
        console.error(`❌ FAILED: Expected valid JSON structured response but got status=${res.status}, error=${res.errorMessage}`);
      }
    } else {
      if (res.status === 'not_answerable') {
        console.log(`- Answerability false respected: PASSED ✅`);
      } else {
        console.error(`❌ FAILED: Expected status='not_answerable' but got ${res.status}`);
      }
    }
  }

  console.log("\n===============================================================");
  console.log(`  Bilan des Tests Étape 8 :`);
  console.log(`  - Taux de JSON Valide sur requêtes couvetes: ${validJsonCount}/2 (${(validJsonCount/2)*100}%)`);
  console.log(`  - Latence moyenne: ${Math.round(totalLatency / (validJsonCount || 1))}ms`);
  console.log("===============================================================");
}

main().catch(err => {
  console.error("Fatal error in test script:", err);
  process.exit(1);
});
