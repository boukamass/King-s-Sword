import { loadExposeAsCanonicalDocuments } from '../services/exposeDocumentService';
import { validateSingleCitation } from '../services/citationValidationService';
import { RetrievalEvidencePackage } from '../types';

async function main() {
  console.log("=========================================================================================================");
  console.log("  5 TESTS SUR PARAGRAPHES DU MILIEU DE CHAPITRES AVEC ERREURS RÉALISTES (ÉIAPE 9)");
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

  // Paragraphes du MILIEU de chapitre (index >= 12)
  const p1 = doc1.paragraphs.find(p => p.paragraphIndex >= 15 && p.text.split(' ').length > 25) || doc1.paragraphs[10];
  const p2 = doc2.paragraphs.find(p => p.paragraphIndex >= 18 && p.text.split(' ').length > 25) || doc2.paragraphs[10];
  const p3 = doc3.paragraphs.find(p => p.paragraphIndex >= 12 && p.text.split(' ').length > 25) || doc3.paragraphs[10];
  const p4 = doc4.paragraphs.find(p => p.paragraphIndex >= 20 && p.text.split(' ').length > 20) || doc4.paragraphs[10];
  const p5_1 = doc5.paragraphs.find(p => p.paragraphIndex >= 15 && p.text.length > 50) || doc5.paragraphs[10];
  const p5_2 = doc5.paragraphs.find(p => p.paragraphIndex === p5_1.paragraphIndex + 1) || doc5.paragraphs[11];

  // 1. Test 1 (Ch.1 §16 - 1 word changed in a complete 27-word sentence -> CORRIGEE)
  const p1Sent = p1.text.split(/(?<=[.!?])\s+/)[0] || p1.text;
  const p1Words = p1Sent.split(/\s+/);
  const quote1Words = [...p1Words];
  quote1Words[4] = "pareils"; // Remplacement d'un mot unique ("semblables" -> "pareils") sur phrase de 27 mots (sim >= 0.95)
  const quote1 = quote1Words.join(' ');

  // 2. Test 2 (Ch.2 §18 - Négation "ne...pas" insérée -> REJETEE)
  const p2Words = p2.text.split(/\s+/);
  const quote2Words = [...p2Words];
  quote2Words.splice(2, 0, "ne");
  quote2Words.splice(4, 0, "pas");
  const quote2 = quote2Words.join(' ');

  // 3. Test 3 (Ch.3 §12 - Ellipses ... -> VALIDE)
  const p3Words = p3.text.split(/\s+/);
  const quote3 = p3Words.slice(0, 6).join(' ') + ' ... ' + p3Words.slice(-6).join(' ');

  // 4. Test 4 (Ch.4 §20 - 3 mots modifiés dans phrase courte de 12 mots -> REJETEE)
  const p4ShortWords = p4.text.split(/\s+/).slice(0, 12);
  p4ShortWords[2] = "certains";
  p4ShortWords[5] = "plusieurs";
  p4ShortWords[8] = "divers";
  const quote4 = p4ShortWords.join(' ');

  // 5. Test 5 (Ch.5 §15-16 - Phrases collées à cheval sur 2 paragraphes consécutifs -> VALIDE)
  const quote5 = `${p5_1.text.slice(-50)} ${p5_2.text.slice(0, 50)}`;

  const evidencePackage: RetrievalEvidencePackage = {
    answerable: true,
    vectorMethod: 'HYBRID_RRF',
    evidence: [
      {
        sermonId: doc1.documentId,
        sermonTitle: doc1.title,
        date: '1965',
        chunkId: `${doc1.documentId}_c1`,
        paragraphIds: [p1.paragraphIndex],
        startParagraph: p1.paragraphIndex,
        endParagraph: p1.paragraphIndex,
        text: p1.text,
        retrievalScore: 1.0,
        rank: 1,
        sourceType: 'full_text',
        citationParagraphs: [
          { paragraphIndex: p1.paragraphIndex, textSnippet: p1.text, fullParagraphText: p1.text, formattedCitation: '', isAuthentic: true }
        ]
      },
      {
        sermonId: doc2.documentId,
        sermonTitle: doc2.title,
        date: '1965',
        chunkId: `${doc2.documentId}_c1`,
        paragraphIds: [p2.paragraphIndex],
        startParagraph: p2.paragraphIndex,
        endParagraph: p2.paragraphIndex,
        text: p2.text,
        retrievalScore: 1.0,
        rank: 2,
        sourceType: 'full_text',
        citationParagraphs: [
          { paragraphIndex: p2.paragraphIndex, textSnippet: p2.text, fullParagraphText: p2.text, formattedCitation: '', isAuthentic: true }
        ]
      },
      {
        sermonId: doc3.documentId,
        sermonTitle: doc3.title,
        date: '1965',
        chunkId: `${doc3.documentId}_c1`,
        paragraphIds: [p3.paragraphIndex],
        startParagraph: p3.paragraphIndex,
        endParagraph: p3.paragraphIndex,
        text: p3.text,
        retrievalScore: 1.0,
        rank: 3,
        sourceType: 'full_text',
        citationParagraphs: [
          { paragraphIndex: p3.paragraphIndex, textSnippet: p3.text, fullParagraphText: p3.text, formattedCitation: '', isAuthentic: true }
        ]
      },
      {
        sermonId: doc4.documentId,
        sermonTitle: doc4.title,
        date: '1965',
        chunkId: `${doc4.documentId}_c1`,
        paragraphIds: [p4.paragraphIndex],
        startParagraph: p4.paragraphIndex,
        endParagraph: p4.paragraphIndex,
        text: p4.text,
        retrievalScore: 1.0,
        rank: 4,
        sourceType: 'full_text',
        citationParagraphs: [
          { paragraphIndex: p4.paragraphIndex, textSnippet: p4.text, fullParagraphText: p4.text, formattedCitation: '', isAuthentic: true }
        ]
      },
      {
        sermonId: doc5.documentId,
        sermonTitle: doc5.title,
        date: '1965',
        chunkId: `${doc5.documentId}_c1`,
        paragraphIds: [p5_1.paragraphIndex, p5_2.paragraphIndex],
        startParagraph: p5_1.paragraphIndex,
        endParagraph: p5_2.paragraphIndex,
        text: `${p5_1.text} ${p5_2.text}`,
        retrievalScore: 1.0,
        rank: 5,
        sourceType: 'full_text',
        citationParagraphs: [
          { paragraphIndex: p5_1.paragraphIndex, textSnippet: p5_1.text, fullParagraphText: p5_1.text, formattedCitation: '', isAuthentic: true },
          { paragraphIndex: p5_2.paragraphIndex, textSnippet: p5_2.text, fullParagraphText: p5_2.text, formattedCitation: '', isAuthentic: true }
        ]
      }
    ]
  };

  const middleTests = [
    {
      id: 1,
      ch: "Ch. 1 (§" + p1.paragraphIndex + ")",
      errorType: "1 mot modifié dans phrase de 30 mots",
      quote: quote1,
      docId: doc1.documentId,
      paraIndex: p1.paragraphIndex,
      expected: "CORRIGEE"
    },
    {
      id: 2,
      ch: "Ch. 2 (§" + p2.paragraphIndex + ")",
      errorType: "Négation 'ne...pas' insérée",
      quote: quote2,
      docId: doc2.documentId,
      paraIndex: p2.paragraphIndex,
      expected: "REJETEE"
    },
    {
      id: 3,
      ch: "Ch. 3 (§" + p3.paragraphIndex + ")",
      errorType: "Phrase raccourcie par ellipses (...)",
      quote: quote3,
      docId: doc3.documentId,
      paraIndex: p3.paragraphIndex,
      expected: "VALIDE"
    },
    {
      id: 4,
      ch: "Ch. 4 (§" + p4.paragraphIndex + ")",
      errorType: "3 mots modifiés sur phrase de 12 mots",
      quote: quote4,
      docId: doc4.documentId,
      paraIndex: p4.paragraphIndex,
      expected: "REJETEE"
    },
    {
      id: 5,
      ch: "Ch. 5 (§" + p5_1.paragraphIndex + "-" + p5_2.paragraphIndex + ")",
      errorType: "Phrases collées à cheval sur 2 paragraphes",
      quote: quote5,
      docId: doc5.documentId,
      paraIndex: p5_1.paragraphIndex,
      expected: "VALIDE"
    }
  ];

  console.log("-------------------------------------------------------------------------------------------------------------------------------------------------------------------------");
  console.log("N° | MILIEU DE CHAPITRE  | TYPE D'ERREUR RÉALISTE INTRODUITE            | SIMILARITÉ | STATUT OBTENU | DÉCISION / RAISON");
  console.log("-------------------------------------------------------------------------------------------------------------------------------------------------------------------------");

  let passed = 0;
  for (const t of middleTests) {
    const res = validateSingleCitation(t.quote, t.docId, t.paraIndex, evidencePackage);
    const simPct = (res.similarity !== undefined ? (res.similarity * 100).toFixed(1) : '100.0') + '%';
    const isSuccess = res.status === t.expected;
    if (isSuccess) passed++;

    const chCol = t.ch.padEnd(20).slice(0, 20);
    const errCol = t.errorType.padEnd(42).slice(0, 42);
    const simCol = simPct.padStart(10);
    const statCol = (res.status || 'VALIDE').padEnd(13);
    const icon = isSuccess ? "✅" : "❌";

    console.log(`${t.id.toString().padStart(2)} | ${chCol} | ${errCol} | ${simCol} | ${statCol} | ${icon} ${res.reason.slice(0, 50)}`);
  }

  console.log("-------------------------------------------------------------------------------------------------------------------------------------------------------------------------");
  console.log(`\nBILAN DES 5 TESTS DE MILIEU DE CHAPITRES AVEC ERREURS RÉALISTES : ${passed}/5 réussis (${(passed/5)*100}%) ✅\n`);

  if (passed < 5) {
    console.error("❌ Échec sur au moins une décision.");
    process.exit(1);
  }
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
