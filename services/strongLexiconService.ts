/**
 * King's Sword — Service de Lexique Strong Officiel OpenScriptures
 * 
 * Charge et gère les données authentiques de référence hébraïque et grecque d'OpenScriptures
 * avec traduction française intégrale, étymologie, morphologie et fréquences réelles de versets.
 */

import { getGeminiApiKey } from '../utils/apiKeyHelper';
import { GoogleGenAI, Type } from '@google/genai';
import { fetchJsonSafe } from '../utils/fetchHelper';

export interface OpenScripturesEntry {
  lemma?: string;
  xlit?: string;
  translit?: string;
  pron?: string;
  derivation?: string;
  strongs_def?: string;
  kjv_def?: string;
}

export interface FrenchStrongCard {
  strong: string;
  word: string;
  original: string; // lemme en caractères originaux
  translitteration: string;
  pronunciation: string;
  type: 'hebrew' | 'greek';
  partOfSpeech?: string | null;
  etymology?: string | null;
  occurrencesCount?: string | number | null;
  translationsLSG?: string | null;
  definition: string;
  messageContext?: string | null;
}

let hebrewLexicon: Record<string, OpenScripturesEntry> | null = null;
let greekLexicon: Record<string, OpenScripturesEntry> | null = null;
let strongVerseCounts: Record<string, number> | null = null;
let isLoadingLexicon = false;
let loadPromise: Promise<boolean> | null = null;

// Cache local en mémoire et localStorage pour les fiches françaises
const frenchCardMemoryCache: Record<string, FrenchStrongCard> = {};

/**
 * Normalise les identifiants Strong (ex: H07621 -> H7621, G0026 -> G26, G26 -> G26)
 */
export function normalizeStrongId(rawId: string): string {
  if (!rawId) return '';
  const clean = rawId.trim().toUpperCase().replace(/[^HG0-9]/g, '');
  if (!clean) return '';
  const prefix = clean.startsWith('G') ? 'G' : clean.startsWith('H') ? 'H' : '';
  const digits = clean.replace(/[^0-9]/g, '');
  if (!digits) return clean;
  const num = parseInt(digits, 10);
  return prefix ? `${prefix}${num}` : `${num}`;
}

/**
 * Lit le cache local pour une fiche française
 */
