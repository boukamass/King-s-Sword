import { validateSingleCitation, checkNegationMismatch, calculateNormalizedSimilarity } from '../services/citationValidationService';
import { RetrievalEvidencePackage } from '../types';

async function main() {
  console.log("=========================================================================================================");
  console.log("  TEST DE LA RÈGLE DURE DE NÉGATION SUR UNE PHRASE DE 40 MOTS (ÉIAPE 9)");
  console.log("=========================================================================================================\n");

  const source40Words = "Le Seigneur Jésus-Christ a envoyé Son ange au Prophète de cette génération afin de restaurer la foi apostolique originelle et de préparer l'Épouse du monde entier pour l'Enlèvement glorieux qui précède la grande tribulation sur la terre";
  const quoteWithNegation40Words = "Le Seigneur Jésus-Christ n'a pas envoyé Son ange au Prophète de cette génération afin de restaurer la foi apostolique originelle et de préparer l'Épouse du monde entier pour l'Enlèvement glorieux qui précède la grande tribulation sur la terre";

  const evidencePackage: RetrievalEvidencePackage = {
    answerable: true,
    vectorMethod: 'HYBRID_RRF',
    evidence: [
      {
        sermonId: '63-0324M',
        sermonTitle: 'Le Premier Sceau',
        date: '1963-03-24',
        chunkId: '63-0324M_c1',
        paragraphIds: [1],
        startParagraph: 1,
        endParagraph: 1,
        text: source40Words,
        retrievalScore: 1.0,
        rank: 1,
        sourceType: 'full_text',
        citationParagraphs: [
          {
            paragraphIndex: 1,
            textSnippet: source40Words,
            fullParagraphText: source40Words,
            formattedCitation: `> « ${source40Words} » [Réf: 63-0324M, §1]`,
            isAuthentic: true
          }
        ]
      }
    ]
  };

  const simBrute = calculateNormalizedSimilarity(quoteWithNegation40Words, source40Words);
  const hasNegMismatch = checkNegationMismatch(quoteWithNegation40Words, source40Words);
  const res = validateSingleCitation(quoteWithNegation40Words, '63-0324M', 1, evidencePackage);

  console.log(`- Nombre de mots de la source    : ${source40Words.split(' ').length} mots`);
  console.log(`- Nombre de mots de la citation  : ${quoteWithNegation40Words.split(' ').length} mots`);
  console.log(`- Contradiction de négation      : ${hasNegMismatch ? 'DÉTECTÉE (true) ✅' : 'Non détectée (false)'}`);
  console.log(`- Similarité brute calculée      : ${(simBrute * 100).toFixed(1)}% (sans règle dure, cela aurait été accepté > 95%)`);
  console.log(`- Statut du validateur           : ${res.status} (Attendu: REJETEE)`);
  console.log(`- Raison du rejet                : ${res.reason}`);

  if (res.status === 'REJETEE' && hasNegMismatch) {
    console.log("\n✅ RÈGLE DURE DE NÉGATION VALIDÉE SUR PHRASE DE 40 MOTS : REJET SYSTÉMATIQUE CONFIRMÉ !");
  } else {
    console.error("\n❌ ÉCHEC DU TEST DE RÈGLE DURE.");
    process.exit(1);
  }
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
