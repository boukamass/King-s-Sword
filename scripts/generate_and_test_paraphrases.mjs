import fs from 'fs';
import path from 'path';

const lib = JSON.parse(fs.readFileSync('public/library.json', 'utf8'));
const exp = JSON.parse(fs.readFileSync('public/precalculated_index.json', 'utf8'));

function normalize(text) {
  return (text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function tokenize(text) {
  const separated = text.replace(/([ldqujcsnmtLDQUJCSNMT])['`’]([\p{L}\p{N}]+)/gu, '$1 $2');
  return normalize(separated)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2);
}

function extractFrenchStem(word) {
  if (!word || word.length <= 3) return word;
  const s = word.toLowerCase();
  const suffixes = [
    'issantes', 'issants', 'issante', 'issant', 'issaient',
    'ement', 'emment', 'amment', 'ations', 'ation',
    'atrices', 'atrice', 'ateurs', 'ateur',
    'euses', 'euse', 'eurs', 'eur',
    'erait', 'irait', 'aient', 'irent', 'arent', 'eriez', 'iriez',
    'entes', 'ente', 'ents', 'ent', 'antes', 'ante', 'ants', 'ant',
    'issez', 'issons', 'ait', 'iez', 'ions', 'ons', 'ont',
    'eras', 'erez', 'eront', 'iras', 'irez', 'iront',
    'ees', 'ee', 'es', 'er', 'ir', 'is', 'it', 'e', 's'
  ];
  for (const suf of suffixes) {
    if (s.endsWith(suf) && (s.length - suf.length) >= 3) {
      return s.slice(0, s.length - suf.length);
    }
  }
  return s;
}

const STOP_WORDS = new Set([
  'le', 'la', 'les', 'de', 'du', 'des', 'un', 'une', 'en', 'dans', 'par', 'pour', 'sur', 'avec', 'sans', 'sous',
  'et', 'ou', 'ni', 'car', 'mais', 'donc', 'or', 'que', 'qui', 'quoi', 'dont', 'ce', 'cet', 'cette', 'ces',
  'est', 'sont', 'ete', 'etre', 'suis', 'es', 'sommes', 'etes', 'ont', 'ai', 'as', 'avons', 'avez', 'avait', 'avaient', 'avoir',
  'fait', 'font', 'faire', 'fais', 'il', 'elle', 'ils', 'elles', 'on', 'je', 'tu', 'se', 'sa', 'son', 'ses', 'leur', 'leurs',
  'au', 'aux', 'mon', 'ton', 'ma', 'ta', 'mes', 'tes', 'notre', 'votre', 'nos', 'vos',
  'quel', 'quelle', 'quels', 'quelles', 'comme', 'plus', 'moins', 'tres', 'bien', 'aussi', 'alors', 'si', 'ne', 'pas', 'point', 'non', 'oui',
  'pourquoi', 'comment', 'selon', 'quand', 'lorsque', 'a', 'y', 'd'
]);

function getContentWords(text) {
  return new Set(tokenize(text).filter(w => !STOP_WORDS.has(w) && w.length >= 3));
}

function getParagraphText(sermonId, pNum) {
  if (sermonId.startsWith('expose_ch')) {
    const chNum = sermonId.replace('expose_ch', '');
    const chunk = exp.chunks.find(c => String(c.chapterNumber) === chNum && c.startParagraph === pNum);
    return chunk ? chunk.text : '';
  }
  const s = lib.find(x => x.id === sermonId);
  if (!s) return '';
  const paras = s.text.split(/\n\s*\n/).filter(p => p.trim());
  const matchP = paras.find(p => {
    const m = p.trim().match(/^(\d+)[\.\s]/);
    const n = m ? parseInt(m[1], 10) : null;
    return n === pNum;
  });
  return matchP ? matchP.trim() : (paras[pNum - 1] || '');
}

// 20 candidate paraphrases strictly designed to have ZERO shared content words (and zero shared stems)
const candidates = [
  // 1. Target: 63-0324M §1 (Clarifier les incompréhensions des assemblées vespérales)
  {
    target: { sermonId: "63-0324M", paragraphIndex: 1 },
    question: "Quelle utilité attribue-t-on aux interrogations matinales pour dissiper toute confusion vespérale ?"
  },
  // 2. Target: 63-0324M §2 (Arc sans flèches du faux cavalier monté)
  {
    target: { sermonId: "63-0324M", paragraphIndex: 2 },
    question: "De quel projectile l'usurpateur équestre immaculé se trouvait-il totalement dépourvu ?"
  },
  // 3. Target: 63-0324M §3 (Babel / sortie de Babylone vers l'astre vespéral)
  {
    target: { sermonId: "63-0324M", paragraphIndex: 3 },
    question: "Vers quel éclat vespéral le Créateur extrait-Il Ses rachetés de l'anarchie mésopotamienne ?"
  },
  // 4. Target: 63-0324M §4 (Ne pas se fier aux édifices somptueux ou à l'éloquence)
  {
    target: { sermonId: "63-0324M", paragraphIndex: 4 },
    question: "Face aux bâtisses fastueuses et à la rhétorique profane, à quel singulier texte scripturaire convient-il d'adhérer ?"
  },
  // 5. Target: 65-1212 §1 (Communion = pas juste pâte azyme et jus de raisin)
  {
    target: { sermonId: "65-1212", paragraphIndex: 1 },
    question: "Pourquoi la Cène outrepasse-t-elle l'ingestion d'une galette azyme additionnée de liqueur de vigne ?"
  },
  // 6. Target: 65-1212 §2 (Crucifié avec le Messie, résurrection)
  {
    target: { sermonId: "65-1212", paragraphIndex: 2 },
    question: "Quel accord absolu au supplice du Golgotha atteste qu'un disciple trépasse afin qu'un Autre surgisse en lui ?"
  },
  // 7. Target: 65-1212 §3 (Nourriture secrète sous le voile sacerdotal)
  {
    target: { sermonId: "65-1212", paragraphIndex: 3 },
    question: "Quelle subsistance dissimulée résidait jadis derrière l'épais rideau sanctuaire ?"
  },
  // 8. Target: 64-0719M §2 (Les clairons sonnent pour les Hébreux après l'enlèvement)
  {
    target: { sermonId: "64-0719M", paragraphIndex: 2 },
    question: "Quel instrument d'airain annonce le ralliement de la descendance d'Abraham sitôt l'élue ravie ?"
  },
  // 9. Target: 64-0719M §3 (Bannière hébraïque et arbre fruitier national)
  {
    target: { sermonId: "64-0719M", paragraphIndex: 3 },
    question: "Quel emblème à six pointes ondoie sur Sion tandis que l'arbuste nourricier bourgeonne ?"
  },
  // 10. Target: 64-0719M §4 (Prière constante avant l'extase céleste)
  {
    target: { sermonId: "64-0719M", paragraphIndex: 4 },
    question: "Quelle supplication ininterrompue importe avant le rapt céleste imminent ?"
  },
  // 11. Target: 65-0725M §1 (Avertissement solennel)
  {
    target: { sermonId: "65-0725M", paragraphIndex: 1 },
    question: "Quelle gravité suprême caractérise cette ultime admonestation destinée aux fidèles contemporains ?"
  },
  // 12. Target: 65-0725M §2 (Pluie divine sur le végétal vénéneux et céréale)
  {
    target: { sermonId: "65-0725M", paragraphIndex: 2 },
    question: "Pourquoi l'averse céleste humecte-t-elle pareillement l'épi nourricier et la mauvaise herbe toxique ?"
  },
  // 13. Target: 65-0725M §3 (Éblouissement par les prodiges et fidélité au canon intégral)
  {
    target: { sermonId: "65-0725M", paragraphIndex: 3 },
    question: "À quelle aune jauge-t-on l'authenticité surnaturelle lorsqu'un fait extraordinaire risque d'illusionner ?"
  },
  // 14. Target: 65-0725M §4 (Onction oculaire médicale pour la clairvoyance)
  {
    target: { sermonId: "65-0725M", paragraphIndex: 4 },
    question: "Quel onguent ophtalmique mystique procure une perception accrue des mystères ?"
  },
  // 15. Target: expose_ch1 §1 (Vision inaugurale de Patmos)
  {
    target: { sermonId: "expose_ch1", paragraphIndex: 1 },
    question: "Sur quel récif maritime aride le disciple bien-aimé contempla-t-il l'ouverture des horizons futurs ?"
  },
  // 16. Target: expose_ch2 §1 (Éphèse et premier chandelier)
  {
    target: { sermonId: "expose_ch2", paragraphIndex: 1 },
    question: "Quel port antique d'Ionie accueillit l'émissaire paulinien inaugurant le cycle chronologique septénaire ?"
  },
  // 17. Target: expose_ch3 §1 (Smyrne et la persécution sanglante)
  {
    target: { sermonId: "expose_ch3", paragraphIndex: 1 },
    question: "Quelle cité martyre subit la fureur des geôles romaines sous l'arôme amer de la résine broyée ?"
  },
  // 18. Target: expose_ch4 §1 (Pergame et compromis impérial)
  {
    target: { sermonId: "expose_ch4", paragraphIndex: 1 },
    question: "Où se dressait le trône satanique lorsque la piété capitula devant la pourpre césarienne ?"
  },
  // 19. Target: expose_ch5 §1 (Thyatire et la papauté médiévale)
  {
    target: { sermonId: "expose_ch5", paragraphIndex: 1 },
    question: "Sous quel règne clérical ténébreux la reine usurpatrice tyrannisa-t-elle les humbles justes ?"
  },
  // 20. Target: expose_ch6 §1 (Sardes et le souffle réformateur)
  {
    target: { sermonId: "expose_ch6", paragraphIndex: 1 },
    question: "Quel éveil doctrinologique secoua la torpeur germanique lorsque le moine afficha ses thèses contestataires ?"
  }
];

console.log("Checking zero-word overlap for all 20 candidates...");
let allPass = true;
candidates.forEach((cand, idx) => {
  const pText = getParagraphText(cand.target.sermonId, cand.target.paragraphIndex);
  if (!pText) {
    console.error(`Target not found for candidate ${idx + 1}:`, cand.target);
    allPass = false;
    return;
  }
  const qWords = getContentWords(cand.question);
  const pWords = getContentWords(pText);

  // Check word overlap
  const overlap = [];
  for (const w of qWords) {
    if (pWords.has(w)) overlap.push(w);
    // Also check stems
    const wStem = extractFrenchStem(w);
    for (const pw of pWords) {
      if (extractFrenchStem(pw) === wStem && wStem.length >= 3) {
        overlap.push(`${w}~${pw}`);
      }
    }
  }

  if (overlap.length > 0) {
    console.error(`Overlap in candidate ${idx + 1} (${cand.target.sermonId} §${cand.target.paragraphIndex}):`, overlap);
    allPass = false;
  } else {
    console.log(`Candidate ${idx + 1} OK: 0 common words with source paragraph!`);
  }
});

if (allPass) {
  console.log("SUCCESS! All 20 paraphrases have ZERO content words or stems in common with their target paragraphs!");
}