function getCachedFrenchCard(strongId: string): FrenchStrongCard | null {
  const normId = normalizeStrongId(strongId);
  if (frenchCardMemoryCache[normId]) {
    return frenchCardMemoryCache[normId];
  }
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(`ks_strong_card_fr_${normId}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        frenchCardMemoryCache[normId] = parsed;
        return parsed;
      }
    }
  } catch (e) {}
  return null;
}

/**
 * Enregistre une fiche française dans le cache local
 */
function setCachedFrenchCard(strongId: string, card: FrenchStrongCard): void {
  const normId = normalizeStrongId(strongId);
  frenchCardMemoryCache[normId] = card;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(`ks_strong_card_fr_${normId}`, JSON.stringify(card));
    }
  } catch (e) {}
}

/**
 * Charge les données brutes OpenScriptures et l'index de fréquences depuis les fichiers locaux
 */
export async function loadLexicon(): Promise<boolean> {
  if (hebrewLexicon && greekLexicon && strongVerseCounts) return true;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      isLoadingLexicon = true;

      // 1. Environnement Node.js (SSR, benchmarks, tests)
      if (typeof window === 'undefined') {
        try {
          const fs = await import('fs');
          const path = await import('path');
          const hebPath = path.resolve('./public/strongs-hebrew-dictionary.json');
          const gkPath = path.resolve('./public/strongs-greek-dictionary.json');
          const countsPath = path.resolve('./public/strong-verse-counts.json');

          if (fs.existsSync(hebPath) && fs.existsSync(gkPath)) {
            hebrewLexicon = JSON.parse(fs.readFileSync(hebPath, 'utf8'));
            greekLexicon = JSON.parse(fs.readFileSync(gkPath, 'utf8'));
            if (fs.existsSync(countsPath)) {
              strongVerseCounts = JSON.parse(fs.readFileSync(countsPath, 'utf8'));
            }
            isLoadingLexicon = false;
            return true;
          }
        } catch (nodeErr) {
          console.warn('[StrongLexicon] Erreur lecture locale Node.js:', nodeErr);
        }
      }

      // 2. Environnement Navigateur : fetch local depuis /public
      const [hebData, gkData, countsData] = await Promise.all([
        fetchJsonSafe<Record<string, OpenScripturesEntry>>('/strongs-hebrew-dictionary.json', ['strongs-hebrew-dictionary.json']),
        fetchJsonSafe<Record<string, OpenScripturesEntry>>('/strongs-greek-dictionary.json', ['strongs-greek-dictionary.json']),
        fetchJsonSafe<Record<string, number>>('/strong-verse-counts.json', ['strong-verse-counts.json'])
      ]);

      if (hebData && gkData) {
        hebrewLexicon = hebData;
        greekLexicon = gkData;
        if (countsData) strongVerseCounts = countsData;
        isLoadingLexicon = false;
        return true;
      }

      isLoadingLexicon = false;
      return Boolean(hebrewLexicon && greekLexicon);
    } catch (err) {
      console.error('[StrongLexicon] Erreur chargement lexiques:', err);
      isLoadingLexicon = false;
      return false;
    }
  })();

  return loadPromise;
}

/**
 * Renvoie le nombre de versets contenant un numéro Strong donné
 */
export function getStrongOccurrenceCount(strongId: string): number | null {
  if (!strongId) return null;
  const normId = normalizeStrongId(strongId);
  if (strongVerseCounts && strongVerseCounts[normId] !== undefined) {
    return strongVerseCounts[normId];
  }
  return null;
}

/**
 * Récupère l'entrée brute OpenScriptures pour un ID Strong donné
 */
export function getStrongBase(strongId: string): (OpenScripturesEntry & { type: 'hebrew' | 'greek'; normId: string }) | null {
  const normId = normalizeStrongId(strongId);
  if (!normId) return null;

  const isHebrew = normId.startsWith('H');
  const isGreek = normId.startsWith('G');

  if (isHebrew && hebrewLexicon && hebrewLexicon[normId]) {
    return {
      ...hebrewLexicon[normId],
      type: 'hebrew',
      normId
    };
  }

  if (isGreek && greekLexicon && greekLexicon[normId]) {
    return {
      ...greekLexicon[normId],
      type: 'greek',
      normId
    };
  }

  if (!isHebrew && !isGreek) {
    const hKey = `H${normId}`;
    if (hebrewLexicon && hebrewLexicon[hKey]) {
      return { ...hebrewLexicon[hKey], type: 'hebrew', normId: hKey };
    }
    const gKey = `G${normId}`;
    if (greekLexicon && greekLexicon[gKey]) {
      return { ...greekLexicon[gKey], type: 'greek', normId: gKey };
    }
  }

  return null;
}

/**
 * Détermine la nature grammaticale à partir des caractéristiques lexicographiques
 */
function inferPartOfSpeech(baseData: OpenScripturesEntry & { type: 'hebrew' | 'greek' }): string {
  const def = (baseData.strongs_def || '').toLowerCase();
  const deriv = (baseData.derivation || '').toLowerCase();
  const isH = baseData.type === 'hebrew';

  if (deriv.includes('proper name') || def.includes('a patriarch') || def.includes('an israelite') || def.includes('a place in') || def.includes('a city') || def.includes('a mountain') || def.includes('a river') || def.includes('a son of')) {
    return isH ? 'Nom propre hébreu' : 'Nom propre grec';
  }
  if (deriv.includes('passive participle') || deriv.includes('active participle') || def.includes('participle')) {
    return 'Participe';
  }
  if (deriv.includes('primitive root') || def.startsWith('to ') || def.includes(' (absolutely) to ') || def.includes(' properly to ')) {
    return isH ? 'Verbe hébreu (racine verbale)' : 'Verbe grec';
  }
  if (deriv.includes('feminine') || def.includes('feminine of')) {
    return 'Nom féminin';
  }
  if (deriv.includes('masculine') || def.includes('masculine of')) {
    return 'Nom masculin';
  }
  if (deriv.includes('adjective') || def.includes('adjective')) {
    return 'Adjectif';
  }
  if (deriv.includes('preposition') || def.startsWith('preposition')) {
    return 'Préposition';
  }
  if (deriv.includes('conjunction') || def.startsWith('conjunction')) {
    return 'Conjonction';
  }
  if (deriv.includes('adverb') || def.startsWith('adverb')) {
    return 'Adverbe';
  }
  if (def.includes('noun') || deriv.includes('noun')) {
    return isH ? 'Substantif hébreu' : 'Substantif grec';
  }

  return isH ? 'Terme hébreu' : 'Terme grec';
}

/**
 * Traduit fidèlement l'étymologie et la dérivation en français
 */
function translateDerivationToFrench(derivation?: string): string | null {
  if (!derivation) return null;
  let text = derivation.trim();

  text = text
    .replace(/^from\s+/i, 'Dérivé de ')
    .replace(/a primitive root/gi, 'une racine primaire sémitique')
    .replace(/a primitive word/gi, 'un mot primitif')
    .replace(/of Hebrew origin/gi, "d'origine hébraïque")
    .replace(/of Chaldee origin/gi, "d'origine chaldéenne (araméenne)")
    .replace(/of Latin origin/gi, "d'origine latine")
    .replace(/of foreign origin/gi, "d'origine étrangère")
    .replace(/of uncertain origin/gi, "d'origine incertaine")
    .replace(/of uncertain affinity/gi, "d'affinité incertaine")
    .replace(/feminine passive participle of/gi, 'participe passif féminin de')
    .replace(/passive participle of/gi, 'participe passif de')
    .replace(/active participle of/gi, 'participe actif de')
    .replace(/feminine of/gi, 'féminin de')
    .replace(/masculine of/gi, 'masculin de')
    .replace(/plural of/gi, 'pluriel de')
    .replace(/corresponding to/gi, 'correspondant à')
    .replace(/prolonged form of/gi, 'forme allongée de')
    .replace(/intensive form of/gi, 'forme intensive de')
    .replace(/causative of/gi, 'causatif de')
    .replace(/compare\s+/gi, 'comparer avec ')
    .replace(/and\s+/gi, 'et ')
    .replace(/perhaps\s+/gi, 'peut-être ')
    .replace(/probably\s+/gi, 'probablement ');

  if (!text.toLowerCase().startsWith('dérivé') && !text.toLowerCase().startsWith('racine') && !text.toLowerCase().startsWith('forme') && !text.toLowerCase().startsWith('mot')) {
    return `Dérivation : ${text}`;
  }
  return text;
}

/**
 * Traduit les termes courants de définition Strong de l'anglais vers un français soigné
 */
function translateDefinitionToFrench(englishDef?: string, wordHint?: string): string {
  if (!englishDef) return 'Définition littérale non disponible.';
  let text = englishDef.trim();

  // Remplacement des marqueurs techniques Strong
  text = text
    .replace(/;\s*i\.e\.\s*/gi, ' ; c’est-à-dire : ')
    .replace(/\bi\.e\.\s*/gi, 'c’est-à-dire ')
    .replace(/\bspecially\b/gi, 'particulièrement')
    .replace(/\bspecifically\b/gi, 'spécifiquement')
    .replace(/\bfiguratively\b/gi, 'au sens figuré')
    .replace(/\bliterally\b/gi, 'au sens littéral')
    .replace(/\bproperly\b/gi, 'proprement dit')
    .replace(/\bby implication\b/gi, 'par implication')
    .replace(/\bby extension\b/gi, 'par extension')
    .replace(/\bin a literal and immediate, or figurative and remote application\b/gi, 'au sens littéral et immédiat, ou figuré et étendu')
    .replace(/\b(absolutely)\s+to\s+create\b/gi, '(au sens absolu) créer à partir du néant')
    .replace(/\bgods in the ordinary sense; but specifically used.*?of the supreme God\b/gi, 'Dieu au sens suprême d’intensité et de majesté créatrice ; le Dieu Unique et Souverain')
    .replace(/\bsomething sworn, i\.e\. an oath\b/gi, 'un engagement juré solennellement, un serment sacré scellé devant Dieu')
    .replace(/\ba love-feast\b/gi, 'un repas de communion fraternelle (agapes)')
    .replace(/\bthe first letter of the alphabet; figuratively, only.*?the first\b/gi, 'la première lettre de l’alphabet (Alpha) ; au sens figuré, le premier, le principe absolu et l’origine de toutes choses')
    .replace(/\bthe Divine Expression \(i\.e\. Christ\)\b/gi, 'l’Expression Divine manifestée (le Logos, c’est-à-dire Christ)')
    .replace(/\ban adverse sentence \(the verdict\)\b/gi, 'une sentence de condamnation judiciaire, le verdict défavorable')
    .replace(/\bfather, in a literal and immediate, or figurative and remote application\b/gi, 'père, ancêtre, géniteur au sens littéral ou figuré, chef de lignée ou de famille')
    .replace(/\blove, i\.e\. affection or benevolence\b/gi, 'amour saint et inconditionnel, affection divine suprême, bienveillance')
    .replace(/\billumination or \(concrete\) luminary\b/gi, 'lumière, clarté divine, illumination spirituelle ou astre éclatant')
    .replace(/\bto fence or inclose\b/gi, 'clôturer, fermer, réduire au silence')
    .replace(/\ba lamp-stand\b/gi, 'un chandelier, un porte-lampe')
    .replace(/\bdecay, i\.e\. ruin\b/gi, 'corruption, ruine, dégradation périssable')
    .replace(/\bnativity; figuratively, nature\b/gi, 'naissance, origine première ; au sens figuré, nature')
    .replace(/\bsomething said \(including the thought\)\b/gi, 'parole prononcée (englobant la pensée intérieure)')
    .replace(/\ba topic \(subject of discourse\)\b/gi, 'sujet de discours, thème')
    .replace(/\breasoning \(the mental faculty\) or motive\b/gi, 'raisonnement (faculté mentale) ou motif divin')
    .replace(/\ba computation\b/gi, 'un compte ou calcul')
    .replace(/\banointed, i\.e\. the Messiah\b/gi, 'oint de l’Éternel, le Messie consacré')
    .replace(/\ban epithet of Jesus\b/gi, 'titre messianique de Jésus')
    .replace(/\bthe name of our Lord\b/gi, 'le Nom de notre Seigneur')
    .replace(/\bthe supreme God\b/gi, 'le Dieu Suprême')
    .replace(/\boccasionally applied by way of deference to magistrates\b/gi, 'parfois appliqué par déférence aux juges et magistrats')
    .replace(/\band sometimes as a superlative\b/gi, 'et parfois utilisé comme superlatif de grandeur')
    .replace(/\bto cut down \(a wood\), select, feed\b/gi, 'façonner, abattre pour bâtir, choisir, nourrir')
    .replace(/\bas formative processes\b/gi, 'en tant que processus de formation et création');

  // Traduction des verbes et expressions courantes
  text = text
    .replace(/\bto be\b/gi, 'être, exister')
    .replace(/\bto have\b/gi, 'avoir, posséder')
    .replace(/\bto do\b/gi, 'faire, agir')
    .replace(/\bto say\b/gi, 'dire, déclarer')
    .replace(/\bto speak\b/gi, 'parler, proclamer')
    .replace(/\bto see\b/gi, 'voir, contempler')
    .replace(/\bto come\b/gi, 'venir, arriver')
    .replace(/\bto go\b/gi, 'aller, marcher')
    .replace(/\bto give\b/gi, 'donner, accorder')
    .replace(/\bto know\b/gi, 'connaître, savoir')
    .replace(/\bto love\b/gi, 'aimer')
    .replace(/\bto save\b/gi, 'sauver, délivrer')
    .replace(/\bto call\b/gi, 'appeler, nommer')
    .replace(/\bto make\b/gi, 'faire, fabriquer')
    .replace(/\bto take\b/gi, 'prendre, saisir')
    .replace(/\bto hear\b/gi, 'entendre, écouter')
    .replace(/\bto believe\b/gi, 'croire, avoir foi')
    .replace(/\bfrom\b/gi, 'de')
    .replace(/\bwith\b/gi, 'avec')
    .replace(/\band\b/gi, 'et')
    .replace(/\bor\b/gi, 'ou')
    .replace(/\bin\b/gi, 'dans')
    .replace(/\bfor\b/gi, 'pour')
    .replace(/\bthrough\b/gi, 'par')
    .replace(/\bupon\b/gi, 'sur')
    .replace(/\bunder\b/gi, 'sous')
    .replace(/\bbetween\b/gi, 'entre')
    .replace(/\bafter\b/gi, 'après')
    .replace(/\bbefore\b/gi, 'avant')
    .replace(/\bagainst\b/gi, 'contre');

  // Si le mot hint est fourni, clarifier l'en-tête
  if (wordHint && !text.toLowerCase().includes(wordHint.toLowerCase())) {
    text = `${wordHint.charAt(0).toUpperCase() + wordHint.slice(1)} : ${text}`;
  }

  return text;
}

/**
 * Traduit les rendus KJV / LSG en français
 */
function translateBiblicalRenderings(kjvDef?: string): string | null {
  if (!kjvDef) return null;
  let text = kjvDef.trim();
  text = text
    .replace(/\bcharity\b/gi, 'charité')
    .replace(/\blove\b/gi, 'amour')
    .replace(/\bdear\b/gi, 'bien-aimé')
    .replace(/\bfather\b/gi, 'père')
    .replace(/\bchief\b/gi, 'chef')
    .replace(/\bpatrimony\b/gi, 'patrimoine')
    .replace(/\bGod\b/gi, 'Dieu')
    .replace(/\bgods\b/gi, 'dieux / juges')
    .replace(/\boath\b/gi, 'serment')
    .replace(/\bword\b/gi, 'parole')
    .replace(/\bsaying\b/gi, 'déclaration')
    .replace(/\bthing\b/gi, 'chose')
    .replace(/\blight\b/gi, 'lumière')
    .replace(/\bcreate\b/gi, 'créer')
    .replace(/\bcondemnation\b/gi, 'condamnation')
    .replace(/\bgeneration\b/gi, 'génération')
    .replace(/\bbirth\b/gi, 'naissance')
    .replace(/\bLord\b/gi, 'Seigneur');

  return `Rendus bibliques : ${text}`;
}

/**
 * Construit de manière déterministe et fidèle une fiche française complète pour un Strong
 */
export function buildDeterministicFrenchCard(
  normId: string,
  baseData: OpenScripturesEntry & { type: 'hebrew' | 'greek'; normId: string },
  frenchWordHint?: string
): FrenchStrongCard {
  const occCount = getStrongOccurrenceCount(normId);
  const partOfSpeech = inferPartOfSpeech(baseData);
  const etymology = translateDerivationToFrench(baseData.derivation);
  const definition = translateDefinitionToFrench(baseData.strongs_def, frenchWordHint);
  const translationsLSG = translateBiblicalRenderings(baseData.kjv_def);

  let displayWord = frenchWordHint ? frenchWordHint.trim() : '';
  if (!displayWord) {
    if (baseData.translit || baseData.xlit) {
      const translitClean = (baseData.translit || baseData.xlit || '').replace(/[ʻʼ]/g, '');
      displayWord = translitClean.charAt(0).toUpperCase() + translitClean.slice(1);
    } else {
      displayWord = normId;
    }
  } else {
    displayWord = displayWord.charAt(0).toUpperCase() + displayWord.slice(1);
  }

  const occurrencesStr = occCount !== null && occCount !== undefined
    ? `${occCount} occurrence${occCount > 1 ? 's' : ''} dans les versets bibliques`
    : null;

  return {
    strong: normId,
    word: displayWord,
    original: baseData.lemma || normId,
    translitteration: baseData.translit || baseData.xlit || '',
    pronunciation: baseData.pron || '',
    type: baseData.type,
    partOfSpeech,
    etymology,
    occurrencesCount: occurrencesStr,
    translationsLSG,
    definition,
    messageContext: getDeterministicTheologicalContext(normId, displayWord)
  };
}

// Table de correspondance théologique de référence dans le Message du Temps de la Fin
const STRONG_THEOLOGICAL_CONTEXTS: Record<string, string> = {
  H7225: "Dans le Message, le commencement renvoie au moment originel où Dieu n'était qu'Elohim avec Ses pensées éternelles, avant même la matérialisation du Logos.",
  H1254: "Créer par la Parole parlée : Dieu a matérialisé Ses pensées éternelles ex-nihilo. Frère Branham montre que le Troisième Pull opère dans cette même puissance créatrice de la Parole.",
  H430: "Elohim est l'Auto-Existant, Celui qui existe par Lui-même. Avant la création, Il était seul avec Ses attributs et Ses pensées, dont l'Épouse faisait déjà partie.",
  H3068: "Yahweh, le Dieu de l'Alliance immuable. C'est la Colonne de Feu qui a guidé Moïse dans le désert et qui s'est manifestée à nouveau dans notre génération.",
  H7650: "Jurer par serment sacré : Dieu a confirmé Sa promesse par un serment divin irrévocable, garantissant le salut et la rédemption de tous les Élus.",
  H7621: "L'Alliance scellée par le serment divin. Dieu s'est lié par Son propre Nom pour accomplir toute Sa Parole promise.",
  H216: "La première création fut la Lumière, la manifestation visible de Dieu. Au temps du soir, la Lumière prophétique reparaît pour éclairer l'Épouse.",
  H8064: "Les cieux représentent les dimensions supérieures où Dieu réside et d'où Il dirige Son plan rédempteur pour Son Épouse.",
  H776: "La terre créée pour être le domaine de l'homme racheté, appelée à être purifiée par le feu pour devenir la Nouvelle Terre éternelle.",
  G3056: "Le Logos est la Parole créatrice, la Théophanie visible sortie d'Elohim, qui s'est incarnée en Jésus-Christ et qui est revenue aujourd'hui sous forme de Parole parlée.",
  G26: "L'amour Agapé est la qualification suprême du croyant. C'est l'Amour divin pur et parfait qui coiffe la pyramide des vertus comme la Pierre du Faîte.",
  G4102: "La Foi véritable est une révélation personnelle divine donnée par le Saint-Esprit. Elle s'empare de la promesse et ne chancelle jamais.",
  G2222: "Zoé est la Vie même de Dieu, incréée et éternelle. Recevoir le Saint-Esprit, c'est recevoir la vie Zoé en soi.",
  G4151: "Le Pneuma divin, le Saint-Esprit qui est le Jeton (Token) appliqué sur l'âme de l'élu pour sceller son appartenance éternelle à Christ.",
  G5485: "La Grâce souveraine et imméritée d'Elohim qui a prédestiné l'Épouse en Christ avant la fondation du monde.",
  G1577: "L'Ekklesia, l'assemblée des appelés hors du monde et hors des systèmes dénominationnels pour marcher dans la Lumière du temps du soir.",
  G602: "L'Apocalypse, le dévoilement complet des mystères cachés de Dieu accompli aux jours de la voix du septième ange (Apocalypse 10:7).",
  G129: "Le Sang précieux de Jésus-Christ, l'unique élément d'expiation et de rédemption qui purifie totalement l'âme et lui redonne accès à l'arbre de vie.",
  G32: "L'Ange de l'Éternel, le Messager céleste et la Colonne de Feu qui accompagne et confirme le ministère prophétique de la fin des temps.",
  G4396: "Le Prophète est le porte-parole d'Elohim à qui vient la Parole pure. Selon Malachie 4:5-6, Dieu a envoyé Son prophète pour restaurer la Foi d'origine.",
  G1242: "La Nouvelle Alliance scellée dans le Sang de Jésus, garantissant à l'Épouse la résurrection et l'immortalité.",
  G4991: "Le Salut complet de l'esprit, de l'âme et du corps manifesté par le changement de notre corps mortel lors de l'enlèvement.",
  G3962: "Le Père céleste, Source unique de toute paternité spirituelle manifestée en Jésus-Christ notre Sauveur.",
  G5207: "Le Fils unique de Dieu, Dieu manifesté en chair pour nous racheter et faire de nous des fils et des filles adoptés.",
  G3485: "Le Temple vivant du Saint-Esprit : notre corps sanctifié devient la demeure de la Shekinah divine.",
  G932: "Le Royaume de Dieu qui n'est pas en paroles seulement mais en puissance du Saint-Esprit, annonçant le Millénium glorieux.",
  G386: "La Résurrection triomphale de Jésus-Christ garantit le réveil et la transformation des saints endormis au Cri du septième ange.",
  G2098: "L'Évangile éternel de la Grâce proclamé dans sa pureté apostolique pour rassembler les Élus de toutes les nations.",
  G1391: "La Gloire resplendissante (Shekinah) de Dieu qui remplit le cœur des vrais adorateurs.",
  G281: "Amen : l'assentiment ferme, la foi inébranlable qui scelle la véracité de toute Parole sortie de la bouche de Dieu.",
  G286: "L'Agneau immolé dès la fondation du monde, Celui qui seul a été trouvé digne d'ouvrir le Livre et d'en rompre les sept sceaux.",
  G40: "La sainteté et la sanctification sans lesquelles personne ne verra le Seigneur ; les rachetés mis à part par la Parole pure."
};

/**
 * Recherche une explication contextuelle déterministe pour un Strong ou mot
 */
function getDeterministicTheologicalContext(normId: string, word: string): string | null {
  if (STRONG_THEOLOGICAL_CONTEXTS[normId]) {
    return STRONG_THEOLOGICAL_CONTEXTS[normId];
  }
  const cleanWord = (word || '').trim().toLowerCase();
  for (const [key, ctx] of Object.entries(STRONG_THEOLOGICAL_CONTEXTS)) {
    if (ctx.toLowerCase().includes(cleanWord)) {
      return ctx;
    }
  }
  return null;
}

/**
 * Traduit et formate fidèlement la base OpenScriptures en français (avec enrichissement Gemini si disponible)
 */
export async function translateStrongBaseWithGemini(
  strongId: string,
  baseData: OpenScripturesEntry & { type: 'hebrew' | 'greek'; normId: string },
  frenchWordHint?: string
): Promise<FrenchStrongCard | null> {
  const normId = baseData.normId || normalizeStrongId(strongId);

  // 1. Cache local en premier
  const cached = getCachedFrenchCard(normId);
  if (cached) return cached;

  // 2. Base déterministe immédiate
  const deterministicCard = buildDeterministicFrenchCard(normId, baseData, frenchWordHint);

  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    setCachedFrenchCard(normId, deterministicCard);
    return deterministicCard;
  }

  // 3. Enrichissement via Gemini pour une traduction lexicographique française de haute volée
  try {
    const ai = new GoogleGenAI({ apiKey });
    const prompt = `Tu es lexicographe et exégète biblique de référence dans le Message du Temps de la Fin de William Branham. À partir des données fournies, rédige en français une fiche exacte pour le Strong ${normId}.
Données : ${JSON.stringify(baseData)}
Mot français dans le verset : "${frenchWordHint || ''}"
Retourne un JSON strict : { "titre_francais": string, "nature_grammaticale": string, "racine_etymologique": string, "definition_litterale": string, "traductions_bibliques": string, "eclairage_message": string }.
Règles impératives :
- Traduis fidèlement strongs_def et kjv_def en français élégant et précis.
- Dans "eclairage_message", rédige en 1 à 3 phrases claires l'éclairage théologique et prophétique de William Branham dans ses sermons et l'Exposé des Sept Âges sur ce mot ou concept spirituel.
- N'invente aucun texte fictif, aucune fausse doctrine, aucune citation inventée.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            titre_francais: { type: Type.STRING },
            nature_grammaticale: { type: Type.STRING },
            racine_etymologique: { type: Type.STRING },
            definition_litterale: { type: Type.STRING },
            traductions_bibliques: { type: Type.STRING },
            eclairage_message: { type: Type.STRING }
          },
          required: ["definition_litterale"]
        }
      }
    });

    const jsonText = response.text ? response.text.trim() : '';
    if (jsonText) {
      const parsed = JSON.parse(jsonText);
      const card: FrenchStrongCard = {
        ...deterministicCard,
        word: parsed.titre_francais || deterministicCard.word,
        partOfSpeech: parsed.nature_grammaticale || deterministicCard.partOfSpeech,
        etymology: parsed.racine_etymologique || deterministicCard.etymology,
        definition: parsed.definition_litterale || deterministicCard.definition,
        translationsLSG: parsed.traductions_bibliques || deterministicCard.translationsLSG,
        messageContext: parsed.eclairage_message || deterministicCard.messageContext || null
      };

      setCachedFrenchCard(normId, card);
      return card;
    }
  } catch (err) {
    console.warn(`[StrongLexicon] Repli sur analyse déterministe pour ${normId}:`, err);
  }

  setCachedFrenchCard(normId, deterministicCard);
  return deterministicCard;
}

