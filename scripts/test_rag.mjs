// Test suite pour le moteur RAG hybride et la recherche documentaire de King's Sword
import fs from 'fs';
import path from 'path';

console.log("=================================================");
console.log(" DÉBUT DE LA SUITE DE TESTS RAG KING'S SWORD");
console.log("=================================================\n");

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    console.log(`  ✅ [PASS] ${message}`);
    passedTests++;
  } else {
    console.error(`  ❌ [FAIL] ${message}`);
  }
}

// 1. Chargement des données réelles
const libraryPath = path.resolve('./public/library.json');
const libraryData = JSON.parse(fs.readFileSync(libraryPath, 'utf8'));
assert(Array.isArray(libraryData) && libraryData.length >= 4, `Chargement de la bibliothèque (${libraryData.length} sermons trouvés)`);

// 2. Normalisation de texte (accents, casse)
function normalizeText(text) {
  return (text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

assert(normalizeText('Fête des Trompettes') === 'fete des trompettes', "Normalisation des accents ('Fête' -> 'fete')");
assert(normalizeText('Épouse de Christ') === 'epouse de christ', "Normalisation des majuscules et accents ('Épouse' -> 'epouse')");

// 3. Extraction des mots-clés et suppression des stop-words
const STOP_WORDS = new Set([
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'd', 'au', 'aux',
  'et', 'ou', 'mais', 'donc', 'or', 'ni', 'car', 'que', 'qui', 'quoi', 'dont', 'ou',
  'a', 'dans', 'en', 'par', 'pour', 'sur', 'sous', 'vers', 'avec', 'sans', 'chez',
  'ce', 'cet', 'cette', 'ces', 'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'son', 'sa', 'ses',
  'est', 'sont', 'ete', 'etre', 'fait', 'faire', 'dit', 'parle',
  'branham', 'william', 'frere', 'brother', 'message', 'sermon', 'sermons'
]);

function extractSearchKeywords(query) {
  const normalized = normalizeText(query);
  const words = normalized
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2);
  const filtered = words.filter(w => !STOP_WORDS.has(w));
  return Array.from(new Set(filtered));
}

const queryTest = "Que dit William Branham sur le cavalier au cheval blanc ?";
const extracted = extractSearchKeywords(queryTest);
assert(
  extracted.includes('cavalier') && extracted.includes('cheval') && extracted.includes('blanc'),
  `Extraction des mots-clés pertinents (résultat : [${extracted.join(', ')}])`
);
assert(!extracted.includes('william') && !extracted.includes('branham'), "Élimination des stop words ('william', 'branham')");

// 4. Découpage et indexation des paragraphes
const allIndexedParagraphs = [];
libraryData.forEach(s => {
  const paragraphs = (s.text || '').split(/\n\s*\n/);
  paragraphs.forEach((p, idx) => {
    const trimmed = p.trim();
    if (trimmed) {
      allIndexedParagraphs.push({
        sermonId: s.id,
        title: s.title,
        date: s.date,
        city: s.city,
        paragraphIndex: idx + 1,
        content: trimmed
      });
    }
  });
});

assert(allIndexedParagraphs.length >= 15, `Indexation de tous les paragraphes (${allIndexedParagraphs.length} paragraphes créés)`);

// 5. Test de recherche ciblée sur un terme précis
const cavalierResults = allIndexedParagraphs.filter(p => normalizeText(p.content).includes('cavalier'));
assert(cavalierResults.length > 0, `Recherche du terme 'cavalier' (${cavalierResults.length} occurrence trouvée)`);
assert(cavalierResults[0].sermonId === '63-0324M' && cavalierResults[0].paragraphIndex === 2, "Correspondance exacte sermon (63-0324M) et numéro de paragraphe (§2)");
assert(cavalierResults[0].content.includes("cheval blanc n'était pas le Seigneur Jésus-Christ"), "Vérification de l'intégrité du texte du paragraphe");

// 6. Test d'insensibilité aux accents dans le texte
const feteResults = allIndexedParagraphs.filter(p => normalizeText(p.content).includes('fete'));
assert(feteResults.length > 0, `Recherche insensible aux accents pour 'fete' / 'fête' (${feteResults.length} résultats)`);

// 7. Déduplication des résultats
const duplicatesSimulated = [...cavalierResults, ...cavalierResults];
const dedupeMap = new Map();
duplicatesSimulated.forEach(p => {
  const key = `${p.sermonId}#${p.paragraphIndex}`;
  if (!dedupeMap.has(key)) dedupeMap.set(key, p);
});
assert(dedupeMap.size === cavalierResults.length, `Élimination stricte des doublons (${dedupeMap.size} unique vs ${duplicatesSimulated.length} avec doublons)`);

// 8. Test de gestion d'une requête sans aucun résultat
const zeroResultsKeywords = extractSearchKeywords("astronautes martiens et soucoupes spatiales");
const zeroResults = allIndexedParagraphs.filter(p => {
  const norm = normalizeText(p.content);
  return zeroResultsKeywords.some(kw => norm.includes(kw));
});
assert(zeroResults.length === 0, "Gestion d'une requête sans résultat dans la bibliothèque (0 résultat retourné)");

// 9. Construction du contexte RAG pour Gemini
function formatRagContextForGemini(paragraphs, question) {
  if (!paragraphs || paragraphs.length === 0) return "AUCUNE SOURCE DISPONIBLE DANS LA BASE DOCUMENTAIRE.";
  const sourcesList = paragraphs.map((p, idx) => {
    return `[SOURCE ${idx + 1}]
Sermon : "${p.title}"
Date : ${p.date} | Lieu : ${p.city}
RÉFÉRENCE OBLIGATOIRE : [Réf: ${p.sermonId}, Para. ${p.paragraphIndex}]
TEXTE EXACT DU PARAGRAPHE ${p.paragraphIndex} :
"""
${p.content}
"""`;
  }).join('\n\n------------------------------------------------------------\n\n');

  return `EXTRAITS DES SERMONS RETROUVÉS DANS LA BIBLIOTHÈQUE POUR CETTE QUESTION :
============================================================
${sourcesList}
============================================================`;
}

const contextBuilt = formatRagContextForGemini(cavalierResults.slice(0, 2), "Qui est le cavalier sur le cheval blanc ?");
assert(contextBuilt.includes("[Réf: 63-0324M, Para. 2]"), "Présence de la référence structurée [Réf: 63-0324M, Para. 2] dans le contexte");
assert(contextBuilt.includes("EXTRAITS DES SERMONS RETROUVÉS DANS LA BIBLIOTHÈQUE"), "Entête de cadrage documentaire présent");

// 10. Test de validation du parsing des citations cliquables côté UI
const sampleAiAnswer = `Selon le message, le cavalier représente l'esprit séducteur :
> « Le premier sceau a été ouvert, et nous avons clairement vu que le cavalier sur le cheval blanc n'était pas le Seigneur Jésus-Christ... » [Réf: 63-0324M, Para. 2]
C'est le grand bluff religieux du temps de la fin.`;

const regexCitation = /\[Réf:\s*([a-zA-Z0-9_-]+)(?:,\s*Para\.?\s*(\d+))?\]/gi;
const matches = [];
let match;
while ((match = regexCitation.exec(sampleAiAnswer)) !== null) {
  matches.push({ full: match[0], sermonId: match[1], paraNum: parseInt(match[2], 10) });
}

assert(matches.length === 1, "Détection exacte de la citation dans le texte généré");
assert(matches[0].sermonId === '63-0324M' && matches[0].paraNum === 2, "Extraction fidèle du sermonId ('63-0324M') et du paragraphe (2) pour le saut dans le lecteur");

console.log("\n=================================================");
console.log(` RÉSULTATS : ${passedTests}/${totalTests} TESTS PASSÉS AVEC SUCCÈS`);
console.log("=================================================");
