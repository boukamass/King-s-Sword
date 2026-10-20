import fs from 'fs';
import path from 'path';
import { generateNewRagResponse } from '../services/generationAdapter';
import { validateResponseCitations } from '../services/citationValidationService';
import { RetrievalEvidencePackage } from '../types';
import { loadExposeAsCanonicalDocuments } from '../services/exposeDocumentService';

async function main() {
  console.log("=========================================================================================================");
  console.log("  SCRIPT D'INTÉGRATION ÉTAPE 9 : VALIDATION DÉTERMINISTE DES CITATIONS SUR 20 REQUÊTES GEMINI");
  console.log("=========================================================================================================\n");

  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    console.error("❌ ERREUR : Aucune clé API Gemini trouvée dans l'environnement.");
    console.error("Lancez le script avec votre clé : GEMINI_API_KEY=\"VOTRE_CLE\" npx tsx scripts/run_step9_integration_20_queries.ts");
    process.exit(1);
  }

  const libraryPath = path.join(process.cwd(), 'public', 'library.json');
  const sermons = JSON.parse(fs.readFileSync(libraryPath, 'utf8'));
  const exposeDocs = await loadExposeAsCanonicalDocuments();

  const sermonS24 = sermons.find((s: any) => s.id === '63-0324M') || sermons[0];
  const exposeDoc4 = exposeDocs.find(d => d.documentId === 'expose-ch-4') || exposeDocs[0];

  const inCorpusPackage: RetrievalEvidencePackage = {
    answerable: true,
    vectorMethod: 'HYBRID_RRF',
    evidence: [
      {
        sermonId: sermonS24.id || '63-0324M',
        sermonTitle: sermonS24.title || 'Le Premier Sceau',
        date: '1963-03-24',
        chunkId: '63-0324M_c1',
        paragraphIds: [1, 2, 3],
        startParagraph: 1,
        endParagraph: 3,
        text: sermonS24.text || '',
        retrievalScore: 1.0,
        rank: 1,
        sourceType: 'full_text',
        citationParagraphs: [
          {
            paragraphIndex: 2,
            textSnippet: sermonS24.text ? sermonS24.text.slice(0, 300) : "Le premier sceau s'ouvre avec le mystère du cheval blanc.",
            fullParagraphText: sermonS24.text ? sermonS24.text.slice(0, 600) : "Le premier sceau s'ouvre avec le mystère du cheval blanc.",
            formattedCitation: `> « ${sermonS24.text ? sermonS24.text.slice(0, 150) : "Le premier sceau."} » [Réf: ${sermonS24.id || '63-0324M'}, Para. 2]`,
            isAuthentic: true
          }
        ]
      },
      {
        sermonId: exposeDoc4.documentId || 'expose-ch-4',
        sermonTitle: exposeDoc4.title || 'L\'Âge de Smyrne',
        date: '1965',
        chunkId: 'expose-ch-4_c1',
        paragraphIds: [1, 2],
        startParagraph: 1,
        endParagraph: 2,
        text: exposeDoc4.paragraphs?.[0]?.text || '',
        retrievalScore: 1.0,
        rank: 2,
        sourceType: 'full_text',
        citationParagraphs: [
          {
            paragraphIndex: 1,
            textSnippet: exposeDoc4.paragraphs?.[0]?.text?.slice(0, 300) || "L'Âge de Smyrne est l'âge de la persécution.",
            fullParagraphText: exposeDoc4.paragraphs?.[0]?.text?.slice(0, 600) || "L'Âge de Smyrne est l'âge de la persécution.",
            formattedCitation: `> « ${exposeDoc4.paragraphs?.[0]?.text?.slice(0, 150) || "L'Âge de Smyrne."} » [Réf: ${exposeDoc4.documentId || 'expose-ch-4'}, Para. 1]`,
            isAuthentic: true
          }
        ]
      }
    ]
  };

  const outOfCorpusPackage: RetrievalEvidencePackage = {
    answerable: false,
    vectorMethod: 'HYBRID_RRF',
    reason: "Les documents ne contiennent pas d'informations suffisantes.",
    evidence: []
  };

  const queries = [
    // 15 requêtes in-corpus
    { q: "Que symbolise le cheval blanc du premier sceau ?", pkg: inCorpusPackage, inCorpus: true },
    { q: "Quel est le sens spirituel de l'Âge de Smyrne ?", pkg: inCorpusPackage, inCorpus: true },
    { q: "Comment s'ouvre le premier sceau selon William Branham ?", pkg: inCorpusPackage, inCorpus: true },
    { q: "Quelles sont les caractéristiques de l'Église de Smyrne ?", pkg: inCorpusPackage, inCorpus: true },
    { q: "Quelle est l'identité du cavalier du cheval blanc ?", pkg: inCorpusPackage, inCorpus: true },
    { q: "Quelle tribulation l'Église de Smyrne a-t-elle traversée ?", pkg: inCorpusPackage, inCorpus: true },
    { q: "Pourquoi le premier sceau est-il un mystère caché ?", pkg: inCorpusPackage, inCorpus: true },
    { q: "Quelle promesse est faite au vainqueur dans l'Âge de Smyrne ?", pkg: inCorpusPackage, inCorpus: true },
    { q: "Comment le cavalier blanc séduit-il les croyants ?", pkg: inCorpusPackage, inCorpus: true },
    { q: "Qu'est-ce que la couronne de vie pour les martyrs de Smyrne ?", pkg: inCorpusPackage, inCorpus: true },
    { q: "Quelle différence entre le Christ et le cavalier du cheval blanc ?", pkg: inCorpusPackage, inCorpus: true },
    { q: "Quel est l'esprit qui animait la persécution de Smyrne ?", pkg: inCorpusPackage, inCorpus: true },
    { q: "Quelle est la nourriture cachée et le caillou blanc ?", pkg: inCorpusPackage, inCorpus: true },
    { q: "Comment la parole révélée démasque-t-elle le premier sceau ?", pkg: inCorpusPackage, inCorpus: true },
    { q: "Quelle est la leçon de foi pour l'Épouse aujourd'hui ?", pkg: inCorpusPackage, inCorpus: true },

    // 5 requêtes hors-corpus (non-régression)
    { q: "Comment programmer en Python une pile LIFO ?", pkg: outOfCorpusPackage, inCorpus: false },
    { q: "Quelle est la distance entre la Terre et Mars ?", pkg: outOfCorpusPackage, inCorpus: false },
    { q: "Comment rédiger un contrat de bail commercial ?", pkg: outOfCorpusPackage, inCorpus: false },
    { q: "Quelle est la recette de la fondue savoyarde ?", pkg: outOfCorpusPackage, inCorpus: false },
    { q: "Comment configurer un serveur Nginx sous Linux ?", pkg: outOfCorpusPackage, inCorpus: false }
  ];

  const jsonLogResults: any[] = [];
  let totalValide = 0;
  let totalCorrigee = 0;
  let totalRejetee = 0;

  console.log("-------------------------------------------------------------------------------------------------------------------------------------------------------------------------");
  console.log("REQ N° | QUESTION                                | STATUT RAG       | CITATIONS EXTRAITES ET VALIDATIONS DÉTERMINISTES");
  console.log("-------------------------------------------------------------------------------------------------------------------------------------------------------------------------");

  for (let i = 0; i < queries.length; i++) {
    const qObj = queries[i];
    const res = await generateNewRagResponse({
      query: qObj.q,
      evidencePackage: qObj.pkg,
      apiKey,
      model: 'gemini-3.8-flash',
      temperature: 0.1
    });

    const queryLogItem: any = {
      queryIndex: i + 1,
      query: qObj.q,
      inCorpus: qObj.inCorpus,
      status: res.status,
      latencyMs: res.latencyMs,
      citations: []
    };

    const qCol = qObj.q.padEnd(38).slice(0, 38);
    console.log(`\n[${(i + 1).toString().padStart(2)}] | ${qCol} | ${res.status.padEnd(16)} | Latence : ${res.latencyMs}ms`);

    if (res.status === 'success' && res.answerText) {
      const valRes = validateResponseCitations({
        responseText: res.answerText,
        evidencePackage: qObj.pkg
      });

      if (valRes.citations.length === 0) {
        console.log(`     └─ AUCUNE CITATION DÉCLARÉE DANS LE TEXTE GENERÉ.`);
      } else {
        valRes.citations.forEach((c, cIdx) => {
          const st = c.status || (c.isValid ? 'VALIDE' : 'REJETEE');
          if (st === 'VALIDE') totalValide++;
          else if (st === 'CORRIGEE') totalCorrigee++;
          else if (st === 'REJETEE') totalRejetee++;

          queryLogItem.citations.push({
            citationIndex: cIdx + 1,
            sermonId: c.sermonId,
            paragraphIndex: c.paragraphIndex,
            quotedText: c.quotedText,
            status: st,
            similarity: c.similarity,
            reason: c.reason,
            isParagraphCorrected: c.isParagraphCorrected || false,
            actualParagraphIndex: c.actualParagraphIndex || c.paragraphIndex,
            isSourceIdCorrected: c.isSourceIdCorrected || false,
            actualSourceId: c.actualSourceId || c.sermonId,
            isQuoteCorrected: c.isQuoteCorrected || false,
            correctedQuote: c.correctedQuote || null
          });

          const badge = st === 'VALIDE' ? '🟢 VALIDE' : (st === 'CORRIGEE' ? '🟡 CORRIGÉE' : '🔴 REJETÉE');
          const simPct = (c.similarity !== undefined ? (c.similarity * 100).toFixed(1) : '100.0') + '%';
          console.log(`     └─ Citation ${cIdx + 1} : ${badge} (Sim: ${simPct}) | Réf: [${c.sermonId}, §${c.paragraphIndex}]`);
          console.log(`        Extrait : "${(c.quotedText || '').slice(0, 80)}..."`);
          console.log(`        Raison  : ${c.reason}`);
        });
      }
    } else {
      console.log(`     └─ (Non answerable / Hors corpus : 0 appel LLM effectué)`);
    }

    jsonLogResults.push(queryLogItem);
  }

  // Enregistrement du fichier JSON de résultats
  const outputDir = path.join(process.cwd(), 'scripts', 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const jsonOutputPath = path.join(outputDir, 'step9_citation_validation_results.json');
  fs.readFileSync;
  fs.writeFileSync(jsonOutputPath, JSON.stringify(jsonLogResults, null, 2), 'utf8');

  console.log("\n-------------------------------------------------------------------------------------------------------------------------------------------------------------------------");
  console.log("  BILAN D'INTÉGRATION DES CITATIONS (ÉIAPE 9) :");
  console.log(`  - Citations VALIDES   : ${totalValide} 🟢`);
  console.log(`  - Citations CORRIGÉES : ${totalCorrigee} 🟡`);
  console.log(`  - Citations REJETÉES  : ${totalRejetee} 🔴`);
  console.log(`\n💾 Fichier JSON de journalisation enregistré : ${jsonOutputPath}`);
  console.log("-------------------------------------------------------------------------------------------------------------------------------------------------------------------------\n");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
