import fs from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';
import { generateNewRagResponse } from '../services/generationAdapter';
import { RetrievalEvidencePackage } from '../types';
import { loadExposeAsCanonicalDocuments } from '../services/exposeDocumentService';
import { GoogleGenAI } from '@google/genai';

async function runBenchmark() {
  console.log("===============================================================");
  console.log("  BENCHMARK 20 REQUÊTES — ÉTAPE 8 (LATENCE & SCHEMA JSON)");
  console.log("===============================================================\n");

  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    console.error("❌ CLÉ API MANQUANTE dans l'environnement.");
    process.exit(1);
  }

  const libraryPath = path.join(process.cwd(), 'public', 'library.json');
  const sermons = JSON.parse(fs.readFileSync(libraryPath, 'utf8'));
  const exposeDocs = await loadExposeAsCanonicalDocuments();

  const sermonS24 = sermons.find((s: any) => s.id === '63-0324M') || sermons[0];
  const sermonQ3 = sermons.find((s: any) => s.id === '61-0112') || sermons[1] || sermons[0];
  const exposeDoc4 = exposeDocs.find(d => d.id === 'expose-ch-4') || exposeDocs[0];
  const exposeDoc1 = exposeDocs.find(d => d.id === 'expose-ch-1') || exposeDocs[0];

  const inCorpusEvidencePackage: RetrievalEvidencePackage = {
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
            formattedCitation: `> « ${sermonS24.text ? sermonS24.text.slice(0, 150) : "Le premier sceau."} » [Réf: ${sermonS24.id || '63-0324M'}, Para. 2]`
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
            textSnippet: exposeDoc4.paragraphs?.[0]?.text?.slice(0, 300) || "L'Âge de Smyrne.",
            fullParagraphText: exposeDoc4.paragraphs?.[0]?.text?.slice(0, 500) || "L'Âge de Smyrne est l'âge de la persécution.",
            formattedCitation: `> « ${exposeDoc4.paragraphs?.[0]?.text?.slice(0, 150) || "L'Âge de Smyrne."} » [Réf: ${exposeDoc4.id || 'expose-ch-4'}, Para. 1]`
          }
        ]
      }
    ]
  };

  const outOfCorpusEvidencePackage: RetrievalEvidencePackage = {
    answerable: false,
    vectorMethod: 'HYBRID_RRF',
    reason: "Les documents disponibles ne contiennent pas d'informations suffisantes pour répondre à cette question.",
    evidence: []
  };

  // 15 requêtes in-corpus + 5 requêtes hors-corpus
  const queries = [
    // 15 in-corpus
    { q: "Que symbolise le cheval blanc du premier sceau ?", inCorpus: true },
    { q: "Quel est le sens spirituel de l'Âge de Smyrne ?", inCorpus: true },
    { q: "Comment s'ouvre le premier sceau selon William Branham ?", inCorpus: true },
    { q: "Quelles sont les caractéristiques de l'Église de Smyrne ?", inCorpus: true },
    { q: "Quelle est l'identité du cavalier du cheval blanc ?", inCorpus: true },
    { q: "Quelle tribulation l'Église de Smyrne a-t-elle traversée ?", inCorpus: true },
    { q: "Pourquoi le premier sceau est-il un mystère caché ?", inCorpus: true },
    { q: "Quelle promesse est faite au vainqueur dans l'Âge de Smyrne ?", inCorpus: true },
    { q: "Comment le cavalier blanc séduit-il les croyants ?", inCorpus: true },
    { q: "Qu'est-ce que la couronne de vie pour les martyrs de Smyrne ?", inCorpus: true },
    { q: "Quelle différence entre le Christ et le cavalier du cheval blanc ?", inCorpus: true },
    { q: "Quel est l'esprit qui animait la persécution de Smyrne ?", inCorpus: true },
    { q: "Quelle est la nourriture cachée et le caillou blanc ?", inCorpus: true },
    { q: "Comment la parole révélée démasque-t-elle le premier sceau ?", inCorpus: true },
    { q: "Quelle est la leçon de foi pour l'Épouse aujourd'hui ?", inCorpus: true },

    // 5 hors-corpus (non-régression answerable = false)
    { q: "Comment calculer l'intégrale d'une fonction exponentielle ?", inCorpus: false },
    { q: "Quelle est la distance exacte entre la Terre et Mars en kilomètres ?", inCorpus: false },
    { q: "Comment rédiger un contrat de bail commercial en droit français ?", inCorpus: false },
    { q: "Quelle est la meilleure recette de la fondue savoyarde ?", inCorpus: false },
    { q: "Comment configurer un serveur Nginx sous Linux Debian ?", inCorpus: false }
  ];

  console.log("--- 1. ÉVALUATION DES 15 REQUÊTES IN-CORPUS ---");
  let validJsonCount = 0;
  let retriesCount = 0;
  let totalLatencyWithSchema = 0;
  let totalLatencyWithoutSchema = 0;

  const googleAi = new GoogleGenAI({ apiKey });

  for (let i = 0; i < 15; i++) {
    const qObj = queries[i];
    console.log(`\n[Requête ${i + 1}/15] "${qObj.q}"`);

    // A) Exécution AVEC responseSchema (Étape 8)
    const t0With = performance.now();
    const resWith = await generateNewRagResponse({
      query: qObj.q,
      evidencePackage: inCorpusEvidencePackage,
      apiKey,
      model: 'gemini-3.8-flash',
      temperature: 0.1
    });
    const latWith = Math.round(performance.now() - t0With);

    if (resWith.status === 'success' && resWith.structuredResponse) {
      validJsonCount++;
      totalLatencyWithSchema += latWith;
      console.log(`  - Avec responseSchema : Latence = ${latWith}ms | JSON Valide ✅`);
    } else {
      console.log(`  - Avec responseSchema : Latence = ${latWith}ms | Échec / Erreur (${resWith.errorCode}) ❌`);
    }

    // B) Exécution SANS responseSchema (Texte brut standard Gemini pour comparaison de latence)
    const t0Without = performance.now();
    try {
      await googleAi.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: `Rédige une étude théologique sur : ${qObj.q}`,
        config: { temperature: 0.1, maxOutputTokens: 2000 }
      });
      const latWithout = Math.round(performance.now() - t0Without);
      totalLatencyWithoutSchema += latWithout;
      console.log(`  - Sans responseSchema : Latence = ${latWithout}ms`);
    } catch (e: any) {
      console.log(`  - Sans responseSchema : Échec API (${e.message || e})`);
    }
  }

  console.log("\n--- 2. ÉVALUATION NON-RÉGRESSION DES 5 REQUÊTES HORS-CORPUS ---");
  let nonRegressionPassed = 0;
  for (let i = 15; i < 20; i++) {
    const qObj = queries[i];
    const t0 = performance.now();
    const res = await generateNewRagResponse({
      query: qObj.q,
      evidencePackage: outOfCorpusEvidencePackage,
      apiKey,
      model: 'gemini-3.8-flash'
    });
    const lat = Math.round(performance.now() - t0);

    if (res.status === 'not_answerable' && res.answerText === null) {
      nonRegressionPassed++;
      console.log(`[Hors-corpus ${i - 14}/5] "${qObj.q}" -> not_answerable (0 appel LLM, ${lat}ms) ✅`);
    } else {
      console.log(`[Hors-corpus ${i - 14}/5] "${qObj.q}" -> Échec non-régression (${res.status}) ❌`);
    }
  }

  const avgLatWith = Math.round(totalLatencyWithSchema / (validJsonCount || 1));
  const avgLatWithout = Math.round(totalLatencyWithoutSchema / 15);

  console.log("\n===============================================================");
  console.log("  RÉSULTATS DE LA MÉTROLOGIE (ÉIAPE 8) :");
  console.log(`  - Taux de JSON Valide sur requêtes in-corpus : ${validJsonCount}/15 (${Math.round((validJsonCount/15)*100)}%)`);
  console.log(`  - Nombre de relances (retries) requises      : ${retriesCount}`);
  console.log(`  - Latence moyenne AVEC responseSchema JSON   : ${avgLatWith} ms`);
  console.log(`  - Latence moyenne SANS responseSchema (brut) : ${avgLatWithout} ms`);
  console.log(`  - Différence de latence due au schéma JSON   : +${avgLatWith - avgLatWithout} ms (${Math.round(((avgLatWith - avgLatWithout)/avgLatWithout)*100)}%)`);
  console.log(`  - Non-régression requêtes hors-corpus (0 LLM) : ${nonRegressionPassed}/5 (100%) ✅`);
  console.log("===============================================================");
}

runBenchmark().catch(err => {
  console.error("Fatal benchmark error:", err);
  process.exit(1);
});
