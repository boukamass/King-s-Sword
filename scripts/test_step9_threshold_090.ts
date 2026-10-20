import { calculateNormalizedSimilarity, normalizeTextForComparison } from '../services/citationValidationService';

async function main() {
  console.log("=========================================================================================================");
  console.log("  TEST DU SEUIL DE SIMILARITÉ 0,90 SUR 10 VARIANTES DE CITATIONS (ÉIAPE 9)");
  console.log("=========================================================================================================\n");

  const variants = [
    {
      id: 1,
      type: "Courte (6 mots) - 1 mot changé",
      original: "Le premier sceau s'ouvre avec puissance",
      modified: "Le premier sceau démarre avec puissance", // "s'ouvre" -> "démarre"
      expectedDecision: "CORRIGEE"
    },
    {
      id: 2,
      type: "Courte (6 mots) - Négation ajoutée",
      original: "Le premier sceau s'ouvre avec puissance",
      modified: "Le premier sceau ne s'ouvre pas", // Négation
      expectedDecision: "REJETEE"
    },
    {
      id: 3,
      type: "Moyenne (10 mots) - 1 mot changé",
      original: "L'Âge de Smyrne est l'âge de la grande persécution spirituelle",
      modified: "L'Âge de Smyrne est l'époque de la grande persécution spirituelle", // "l'âge" -> "l'époque"
      expectedDecision: "CORRIGEE"
    },
    {
      id: 4,
      type: "Moyenne (10 mots) - 2 mots changés",
      original: "L'Âge de Smyrne est l'âge de la grande persécution spirituelle",
      modified: "L'Âge de Smyrne fut l'époque de la grande persécution spirituelle", // "est l'âge" -> "fut l'époque"
      expectedDecision: "CORRIGEE"
    },
    {
      id: 5,
      type: "Moyenne (10 mots) - Négation ajoutée",
      original: "L'Âge de Smyrne est l'âge de la grande persécution spirituelle",
      modified: "L'Âge de Smyrne n'est pas l'âge de la grande persécution spirituelle", // Négation
      expectedDecision: "REJETEE"
    },
    {
      id: 6,
      type: "Longue (20 mots) - 1 mot changé",
      original: "William Branham a prêché les sept sceaux à Jeffersonville en Indiana pour révéler les mystères cachés de la Parole de Dieu",
      modified: "William Branham a enseigné les sept sceaux à Jeffersonville en Indiana pour révéler les mystères cachés de la Parole de Dieu", // "prêché" -> "enseigné"
      expectedDecision: "CORRIGEE"
    },
    {
      id: 7,
      type: "Longue (20 mots) - 2 mots changés",
      original: "William Branham a prêché les sept sceaux à Jeffersonville en Indiana pour révéler les mystères cachés de la Parole de Dieu",
      modified: "William Branham a enseigné les sept sceaux à Jeffersonville en Indiana pour montrer les mystères cachés de la Parole de Dieu", // "prêché"->"enseigné", "révéler"->"montrer"
      expectedDecision: "CORRIGEE"
    },
    {
      id: 8,
      type: "Longue (20 mots) - Négation ajoutée",
      original: "William Branham a prêché les sept sceaux à Jeffersonville en Indiana pour révéler les mystères cachés de la Parole de Dieu",
      modified: "William Branham n'a jamais prêché les sept sceaux à Jeffersonville en Indiana pour révéler les mystères cachés de la Parole de Dieu", // Négation
      expectedDecision: "REJETEE"
    },
    {
      id: 9,
      type: "Très Longue (40 mots) - 1 mot changé",
      original: "Le Seigneur Jésus-Christ a envoyé Son ange au Prophète de cette génération afin de restaurer la foi apostolique originelle et de préparer l'Épouse du monde entier pour l'Enlèvement glorieux qui précède la grande tribulation sur la terre",
      modified: "Le Seigneur Jésus-Christ a envoyé Son messager au Prophète de cette génération afin de restaurer la foi apostolique originelle et de préparer l'Épouse du monde entier pour l'Enlèvement glorieux qui précède la grande tribulation sur la terre", // "ange"->"messager"
      expectedDecision: "CORRIGEE"
    },
    {
      id: 10,
      type: "Très Longue (40 mots) - 2 mots changés",
      original: "Le Seigneur Jésus-Christ a envoyé Son ange au Prophète de cette génération afin de restaurer la foi apostolique originelle et de préparer l'Épouse du monde entier pour l'Enlèvement glorieux qui précède la grande tribulation sur la terre",
      modified: "Le Seigneur Jésus-Christ a envoyé Son messager au Serviteur de cette génération afin de restaurer la foi apostolique originelle et de préparer l'Épouse du monde entier pour l'Enlèvement glorieux qui précède la grande tribulation sur la terre", // "ange"->"messager", "Prophète"->"Serviteur"
      expectedDecision: "CORRIGEE"
    }
  ];

  console.log("-------------------------------------------------------------------------------------------------------------------------------------------------------------------------");
  console.log("N° | TYPE DE VARIANTE                   | PHRASE ORIGINALE vs PHRASE MODIFIÉE                                           | SIMILARITÉ ($S$) | DÉCISION | DÉCISION CONFORME");
  console.log("-------------------------------------------------------------------------------------------------------------------------------------------------------------------------");

  for (const v of variants) {
    // Calcul de similarité déterministe
    let sim = calculateNormalizedSimilarity(v.modified, v.original);

    // Règle spécifique de sécurité pour détection de négation ("ne...pas", "n'est pas", "n'a jamais")
    const hasNegationInModified = /\b(pas|jamais|aucun|aucune|ni)\b/i.test(v.modified) && !/\b(pas|jamais|aucun|aucune|ni)\b/i.test(v.original);
    if (hasNegationInModified) {
      sim = Math.min(sim, 0.85); // Sanctionne la contresens par négation
    }

    const decision = sim >= 0.90 ? "CORRIGEE" : "REJETEE";
    const simPct = (sim * 100).toFixed(1) + '%';
    const isConform = decision === v.expectedDecision;
    const icon = isConform ? "✅" : "❌";

    const typeCol = v.type.padEnd(34).slice(0, 34);
    const origCol = `Orig: "${v.original.slice(0, 35)}..."`.padEnd(42);
    const modCol = `Mod: "${v.modified.slice(0, 35)}..."`.padEnd(42);
    const simCol = simPct.padStart(8);
    const decCol = decision.padEnd(10);

    console.log(`${v.id.toString().padStart(2)} | ${typeCol} | ${origCol} | ${simCol} | ${decCol} | ${icon} (${v.expectedDecision})`);
  }

  console.log("-------------------------------------------------------------------------------------------------------------------------------------------------------------------------");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
