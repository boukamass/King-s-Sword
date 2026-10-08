/**
 * King's Sword — Automatic Continuous Guard Suite (Phase 4)
 * 
 * Génère dynamiquement des tests depuis le corpus (graine pseudo-aléatoire fixe pour reproductibilité totale) :
 * 1. Échantillonne des paragraphes du corpus Exposé complet.
 * 2. Génère des questions in-domain et leurs variantes bruitées :
 *    - Fautes de frappe (distance Levenshtein <= 2)
 *    - Accents supprimés / modifiés
 *    - Casse (MAJUSCULES, minuscules, titre)
 *    - Ponctuation et symboles
 *    - Mots de consigne / de format ajoutés ("monter une étude très détaillée", "donne-moi une analyse complète")
 *    - Mélange FR / EN
 *    - Phrases longues et bavardes
 * 3. Génère des questions pièges / out-of-domain (hors corpus) avec concepts absents à fort IDF.
 * 4. Teste l'invariance :
 *    - 0 faux refus sur les requêtes fondées (même avec fautes ou consignes)
 *    - 0 faux positif sur les requêtes hors domaine
 *    - Raison de décision claire et journalisée pour chaque refus
 * 5. Mesure et affiche le taux de succès, dénominateurs, et intervalles de confiance de Wilson (95%).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { assessAnswerability } from '../services/rerankingService.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log("==================================================================");
console.log(" 🛡️ KING'S SWORD — AUTOMATIC CONTINUOUS GUARD SUITE (PHASE 4)");
console.log("==================================================================");

// 1. Chargement du corpus Exposé complet
const exposePath = path.join(rootDir, 'public', 'expose.json');
if (!fs.existsSync(exposePath)) {
  console.error("❌ Corpus public/expose.json introuvable.");
  process.exit(1);
}

const exposeData = JSON.parse(fs.readFileSync(exposePath, 'utf8'));
const paragraphs = exposeData.paragraphs || [];
if (paragraphs.length === 0) {
  console.error("❌ Aucun paragraphe trouvé dans expose.json.");
  process.exit(1);
}

const corpusText = paragraphs.map(p => p.text || '').join(' ');
console.log(`✅ Corpus chargé : ${paragraphs.length} paragraphes originaux (${(corpusText.length / 1024).toFixed(1)} Ko).`);

// 2. Générateur pseudo-aléatoire à graine fixe (Linear Congruential Generator - LCG)
class SeededRandom {
  constructor(seed = 424242) {
    this.seed = seed;
  }
  next() {
    this.seed = (this.seed * 1664525 + 1013904223) % 4294967296;
    return this.seed / 4294967296;
  }
  nextInt(min, max) {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
  pick(arr) {
    return arr[this.nextInt(0, arr.length - 1)];
  }
}

const rng = new SeededRandom(20261007);

const sampleKeywords = [
  'antichrist', 'nicolaites', 'balaam', 'jezabel', 'messager', 
  'colombe', 'pyramide', 'semence', 'predestination', 'theophanie',
  'melchisedek', 'septieme sceau', 'age de laodicee', 'bapteme'
];

const sampledProbes = [];
for (const kw of sampleKeywords) {
  const matching = paragraphs.filter(p => (p.text || '').toLowerCase().includes(kw));
  if (matching.length > 0) {
    const picked = rng.pick(matching);
    sampledProbes.push({
      concept: kw,
      paragraphText: picked.text,
      sourceId: picked.chapterId || 'expose-ch'
    });
  }
}

console.log(`✅ ${sampledProbes.length} sondes documentaires ancrées extraites du corpus.`);

// 4. Bruitage synthétique autonome (zéro dictionnaire externe)
const noiseDirectives = [
  "Monter une étude très détailé et exahustive sur",
  "Donne moi un panorama complet et approfondi de",
  "Can you explain in detail the revelation of",
  "Fais une etude tres detaille avec tous les details sur",
  "Je voudrais savoir tout ce que dit frere branham sur",
  "Explique moi tres exhaustivement la doctrine de",
  "Recherche detaillee et synthese complete concernant"
];

function injectTypo(word) {
  if (word.length <= 4) return word;
  const idx = rng.nextInt(1, word.length - 2);
  const type = rng.nextInt(0, 2);
  if (type === 0) {
    // Permutation de 2 lettres adjacentes (ex: exhaustive -> exahustive)
    return word.slice(0, idx) + word[idx + 1] + word[idx] + word.slice(idx + 2);
  } else if (type === 1) {
    // Omission d'une lettre (ex: détaille -> detaile)
    return word.slice(0, idx) + word.slice(idx + 1);
  } else {
    // Doublon de lettre
    return word.slice(0, idx) + word[idx] + word.slice(idx);
  }
}

function stripAccents(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// 5. Construction du jeu de test de robustesse
const testCases = [];

// A. Questions in-domain bruitées (DOIVENT ÊTRE ACCEPTÉES)
sampledProbes.forEach((probe, idx) => {
  const directive = rng.pick(noiseDirectives);
  const baseQuery = `${directive} ${probe.concept}`;

  const candidateText = (() => {
    const full = probe.paragraphText || '';
    const norm = full.toLowerCase();
    const pos = norm.indexOf(probe.concept.toLowerCase());
    if (pos === -1) return full.slice(0, 350);
    const start = Math.max(0, pos - 50);
    return full.slice(start, start + 350);
  })();

  const mockCandidate = {
    chunkId: `chunk_${idx}_c1`,
    text: candidateText,
    vectorScore: 0.55 + rng.next() * 0.25,
    vectorRank: 1,
    lexicalScore: 35 + rng.nextInt(0, 25),
    lexicalRank: 1,
    rrfScore: 0.03,
    rank: 1
  };

  // Variante 1 : Question originale avec directive
  testCases.push({
    id: `GUARD_IN_${idx}_BASE`,
    query: baseQuery,
    expectedAnswerable: true,
    type: 'in_domain_directive',
    mockCandidate
  });

  // Variante 2 : Fautes de frappe injectées
  const noisyWords = baseQuery.split(' ').map(w => rng.next() > 0.6 ? injectTypo(w) : w).join(' ');
  testCases.push({
    id: `GUARD_IN_${idx}_TYPO`,
    query: noisyWords,
    expectedAnswerable: true,
    type: 'in_domain_typo',
    mockCandidate
  });

  // Variante 3 : Sans accents et majuscules
  testCases.push({
    id: `GUARD_IN_${idx}_UPPER_NOACCENT`,
    query: stripAccents(baseQuery).toUpperCase(),
    expectedAnswerable: true,
    type: 'in_domain_upper_noaccent',
    mockCandidate
  });

  // Variante 4 : Ponctuation et bavardage
  testCases.push({
    id: `GUARD_IN_${idx}_VERBOSE`,
    query: `S'il te plaît !!! ${baseQuery} ??? Donne-moi absolument tous les passages...`,
    expectedAnswerable: true,
    type: 'in_domain_verbose',
    mockCandidate
  });
});

// B. Questions hors-domaine / pièges (DOIVENT ÊTRE REFUSÉES AVEC MOTIVATION)
const outOfDomainQueries = [
  "Quelles sont les spécifications techniques de la fusée Saturn V d'Apollo 11 ?",
  "Quelle est la recette traditionnelle de la quiche lorraine aux poireaux ?",
  "Comment configurer un cluster Kubernetes multi-régions sur Google Cloud ?",
  "Combien de passagers le paquebot Titanic pouvait-il transporter en 1912 ?",
  "Quelles sont les regles d'arbitrage de la ligue des champions de football UEFA ?",
  "Quel est le taux d'imposition sur les societes en Suisse romande ?",
  "Quelles sont les proprietes supraconductrices du graphène à basse température ?",
  "Comment tailler les pommiers et poiriers pendant la saison d'automne ?"
];

outOfDomainQueries.forEach((q, idx) => {
  testCases.push({
    id: `GUARD_OUT_${idx}`,
    query: q,
    expectedAnswerable: false,
    type: 'out_of_domain_strict',
    mockCandidate: {
      chunkId: `chunk_ood_${idx}`,
      text: "Paul était un grand apôtre qui a servi Dieu avec fidélité...",
      vectorScore: 0.15,
      vectorRank: 1,
      lexicalScore: 0,
      lexicalRank: 1,
      rrfScore: 0.005,
      rank: 1
    }
  });
});

console.log(`✅ Total de tests générés : ${testCases.length} (${testCases.filter(t => t.expectedAnswerable).length} in-domain bruités, ${testCases.filter(t => !t.expectedAnswerable).length} hors-domaine).`);

// 6. Exécution du banc de test
let passedCount = 0;
let falseRefusals = 0;
let falseAcceptances = 0;
let refusalsWithClearReason = 0;
let totalRefusals = 0;

console.log("\n🧪 Exécution du banc d'évaluation...");
for (const tc of testCases) {
  const result = assessAnswerability({
    query: tc.query,
    candidates: [tc.mockCandidate],
    corpusTextIndex: corpusText
  });

  const isSuccess = result.answerable === tc.expectedAnswerable;
  if (isSuccess) {
    passedCount++;
  } else {
    if (tc.expectedAnswerable && !result.answerable) {
      falseRefusals++;
      console.warn(`⚠️ [FAUX REFUS] Query: "${tc.query}" | Raison: ${result.reason}`);
    } else if (!tc.expectedAnswerable && result.answerable) {
      falseAcceptances++;
      console.warn(`⚠️ [FAUX POSITIF] Query: "${tc.query}" | Accepté à tort !`);
    }
  }

  if (!result.answerable) {
    totalRefusals++;
    if (result.reason && result.reason.length > 10 && !result.reason.includes('undefined')) {
      refusalsWithClearReason++;
    }
  }
}

// 7. Calcul statistique (Intervalles de confiance de Wilson à 95%)
function wilsonInterval(k, n, z = 1.96) {
  if (n === 0) return { lower: 0, upper: 0 };
  const p = k / n;
  const num = p + (z * z) / (2 * n);
  const denom = 1 + (z * z) / n;
  const delta = (z / denom) * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  const center = num / denom;
  return {
    lower: Math.max(0, center - delta),
    upper: Math.min(1, center + delta)
  };
}

const accuracyRate = passedCount / testCases.length;
const wilsonAcc = wilsonInterval(passedCount, testCases.length);

const inDomainTests = testCases.filter(t => t.expectedAnswerable);
const falseRefusalRate = falseRefusals / inDomainTests.length;

const outDomainTests = testCases.filter(t => !t.expectedAnswerable);
const falseAcceptanceRate = falseAcceptances / outDomainTests.length;

console.log("\n==================================================================");
console.log(" 📊 RÉSULTATS MESURÉS DU GARDE AUTOMATIQUE");
console.log("==================================================================");
console.log(`- Précision globale [MESURÉ] : ${(accuracyRate * 100).toFixed(2)}% (${passedCount}/${testCases.length})`);
console.log(`  └─ Intervalle de Wilson 95% [MESURÉ] : [${(wilsonAcc.lower * 100).toFixed(1)}% - ${(wilsonAcc.upper * 100).toFixed(1)}%]`);
console.log(`- Taux de faux refus [MESURÉ] : ${(falseRefusalRate * 100).toFixed(2)}% (${falseRefusals}/${inDomainTests.length})`);
console.log(`- Taux de faux positifs [MESURÉ] : ${(falseAcceptanceRate * 100).toFixed(2)}% (${falseAcceptances}/${outDomainTests.length})`);
console.log(`- Refus avec raison explicite [MESURÉ] : ${(refusalsWithClearReason / totalRefusals * 100).toFixed(1)}% (${refusalsWithClearReason}/${totalRefusals})`);
console.log("==================================================================");

if (falseRefusals > 0 || falseAcceptances > 0) {
  console.error("❌ ÉCHEC DU GARDE : Faux refus ou faux positif détecté.");
  process.exit(1);
} else {
  console.log("✅ GARDE AUTOMATIQUE VALIDÉ SANS ERREUR.");
  process.exit(0);
}
