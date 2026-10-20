import { loadExposeAsCanonicalDocuments } from '../services/exposeDocumentService';
import { validateSingleCitation } from '../services/citationValidationService';
import { RetrievalEvidencePackage } from '../types';

async function main() {
  console.log("=========================================================================================================");
  console.log("  5 TESTS SUR DE VRAIS PARAGRAPHES DU CORPUS DE L'EXPOSÉ DES SEPT ÂGES (ÉIAPE 9)");
  console.log("=========================================================================================================\n");

  const exposeDocs = await loadExposeAsCanonicalDocuments();
  if (!exposeDocs || exposeDocs.length < 5) {
    console.error("❌ Impossible de charger les documents de l'Exposé.");
    process.exit(1);
  }

  const doc1 = exposeDocs.find(d => d.documentId === 'expose-ch-1') || exposeDocs[0];
  const doc2 = exposeDocs.find(d => d.documentId === 'expose-ch-2') || exposeDocs[1];
  const doc3 = exposeDocs.find(d => d.documentId === 'expose-ch-3') || exposeDocs[2];
  const doc4 = exposeDocs.find(d => d.documentId === 'expose-ch-4') || exposeDocs[3];
  const doc5 = exposeDocs.find(d => d.documentId === 'expose-ch-5') || exposeDocs[4];

  // Sélection de 5 paragraphes réels authentiques
  const docs = [doc1, doc2, doc3, doc4, doc5];
  const realTests = docs.map((doc, idx) => {
    const validPara = doc.paragraphs.find(p => p.text && p.text.trim().length > 60) || doc.paragraphs[0];
    return {
      id: idx + 1,
      docId: doc.documentId,
      title: doc.title,
      paraIndex: validPara.paragraphIndex,
      fullText: validPara.text,
      testedQuote: validPara.text.slice(0, 100).trim(),
      expectedStatus: "VALIDE"
    };
  });

  const evidencePackage: RetrievalEvidencePackage = {
    answerable: true,
    vectorMethod: 'HYBRID_RRF',
    evidence: realTests.map(t => ({
      sermonId: t.docId,
      sermonTitle: t.title,
      date: '1965',
      chunkId: `${t.docId}_c1`,
      paragraphIds: [t.paraIndex],
      startParagraph: t.paraIndex,
      endParagraph: t.paraIndex,
      text: t.fullText,
      retrievalScore: 1.0,
      rank: t.id,
      sourceType: 'full_text',
      citationParagraphs: [
        {
          paragraphIndex: t.paraIndex,
          textSnippet: t.fullText,
          fullParagraphText: t.fullText,
          formattedCitation: `> « ${t.testedQuote} » [Réf: ${t.docId}, §${t.paraIndex}]`,
          isAuthentic: true
        }
      ]
    }))
  };

  console.log("-------------------------------------------------------------------------------------------------------------------------------------------------------------------------");
  console.log("N° | CHAPITRE EXPOSÉ                     | EXTRAIT TESTÉ DU CORPUS REEL                           | SIMILARITÉ | STATUT | RESULTAT");
  console.log("-------------------------------------------------------------------------------------------------------------------------------------------------------------------------");

  let passed = 0;
  for (const t of realTests) {
    const res = validateSingleCitation(t.testedQuote, t.docId, t.paraIndex, evidencePackage);
    const simPct = (res.similarity !== undefined ? (res.similarity * 100).toFixed(1) : '100.0') + '%';
    const isOk = res.status === t.expectedStatus;
    if (isOk) passed++;

    const chCol = t.title.padEnd(35).slice(0, 35);
    const quoteCol = `"${t.testedQuote.slice(0, 50)}..."`.padEnd(55);
    const simCol = simPct.padStart(10);
    const statCol = (res.status || 'VALIDE').padEnd(10);
    const icon = isOk ? "✅" : "❌";

    console.log(`${t.id.toString().padStart(2)} | ${chCol} | ${quoteCol} | ${simCol} | ${statCol} | ${icon}`);
  }

  console.log("-------------------------------------------------------------------------------------------------------------------------------------------------------------------------");
  console.log(`\nBILAN DES 5 TESTS SUR PARAGRAPHES RÉELS DE L'EXPOSÉ : ${passed}/5 réussis (${(passed/5)*100}%) ✅\n`);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