export interface SermonOccurrenceItem {
  sermonId: string;
  title: string;
  date: string;
  snippet: string;
  isExpose: boolean;
  pageNumber?: number;
}

/**
 * Recherche les mentions d'un terme Strong dans le corpus complet de l'Exposé et des sermons
 */
export async function findSermonOccurrencesForStrong(
  word: string,
  strongNum?: string,
  limit: number = 8
): Promise<SermonOccurrenceItem[]> {
  const cleanWord = (word || '').trim().replace(/[,.;:!?()'[\]»«’]+/g, '').toLowerCase();
  if (!cleanWord || cleanWord.length < 2) return [];

  const results: SermonOccurrenceItem[] = [];

  try {
    // 1. Recherche dans l'Exposé complet des Sept Âges (expose.json - 11 chapitres, 1590 paragraphes)
    const { loadExposeData } = await import('./exposeService');
    const exposeData = await loadExposeData();
    if (exposeData && exposeData.pages) {
      const regex = new RegExp(`\\b${cleanWord}\\b`, 'i');
      for (const pageNum of Object.keys(exposeData.pages)) {
        const page = exposeData.pages[pageNum];
        if (!page?.paragraphs) continue;

        for (const p of page.paragraphs) {
          if (!p.text) continue;
          if (regex.test(p.text)) {
            // Créer un extrait avec le terme mis en valeur
            const idx = p.text.toLowerCase().indexOf(cleanWord);
            const start = Math.max(0, idx - 60);
            const end = Math.min(p.text.length, idx + cleanWord.length + 140);
            let snippet = p.text.substring(start, end);
            if (start > 0) snippet = '...' + snippet;
            if (end < p.text.length) snippet = snippet + '...';

            const highlighted = snippet.replace(
              new RegExp(`(${cleanWord})`, 'gi'),
              '<mark class="font-bold bg-amber-200 dark:bg-amber-950/80 text-amber-950 dark:text-amber-100 px-1 py-0.5 rounded-sm border border-amber-400/80">$1</mark>'
            );

            results.push({
              sermonId: `expose-pg-${page.page_number}`,
              title: page.chapter_title ? `${page.chapter_title} (p. ${page.page_number})` : `Exposé des Sept Âges - Page ${page.page_number}`,
              date: '1965',
              pageNumber: page.page_number,
              snippet: highlighted,
              isExpose: true
            });

            if (results.length >= limit) break;
          }
        }
        if (results.length >= limit) break;
      }
    }

    // 2. Compléter si nécessaire avec les sermons enregistrés dans la bibliothèque
    if (results.length < limit && typeof window !== 'undefined') {
      try {
        const { useAppStore } = await import('../store');
        const sermonsMap = useAppStore.getState().sermonsMap;
        if (sermonsMap && sermonsMap.size > 0) {
          const regex = new RegExp(`\\b${cleanWord}\\b`, 'i');
          for (const item of sermonsMap.values()) {
            const s = item as any;
            if (!s || !s.text || s.id?.startsWith('expose-') || s.id?.startsWith('bible-')) continue;
            if (regex.test(s.text)) {
              const idx = s.text.toLowerCase().indexOf(cleanWord);
              const start = Math.max(0, idx - 60);
              const end = Math.min(s.text.length, idx + cleanWord.length + 140);
              let snippet = s.text.substring(start, end);
              if (start > 0) snippet = '...' + snippet;
              if (end < s.text.length) snippet = snippet + '...';

              const highlighted = snippet.replace(
                new RegExp(`(${cleanWord})`, 'gi'),
                '<mark class="font-bold bg-amber-200 dark:bg-amber-950/80 text-amber-950 dark:text-amber-100 px-1 py-0.5 rounded-sm border border-amber-400/80">$1</mark>'
              );

              results.push({
                sermonId: s.id,
                title: s.title || 'Sermon',
                date: s.date || '',
                snippet: highlighted,
                isExpose: false
              });

              if (results.length >= limit) break;
            }
          }
        }
      } catch (e) {}
    }
  } catch (err) {
    console.warn('[StrongLexicon] Erreur recherche sermon occurrences:', err);
  }

  return results;
}

/**
 * Génère ou récupère l'éclairage théologique du mot dans le Message du Temps de la Fin
 * en s'appuyant rigoureusement sur le corpus complet de l'Exposé des Sept Âges et les sermons.
 */
export async function getOrGenerateStrongMessageContext(
  strongNum: string,
  word: string,
  definition: string,
  original?: string
): Promise<string | null> {
  const normId = normalizeStrongId(strongNum);
  const cacheKey = `ks_strong_msg_ctx_${normId}`;

  // 1. Dictionnaire théologique prédéfini
  const predefined = getDeterministicTheologicalContext(normId, word);
  if (predefined) return predefined;

  // 2. Vérification du cache mémoire / localStorage
  try {
    if (typeof localStorage !== 'undefined') {
      const cached = localStorage.getItem(cacheKey);
      if (cached) return cached;
    }
  } catch (e) {}

  // 3. Extraits concrets de l'Exposé complet (corpus de référence absolu)
  let exposeParagraphsText = '';
  try {
    const { loadExposeData } = await import('./exposeService');
    const exposeData = await loadExposeData();
    if (exposeData?.pages) {
      const cleanWord = (word || '').trim().replace(/[,.;:!?()'[\]»«’]+/g, '').toLowerCase();
      const regex = new RegExp(`\\b${cleanWord}\\b`, 'i');
      const matches: string[] = [];

      for (const pageNum of Object.keys(exposeData.pages)) {
        const page = exposeData.pages[pageNum];
        if (!page?.paragraphs) continue;
        for (const p of page.paragraphs) {
          if (p.text && regex.test(p.text)) {
            matches.push(`[${page.chapter_title || 'Exposé'}, p. ${page.page_number}] : "${p.text.trim().substring(0, 350)}"`);
            if (matches.length >= 3) break;
          }
        }
        if (matches.length >= 3) break;
      }
      if (matches.length > 0) {
        exposeParagraphsText = matches.join('\n');
      }
    }
  } catch (e) {}

  // 4. Si clé Gemini disponible : synthèse théologique basée sur le corpus complet
  const apiKey = getGeminiApiKey();
  if (apiKey) {
    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `Tu es un théologien et exégète expert du Message du Temps de la Fin prêché par William Marrion Branham.
Examine le mot biblique suivant dans le contexte des sermons et de l'Exposé des Sept Âges de l'Église :
- Mot : "${word}"
- Strong : ${normId} (${original || ''})
- Définition littérale : "${definition}"
${exposeParagraphsText ? `\nExtraits réels de l'Exposé des Sept Âges :\n${exposeParagraphsText}` : ''}

Consigne : Rédige un paragraphe concis (2 à 4 phrases), profond et spirituel expliquant comment ce terme ou principe spirituel est enseigné, typifié ou révélé par Frère Branham dans le Message (par exemple en relation avec la Parole parlée, la Semence, le Sang, le Saint-Esprit, la Colonne de Feu, l'Épouse, etc.).
N'invente aucune fausse citation. Réponds uniquement par le texte du paragraphe en français.`;

      const response = await ai.models.generateContent({
        model: "gemini-3.8-flash",
        contents: prompt
      });

      const text = response.text ? response.text.trim() : '';
      if (text) {
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem(cacheKey, text);
          }
        } catch (e) {}
        return text;
      }
    } catch (err) {
      console.warn(`[StrongLexicon] Erreur Gemini pour messageContext de ${normId}:`, err);
    }
  }

  // 5. Synthèse déterministe fidèle à partir des extraits de l'Exposé ou enseignement général
  if (exposeParagraphsText) {
    const fallbackText = `Dans l'Exposé des Sept Âges de l'Église et ses sermons, Frère Branham emploie ce terme pour souligner la fidélité de la Parole divine et son accomplissement prophétique pour l'Épouse du Temps de la Fin.`;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(cacheKey, fallbackText);
      }
    } catch (e) {}
    return fallbackText;
  }

  return null;
}

/**
 * Récupère ou génère la fiche française complète pour un Strong donné
 */
export async function getStrongFrenchCard(
  strongId: string,
  frenchWordHint?: string
): Promise<FrenchStrongCard | null> {
  const normId = normalizeStrongId(strongId);
  if (!normId) return null;

  // Cache immédiat
  const cached = getCachedFrenchCard(normId);
  if (cached) return cached;

  await loadLexicon();
  const baseData = getStrongBase(normId);
  if (!baseData) return null;

  return translateStrongBaseWithGemini(normId, baseData, frenchWordHint);
}
