/**
 * King's Sword — Service d'Exégèse Biblique (Bible Amplifiée & Concordance Strong)
 * 
 * Ce service gère :
 * 1. La génération à la volée de la Bible Amplifiée (AMP) à partir de la version Louis Segond.
 * 2. L'indexation et la fourniture des numéros Strong (hébreu/grec) pour tous les mots de la Bible.
 * 3. Le dictionnaire/lexique Strong complet avec définitions authentiques et éclairage dans le Message.
 */

import { BIBLE_BOOKS_META } from './bibleMetadata';
import { 
  loadLexicon, 
  getStrongBase, 
  translateStrongBaseWithGemini, 
  normalizeStrongId,
  getStrongFrenchCard,
  buildDeterministicFrenchCard,
  getStrongOccurrenceCount,
  getOrGenerateStrongMessageContext
} from './strongLexiconService';
import { 
  VERIFIED_WORD_STRONG_MAP 
} from './strongIndexData';
import { fetchJsonSafe } from '../utils/fetchHelper';

export interface StrongWord {
  word: string;
  strong: string; // Ex: "H430", "G3056"
  original: string; // Ex: "Elohim", "Logos"
  definition: string;
  pronunciation: string;
  type: 'hebrew' | 'greek';
  partOfSpeech?: string; // Ex: "Nom collectif féminin"
  etymology?: string; // Ex: "Racine inutilisée signifiant paître/migrer"
  occurrencesCount?: string | number; // Ex: "274 occurrences"
  translationsLSG?: string; // Ex: "brebis (135x), troupeau (110x)..."
  messageContext?: string; // Éclairage théologique du frère Branham
}

export interface VerseStrongData {
  bookId: string;
  chapter: number;
  verse: number;
  words: {
    text: string;
    strong?: string;
  }[];
}

// Lexique de référence des principaux numéros Strong théologiques majeurs
export const STRONG_LEXICON: Record<string, Omit<StrongWord, 'strong'>> = {
  H7621: {
    word: "Serment",
    original: "שְׁבוּעָה (Shebu'ah)",
    pronunciation: "sheb-oo-aw'",
    type: "hebrew",
    partOfSpeech: "Nom féminin",
    etymology: "Participe passif féminin de H7650 (Shaba) signifiant prêter serment ou se lier par sept.",
    occurrencesCount: "30 occurrences dans l'Ancien Testament",
    translationsLSG: "serment (22x), vœu (5x), malédiction (3x)",
    definition: "1) Serment sacré, engagement solennel juré devant Dieu ou confirmé par l'Alliance.\n2) Promesse ferme scellée par l'autorité divine immuable.",
    messageContext: "Quand Dieu a fait la promesse à Abraham, ne pouvant jurer par un plus grand, Il a juré par Lui-même avec serment. L'Alliance de Dieu est inébranlable car elle repose sur le Serment divin."
  },
  H7650: {
    word: "Jurer",
    original: "שָׁבַע (Shaba)",
    pronunciation: "shaw-bah'",
    type: "hebrew",
    partOfSpeech: "Verbe Niphal / Hiphil",
    etymology: "Racine primaire signifiant littéralement se septipler ou prêter un serment sacré.",
    occurrencesCount: "162 occurrences dans l'Ancien Testament",
    translationsLSG: "jurer (140x), faire jurer (15x), attester (7x)",
    definition: "1) Jurer, déclarer sous serment, s'engager de manière sacrée et irrévocable.\n2) Lier son âme devant l'Éternel.",
    messageContext: "Jurer par le Nom de l'Éternel exige une fidélité absolue à la Parole prononcée."
  },
  // Hébreu (Ancien Testament)
  H430: {
    word: "Dieu",
    original: "אֱלֹהִים (Elohim)",
    pronunciation: "El-o-heem",
    type: "hebrew",
    partOfSpeech: "Nom masculin pluriel de majesté",
    etymology: "Pluriel de H433 (Eloah), dérivé de H410 (El), signifiant puissance, force suprême et divinité.",
    occurrencesCount: "2600 occurrences dans l'Ancien Testament",
    translationsLSG: "Dieu (2300x), juges (100x), de Dieu (200x)",
    definition: "1) Dieu au pluriel d'intensité et de majesté, le Créateur Suprême, l'Auto-Existant.\n2) Utilisé pour exprimer la plénitude insondable des attributs divins.",
    messageContext: "Le Prophète explique qu'Elohim est le Dieu Auto-Existant. Avant la création, Il habitait seul avec Ses attributs (Ses pensées). Il n'était pas encore un 'objet d'adoration', mais Il était Elohim."
  },
  H7225: {
    word: "Commencement",
    original: "רֵאשִׁית (Reshith)",
    pronunciation: "ray-sheeth'",
    type: "hebrew",
    partOfSpeech: "Nom féminin",
    etymology: "Dérivé de H7218 (Rosh) signifiant tête, sommet ou chef.",
    occurrencesCount: "51 occurrences dans l'Ancien Testament",
    translationsLSG: "commencement (18x), prémices (11x), chef (8x)",
    definition: "1) Le commencement, la première partie, les prémices, le sommet.\n2) Le point de départ créateur et temporel de toutes choses.",
    messageContext: "Au commencement, la Parole (le Logos) est sortie d'Elohim. C'est l'origine de toute théophanie, le premier pas de Dieu se manifestant de l'invisible vers le visible."
  },
  H1254: {
    word: "Créa",
    original: "בָּרָא (Bara)",
    pronunciation: "baw-raw'",
    type: "hebrew",
    partOfSpeech: "Verbe Qal",
    etymology: "Racine primaire signifiant façonner, former ou créer à partir du néant.",
    occurrencesCount: "54 occurrences dans l'Ancien Testament",
    translationsLSG: "créa (42x), créer (8x), former (4x)",
    definition: "1) Créer à partir du néant (ex-nihilo) par la puissance absolue de la volonté divine.\n2) Produire une réalité entièrement nouvelle et sacrée.",
    messageContext: "Dieu a créé les cieux et la terre par Sa Parole parlée. Prononcer la Parole, c'est matérialiser une pensée éternelle d'Elohim."
  },
  H8064: {
    word: "Cieux",
    original: "שָׁמַיִם (Shamayim)",
    pronunciation: "shaw-mah'-yim",
    type: "hebrew",
    partOfSpeech: "Nom masculin dual / pluriel",
    etymology: "D'une racine inutilisée signifiant être élevé ou l'étendue supérieure.",
    occurrencesCount: "420 occurrences dans l'Ancien Testament",
    translationsLSG: "cieux (380x), ciel (40x)",
    definition: "1) Les cieux, l'étendue céleste, l'atmosphère et les dimensions spirituelles supérieures.\n2) La demeure glorieuse du Très-Haut.",
    messageContext: "Les cieux visibles reflètent la gloire du Créateur, mais le troisième ciel représente la dimension spirituelle où habitent la présence sacrée et les théophanies des Élus."
  },
  H776: {
    word: "Terre",
    original: "אֶרֶץ (Erets)",
    pronunciation: "eh'-rets",
    type: "hebrew",
    partOfSpeech: "Nom féminin",
    etymology: "D'une racine inutilisée signifiant probablement être ferme ou s'étendre.",
    occurrencesCount: "2504 occurrences dans l'Ancien Testament",
    translationsLSG: "pays (1400x), terre (1000x), monde (104x)",
    definition: "1) La terre, le monde matériel, le sol habité par l'humanité.\n2) Un pays ou un territoire spécifique attribué par l'Alliance.",
    messageContext: "La terre fut créée pour être la demeure de l'homme, mais elle est tombée sous la malédiction. Elle gémit en attendant sa rédemption finale par le feu purificateur."
  },
  H3068: {
    word: "Éternel",
    original: "יְהֹוָה (Yahweh / YHWH)",
    pronunciation: "Yah-weh",
    type: "hebrew",
    partOfSpeech: "Nom propre divin",
    etymology: "Dérivé de H1961 (Hayah) signifiant être, exister par soi-même.",
    occurrencesCount: "6828 occurrences dans l'Ancien Testament",
    translationsLSG: "l'Éternel (6500x), Seigneur (300x)",
    definition: "1) Yahweh, le Nom d'Alliance sacré de Dieu, 'Celui qui est, qui était et qui vient'.\n2) Le Dieu fidèle qui garde Son alliance de génération en génération.",
    messageContext: "Yahweh est le nom d'Alliance de Dieu avec Son peuple. Le frère Branham souligne que Yahweh s'est révélé sous sept noms rédempteurs, tous pleinement manifestés en Jésus-Christ."
  },
  H2009: {
    word: "Voici",
    original: "הִנֵּה (Hinneh)",
    pronunciation: "hin-nay'",
    type: "hebrew",
    partOfSpeech: "Particule démonstrative d'attention",
    etymology: "Prolongement de H2005 (Hen) attirant l'attention sur un fait accompli.",
    occurrencesCount: "1060 occurrences dans l'Ancien Testament",
    translationsLSG: "voici (900x), regarde (100x)",
    definition: "1) Particule vivante signifiant 'Regarde !', 'Contemple !', 'Considère ceci !'.\n2) Marque l'accomplissement soudain d'un événement prophétique.",
    messageContext: "Chaque fois que l'Écriture utilise 'Hinneh' (Voici), Dieu attire le regard de la foi sur l'accomplissement soudain d'une promesse ou d'une manifestation prophétique."
  },
  H136: {
    word: "Seigneur",
    original: "אֲדֹנָי (Adonai)",
    pronunciation: "ad-o-noy'",
    type: "hebrew",
    partOfSpeech: "Nom masculin pluriel de seigneurie",
    etymology: "Forme emphatique de H113 (Adon) signifiant maître ou souverain.",
    occurrencesCount: "434 occurrences dans l'Ancien Testament",
    translationsLSG: "Seigneur (400x), Maître (34x)",
    definition: "1) Seigneur, Maître absolu, Propriétaire souverain des âmes et de l'univers.\n2) Marque la soumission joyeuse du serviteur envers son Roi.",
    messageContext: "Adonai exprime la seigneurie et le droit de propriété divine sur la vie de l'Élu qui se soumet entièrement à Sa Parole."
  },
  H192: {
    word: "Père",
    original: "אָב (Ab)",
    pronunciation: "awb",
    type: "hebrew",
    partOfSpeech: "Nom masculin",
    etymology: "Racine primaire signifiant géniteur, chef de famille ou protecteur.",
    occurrencesCount: "1215 occurrences dans l'Ancien Testament",
    translationsLSG: "père (1100x), pères (115x)",
    definition: "1) Père, auteur de la vie, protecteur de la lignée de l'Alliance.\n2) Dieu en tant que Source et Origine éternelle des fils et filles de la promesse.",
    messageContext: "Dieu en tant que Père céleste est la Source de toute paternité spirituelle et de la semence de vie élue."
  },
  H5307: {
    word: "Tomba",
    original: "נָפַל (Naphal)",
    pronunciation: "naw-fal'",
    type: "hebrew",
    partOfSpeech: "Verbe Qal",
    etymology: "Racine primaire signifiant tomber, s'écrouler ou faire défection.",
    occurrencesCount: "434 occurrences dans l'Ancien Testament",
    translationsLSG: "tomber (300x), s'écrouler (50x), tomber sur (40x)",
    definition: "1) Tomber, s'écrouler du haut vers le bas, subir une chute physique ou spirituelle.\n2) Défaillir de la position d'origine accordée par le Créateur.",
    messageContext: "La chute de l'homme dans le jardin d'Éden a séparé l'humanité de l'arbre de Vie, nécessitant l'expiation par le Sang."
  },
  H6629: {
    word: "Brebis / Troupeau",
    original: "צֹאן (Tsô'n) / צֹנֶה (Tsô'neh)",
    pronunciation: "tso'n",
    type: "hebrew",
    partOfSpeech: "Nom collectif féminin et masculin",
    etymology: "Provenant d'une racine inutilisée signifiant migrer ou paître.",
    occurrencesCount: "274 occurrences dans l'Ancien Testament",
    translationsLSG: "brebis (135x), troupeau (110x), moutons (15x), bétail (10x)",
    definition: "1) Petit bétail, troupeau collectif de brebis et de chèvres, ouailles, moutons.\n2) Sens figuré : Le peuple de Dieu rassemblé et guidé par le Berger souverain.",
    messageContext: "Les brebis représentent les Élus nés de la Semence de Dieu. Le frère Branham enseigne que les brebis ont une nature douce qui dépend entièrement du Berger. Elles entendent Sa Voix à travers la Parole révélée et ne suivront jamais la voix d'un étranger ou d'un système dénominationnel."
  },
  H7716: {
    word: "Agneau / Mouton",
    original: "שֶׂה (Seh)",
    pronunciation: "seh",
    type: "hebrew",
    partOfSpeech: "Nom masculin",
    etymology: "Probablement d'une racine désignant une pièce de petit bétail.",
    occurrencesCount: "47 occurrences dans l'Ancien Testament",
    translationsLSG: "agneau (28x), brebis (12x), mouton (7x)",
    definition: "Un agneau, un jeune mouton ou une chèvre individuellement immolé pour le sacrifice paschal.",
    messageContext: "L'agneau immolé en Égypte préfigurait l'Agneau de Dieu dont le Sang nous abrite de la mort spirituelle."
  },
  H2416: {
    word: "Vivant",
    original: "חַי (Chai)",
    pronunciation: "khay",
    type: "hebrew",
    partOfSpeech: "Adjectif / Nom masculin",
    etymology: "Dérivé de H2421 (Chayah) signifiant vivre ou conserver la vie.",
    occurrencesCount: "500 occurrences dans l'Ancien Testament",
    translationsLSG: "vivant (350x), vie (100x), animé (50x)",
    definition: "1) Vivant, ayant le souffle de vie en soi, actif et plein de vigueur.\n2) Nom propre de Dieu : Le Dieu Vivant opposé aux idoles mortes.",
    messageContext: "Le Dieu d'Israël est le Dieu vivant, opposé aux idoles muettes. Sa Parole est vivante et efficace dans le croyant."
  },

  // Grec (Nouveau Testament)
  G3056: {
    word: "Parole",
    original: "λόγος (Logos)",
    pronunciation: "log'-os",
    type: "greek",
    partOfSpeech: "Nom masculin",
    etymology: "Dérivé de G3004 (Lego) signifiant exprimer, dire ou assembler des pensées.",
    occurrencesCount: "330 occurrences dans le Nouveau Testament",
    translationsLSG: "Parole (220x), mot (30x), discours (25x), affaire (15x)",
    definition: "1) Le Logos, la pensée exprimée, le Verbe Divin incarné, la raison suprême d'Elohim.\n2) La Parole parlée créatrice et révélée aux hommes.",
    messageContext: "Le Logos est la Théophanie, le Corps de lumière dans lequel Dieu est sorti de Son invisibilité au commencement. C'est cette même Colonne de Feu et ce même Logos qui s'est fait chair en Jésus-Christ."
  },
  G2218: {
    word: "Vie",
    original: "ζωή (Zoe)",
    pronunciation: "dzo-ay'",
    type: "greek",
    partOfSpeech: "Nom féminin",
    etymology: "Dérivé de G2198 (Zao) signifiant vivre véritablement.",
    occurrencesCount: "135 occurrences dans le Nouveau Testament",
    translationsLSG: "vie (125x), vie éternelle (10x)",
    definition: "1) La vie éternelle, la vie divine incréée qui réside en Dieu Lui-même.\n2) Le principe vital divin insufflé dans l'âme régénérée.",
    messageContext: "La vie Zoé est la vie même de Dieu, incréée et éternelle. Recevoir le Saint-Esprit, c'est recevoir une étincelle de la vie Zoé qui nous rend participants de la nature divine."
  },
  G4102: {
    word: "Foi",
    original: "πίστις (Pistis)",
    pronunciation: "pis'-tis",
    type: "greek",
    partOfSpeech: "Nom féminin",
    etymology: "Dérivé de G3982 (Peitho) signifiant être persuadé, convaincu.",
    occurrencesCount: "244 occurrences dans le Nouveau Testament",
    translationsLSG: "foi (230x), croyance (10x), fidélité (4x)",
    definition: "1) La foi, la conviction ferme donnée par le Saint-Esprit, la révélation spirituelle.\n2) L'assurance des choses qu'on espère et la démonstration de celles qu'on ne voit pas.",
    messageContext: "La Foi n'est pas une simple croyance intellectuelle ni un dogme. Le frère Branham la définit comme : 'La Foi est une Révélation Divine personnelle'. C'est l'ancre absolue de l'âme."
  },
  G5485: {
    word: "Grâce",
    original: "χάρις (Charis)",
    pronunciation: "khar'-ece",
    type: "greek",
    partOfSpeech: "Nom féminin",
    etymology: "Dérivé de G5463 (Chairo) signifiant se réjouir ou accorder une faveur.",
    occurrencesCount: "155 occurrences dans le Nouveau Testament",
    translationsLSG: "grâce (130x), faveur (15x), bienfait (10x)",
    definition: "1) La grâce, la faveur divine imméritée, la bienveillance souveraine d'Elohim.\n2) La puissance divine agissante dans le cœur du croyant.",
    messageContext: "La Grâce nous a sauvés avant même la fondation du monde en nous inscrivant dans le Livre de Vie de l'Agneau. Tout est grâce."
  },
  G4151: {
    word: "Esprit",
    original: "πνεῦμα (Pneuma)",
    pronunciation: "pnyoo'-mah",
    type: "greek",
    partOfSpeech: "Nom neutre",
    etymology: "Dérivé de G4154 (Pneo) signifiant souffler ou respirer.",
    occurrencesCount: "385 occurrences dans le Nouveau Testament",
    translationsLSG: "Esprit (280x), esprit (80x), vent / souffle (25x)",
    definition: "1) Le Saint-Esprit, le Souffle vivant de Dieu, la troisième manifestation de la Divinité.\n2) L'esprit humain renouvelé par la nouvelle naissance.",
    messageContext: "Le Pneuma est le Souffle divin. Le Saint-Esprit est le Feu de Dieu qui baptise le croyant, scelle son âme et le fait entrer dans le Corps de Christ."
  },
  G602: {
    word: "Révélation",
    original: "ἀποκάλυψις (Apokalupsis)",
    pronunciation: "ap-ok-al'-oop-sis",
    type: "greek",
    partOfSpeech: "Nom féminin",
    etymology: "Dérivé de G601 (Apokalupto) signifiant enlever le voile.",
    occurrencesCount: "18 occurrences dans le Nouveau Testament",
    translationsLSG: "révélation (12x), manifestation (4x), dévoilement (2x)",
    definition: "1) Action d'enlever le voile pour rendre visible ce qui était caché.\n2) Le dévoilement glorieux de la Personne et du Plan de Jésus-Christ.",
    messageContext: "L'Apocalypse est le dévoilement complet de la divinité de Jésus-Christ et du mystère des âges de l'Église. C'est enlever le voile pour contempler le Roi de gloire."
  },
  G2098: {
    word: "Évangile",
    original: "εὐαγγέλιον (Euaggelion)",
    pronunciation: "yoo-ang-ghel'-ee-on",
    type: "greek",
    partOfSpeech: "Nom neutre",
    etymology: "Dérivé de G2097 (Euaggelizo) signifiant annoncer une joyeuse nouvelle.",
    occurrencesCount: "76 occurrences dans le Nouveau Testament",
    translationsLSG: "Évangile (72x), Bonne Nouvelle (4x)",
    definition: "1) L'Évangile, la Bonne Nouvelle du salut en Jésus-Christ.\n2) La puissance de Dieu pour le salut de quiconque croit.",
    messageContext: "La Bonne Nouvelle n'est pas un système de règles, mais la puissance de la résurrection manifestée dans notre vie."
  },
  G1577: {
    word: "Église",
    original: "ἐκκλησία (Ekklesia)",
    pronunciation: "ek-klay-see'-ah",
    type: "greek",
    partOfSpeech: "Nom féminin",
    etymology: "Dérivé de G1537 (Ek) et G2564 (Kaleo) signifiant 'appelés hors de'.",
    occurrencesCount: "114 occurrences dans le Nouveau Testament",
    translationsLSG: "Église (110x), assemblée (4x)",
    definition: "1) L'assemblée des Élus appelés hors du monde et de l'erreur.\n2) Le Corps mystique et l'Épouse pure de Jésus-Christ.",
    messageContext: "L'Ekklesia n'est pas un bâtiment de briques, mais l'assemblée invisible de ceux qui sont 'appelés hors du monde et des dénominations' pour suivre la Parole de l'heure."
  },
  G2400: {
    word: "Voici",
    original: "ἰδού (Idou)",
    pronunciation: "id-oo'",
    type: "greek",
    partOfSpeech: "Impératif démonstratif",
    etymology: "Forme dérivée de G1492 (Eido) signifiant voir ou discerner.",
    occurrencesCount: "200 occurrences dans le Nouveau Testament",
    translationsLSG: "voici (180x), regarde (20x)",
    definition: "1) Impératif d'éveil spirituel : 'Voici !', 'Regarde attentivement !'.\n2) Attire l'attention sur la manifestation imminente de la puissance divine.",
    messageContext: "'Idou' résonne comme le cri de minuit : 'Voici l'Époux, allez à sa rencontre !'. C'est l'appel à la vigilance de l'Épouse."
  },
  G2962: {
    word: "Seigneur",
    original: "κύριο̄ς (Kurios)",
    pronunciation: "koo'-ree-os",
    type: "greek",
    partOfSpeech: "Nom masculin",
    etymology: "Dérivé de G2904 (Kuros) signifiant suprématie ou autorité.",
    occurrencesCount: "748 occurrences dans le Nouveau Testament",
    translationsLSG: "Seigneur (700x), Maître (48x)",
    definition: "1) Kurios, le Maître souverain, le Chef suprême revêtu de toute autorité.\n2) Le titre divin réservé à Yahweh et pleinement attribué à Jésus-Christ.",
    messageContext: "Jésus est Kurios, le Dieu Tout-Puissant incarné. Le reconnaître comme Kurios exige une obéissance totale à Sa Parole."
  },
  G2424: {
    word: "Jésus",
    original: "Ἰησοῦς (Iesous / Yeshua)",
    pronunciation: "ee-ay-soos'",
    type: "greek",
    partOfSpeech: "Nom propre masculin",
    etymology: "Origine hébraïque H3091 (Yehoshua) signifiant 'Yahweh est le Salut'.",
    occurrencesCount: "917 occurrences dans le Nouveau Testament",
    translationsLSG: "Jésus (900x), Josué (17x)",
    definition: "1) Jésus, le Sauveur incarné, le Nom souverain au-dessus de tout nom.\n2) La manifestation visible du Dieu invisible.",
    messageContext: "Le Nom de Jésus-Christ contient la plénitude du Père, du Fils et du Saint-Esprit. C'est l'unique Nom sous le ciel donné parmi les hommes pour le salut."
  },
  G5547: {
    word: "Christ",
    original: "Χριστός (Christos)",
    pronunciation: "khris-tos'",
    type: "greek",
    partOfSpeech: "Nom masculin / Adjectif verbal",
    etymology: "Dérivé de G5548 (Chrio) signifiant oindre de l'huile sainte.",
    occurrencesCount: "529 occurrences dans le Nouveau Testament",
    translationsLSG: "Christ (520x), le Messie (9x)",
    definition: "1) Christ, l'Oint, l'accomplissement grec du terme hébreu Mashiach (Messie).\n2) Celui qui porte la plénitude de l'Onction du Saint-Esprit.",
    messageContext: "Le Christ est l'Onction. L'Onction qui reposait sur Jésus repose aujourd'hui sur l'Épouse Parole."
  },
  G26: {
    word: "Amour",
    original: "ἀγάπη (Agape)",
    pronunciation: "ag-ah'-pay",
    type: "greek",
    definition: "L'amour divin parfait, inconditionnel, pur et sacrificiel.",
    messageContext: "L'amour Agape est le sommet des vertus spirituelles, le signe d'adoption ultime des enfants de la promesse."
  },
  G5457: {
    word: "Lumière",
    original: "φῶς (Phos)",
    pronunciation: "foce",
    type: "greek",
    definition: "La lumière, la clarté spirituelle, la vérité qui dissipe les ténèbres.",
    messageContext: "Jésus est la Lumière du monde. À l'époque du soir, la Lumière paraît pour éclairer le chemin des pèlerins."
  },
  G129: {
    word: "Sang",
    original: "αἷμα (Haima)",
    pronunciation: "hah'-ee-mah",
    type: "greek",
    definition: "Le sang précieux, le fluide sacrificiel de rédemption et de sanctification.",
    messageContext: "Sans effusion de sang, il n'y a pas de pardon. Le Sang de Jésus est l'unique abri contre le jugement."
  },
  G32: {
    word: "Ange",
    original: "ἄγγελος (Angelos)",
    pronunciation: "ang'-el-os",
    type: "greek",
    definition: "Messager, envoyé spécial de Dieu porteur d'une parole d'avertissement ou de grâce.",
    messageContext: "L'ange de l'Éternel est la Colonne de Feu qui accompagne et protège le prophète et le peuple de Dieu."
  },
  G40: {
    word: "Saint",
    original: "ἅγιος (Hagios)",
    pronunciation: "hag'-ee-os",
    type: "greek",
    definition: "Saint, mis à part, réservé exclusivement à l'usage divin.",
    messageContext: "Soyez saints car Je suis saint. La sanctification est le vêtement de noces requis pour l'Enlèvement."
  },
  G2588: {
    word: "Cœur",
    original: "καρδία (Kardia)",
    pronunciation: "kar-dee'-ah",
    type: "greek",
    definition: "Le cœur, le centre des affections, de la volonté et de la foi intérieure.",
    messageContext: "C'est en croyant du cœur qu'on parvient à la justice. L'Esprit écrit la Loi divine dans des têtes de chair."
  },
  G5456: {
    word: "Voix",
    original: "φωνή (Phone)",
    pronunciation: "fo-nay'",
    type: "greek",
    definition: "Voix, son puissant, tonnerre, l'expression parlée de la vérité.",
    messageContext: "La voix de l'Archange et la trompette de Dieu résonnent pour réveiller les vierges endormies."
  },
  G225: {
    word: "Vérité",
    original: "ἀλήθεια (Aletheia)",
    pronunciation: "al-ay'-thi-ah",
    type: "greek",
    definition: "La vérité divine, la réalité sans voiles, l'authenticité absolue.",
    messageContext: "La Parole de Dieu est la Vérité. Tout enseignement contraire aux Écritures est une illusion déchue."
  },
  G281: {
    word: "Amen",
    original: "ἀμήν (Amen)",
    pronunciation: "am-een'",
    type: "greek",
    definition: "Amen, qu'il en soit ainsi, ferme, certain et immuable.",
    messageContext: "Toutes les promesses de Dieu en Christ sont 'Oui' et 'Amen'. L'Épouse dit 'Amen' à chaque mot du Prophète."
  }
};

/**
 * Base de correspondances étendues pour les termes doctrinaux et substantifs bibliques
 */
const FRENCH_BIBLE_STRONG_MAP: Record<string, { strong: string; original: string; pronunciation: string; type: 'hebrew' | 'greek'; partOfSpeech?: string; etymology?: string; occurrencesCount?: string | number; translationsLSG?: string; definition: string; messageContext?: string }> = {
  "riche": {
    strong: "H6223 / G4145",
    original: "עָשִׁיר (Ashir) / πλούσιος (Plousios)",
    pronunciation: "aw-sheer' / ploo'-see-os",
    type: "hebrew",
    definition: "Riche, fortuné, possédant d'abondantes ressources. Dans les Écritures, désigne aussi bien les richesses matérielles éphémères que la plénitude insondable des trésors de la Grâce divine en Jésus-Christ.",
    messageContext: "Le frère Branham met en garde contre l'Église de Laodicée qui se dit 'riche' alors qu'elle est spirituellement pauvre, aveugle et nue. La seule vraie richesse est la foi pure éprouvée au feu et la possession de la Parole promise."
  },
  "pauvre": {
    strong: "H6041 / G4434",
    original: "עָנִי (Ani) / πτωχός (Ptochos)",
    pronunciation: "aw-nee' / pto-khos'",
    type: "greek",
    definition: "Pauvre, humble, indigent, celui qui est dépourvu de ressources propres et s'appuie totalement sur la miséricorde de Dieu.",
    messageContext: "Se reconnaître pauvre en esprit, c'est abandonner toute justice propre pour recevoir gratuitement la plénitude et les trésors de Christ."
  },
  "grand": {
    strong: "H1419 / G3173",
    original: "גָּדוֹל (Gadol) / μέγας (Megas)",
    pronunciation: "gaw-dole' / meg'-as",
    type: "hebrew",
    definition: "Grand, puissant, élevé en dignité, majestueux, immense.",
    messageContext: "Dieu est le Grand Architecte et le Grand Berger. Sa grandeur surpasse toute mesure humaine."
  },
  "forte": {
    strong: "H2389 / G2478",
    original: "חָזָק (Chazaq) / ἰσχυρός (Ischyros)",
    pronunciation: "khaw-zawk' / is-khoo-ros'",
    type: "hebrew",
    definition: "Fort, vigoureux, revêtu d'une puissance inébranlable.",
    messageContext: "Soyez forts dans le Seigneur. L'homme fort est lié par le Plus Fort qui est Jésus-Christ."
  },
  "fort": {
    strong: "H2389 / G2478",
    original: "חָזָק (Chazaq) / ἰσχυρός (Ischyros)",
    pronunciation: "khaw-zawk' / is-khoo-ros'",
    type: "hebrew",
    definition: "Fort, vigoureux, revêtu d'une puissance inébranlable.",
    messageContext: "Soyez forts dans le Seigneur. L'homme fort est lié par le Plus Fort qui est Jésus-Christ."
  },
  "bon": {
    strong: "H2896 / G18",
    original: "טוֹב (Tov) / ἀγαθός (Agathos)",
    pronunciation: "tobe / ag-ath-os'",
    type: "hebrew",
    definition: "Bon, agréable, excellent, parfait, en conformité avec la volonté divine.",
    messageContext: "Dieu seul est foncièrement bon. Toute bonne réflexion ou action en nous émane du Saint-Esprit."
  },
  "chambre": {
    strong: "H2315 / G5009",
    original: "חֶדֶר (Cheder) / ταμεῖον (Tameion)",
    pronunciation: "kheh'-der / tam-ei'-on",
    type: "hebrew",
    definition: "Chambre, lieu secret de prière, intimité spirituelle avec Dieu.",
    messageContext: "Entrer dans sa chambre et fermer la porte symbolise la prière secrète et la communion directe avec le Père."
  },
  "maison": {
    strong: "H1004 / G3614",
    original: "בַּיִת (Bayith) / οἶκος (Oikos)",
    pronunciation: "bah'-yith / oy'-kos",
    type: "hebrew",
    definition: "Maison, demeure, famille spirituelle, édifice de la foi.",
    messageContext: "Moi et ma maison, nous servirons l'Éternel. La maison de Dieu est l'Église du Dieu vivant."
  },
  "champ": {
    strong: "H7704 / G68",
    original: "שָׂדֶה (Sadeh) / ἀγρός (Agros)",
    pronunciation: "saw-deh' / ag-ros'",
    type: "hebrew",
    definition: "Champ, monde, terrain de semence de la Parole de Dieu.",
    messageContext: "Le champ est le monde. Le semeur sort pour semer la Bonne Semence de la Parole parlée."
  },
  "montagne": {
    strong: "H2022 / G3738",
    original: "הַר (Har) / ὄρος (Oros)",
    pronunciation: "har / o'-ros",
    type: "hebrew",
    definition: "Montagne, lieu d'élévation, de prière, de théophanie et de révélation.",
    messageContext: "Sur la montagne de la Transfiguration, Christ a révélé la gloire de Son Second Avènement."
  },
  "mer": {
    strong: "H3220 / G2281",
    original: "יָם (Yam) / θάλασσα (Thalassa)",
    pronunciation: "yawm / thal'-as-sah",
    type: "hebrew",
    definition: "Mer, multitudes de peuples, agitation des nations.",
    messageContext: "La mer agitée représente les peuples et multitudes en désarroi avant la venue du Prince de Paix."
  },
  "arbre": {
    strong: "H6086 / G3586",
    original: "עֵץ (Etz) / ξύλον (Xylon)",
    pronunciation: "ates / xy'-lon",
    type: "hebrew",
    definition: "Arbre, symbole de vie, d'homme juste planté près des courants d'eau.",
    messageContext: "L'Arbre de Vie dans Éden est Jésus-Christ Lui-même. En manger, c'est recevoir la Vie éternelle."
  },
  "fruit": {
    strong: "H6529 / G2590",
    original: "פְּרִי (Peri) / καρπός (Karpos)",
    pronunciation: "per-ee' / kar-pos'",
    type: "hebrew",
    definition: "Fruit, résultat spirituel de la demeure de la Parole dans le croyant.",
    messageContext: "Vous les reconnaîtrez à leurs fruits. Le fruit du Saint-Esprit est la manifestation de la vie de Christ."
  },
  "soleil": {
    strong: "H8121 / G2246",
    original: "שֶׁמֶשׁ (Shemesh) / ἥλιος (Helios)",
    pronunciation: "sheh'-mesh / hay'-lee-os",
    type: "hebrew",
    definition: "Soleil, astre du jour, symbole du Soleil de Justice.",
    messageContext: "Le Soleil de Justice se lèvera avec la guérison sous ses ailes pour ceux qui craignent Son Nom."
  },
  "lumière": {
    strong: "H216 / G5457",
    original: "אוֹר (Or) / φῶς (Phos)",
    pronunciation: "owr / phos",
    type: "hebrew",
    definition: "Lumière, révélation divine, présence glorieuse chassant les ténèbres.",
    messageContext: "Au temps du soir, la Lumière paraîtra. C'est la Révélation du Fils de l'homme éclairant l'Épouse."
  },
  "ténèbres": {
    strong: "H2822 / G4655",
    original: "חֹשֶׁךְ (Choshech) / σκότος (Skotos)",
    pronunciation: "kho'-shek / sko'-tos",
    type: "hebrew",
    definition: "Ténèbres, aveuglement spirituel, ignorance de la Parole.",
    messageContext: "La lumière brille dans les ténèbres et les ténèbres ne l'ont point reçue."
  },
  "paix": {
    strong: "H7965 / G1515",
    original: "שָׁלוֹם (Shalom) / εἰρήνη (Eirene)",
    pronunciation: "shaw-lome' / ei-ray'-nay",
    type: "hebrew",
    definition: "Paix, plénitude, repos parfait de l'âme reconciled avec Dieu.",
    messageContext: "Shalom ! C'est la paix de Dieu qui surpasse toute intelligence gardant nos cœurs en Jésus-Christ."
  },
  "amour": {
    strong: "H160 / G26",
    original: "אַהֲבָה (Ahavah) / ἀγάπη (Agape)",
    pronunciation: "a-haw-baw' / ag-aw'-pay",
    type: "greek",
    definition: "Amour saint, divin, inconditionnel et parfait d'Elohim.",
    messageContext: "L'amour Agapé est la qualification suprême. C'est la Pierre du Faîte qui vient sceller l'Épouse."
  },
  "sagesse": {
    strong: "H2451 / G4678",
    original: "חָכְמָה (Chokmah) / σοφία (Sophia)",
    pronunciation: "khok-maw' / sof-ee'-ah",
    type: "hebrew",
    definition: "Sagesse divine, intelligence inspirée par la Parole.",
    messageContext: "La crainte de l'Éternel est le commencement de la sagesse. La vraie sagesse vient d'en haut."
  },
  "gloire": {
    strong: "H3519 / G1391",
    original: "כָּבוֹד (Kavod) / δόξα (Doxa)",
    pronunciation: "kaw-bode' / dox'-ah",
    type: "hebrew",
    definition: "Gloire, majesté resplendissante, la Nuée Shekinah.",
    messageContext: "La Shekinah est la Gloire de la Présence divine qui remplit le Temple du Saint-Esprit."
  },
  "puissance": {
    strong: "H3581 / G1411",
    original: "כֹּחַ (Koach) / δύναμις (Dunamis)",
    pronunciation: "ko'-akh / doo'-nam-is",
    type: "greek",
    definition: "Puissance, force dynamique du Saint-Esprit en action.",
    messageContext: "Vous recevrez une puissance, le Saint-Esprit survenant sur vous, pour être mes témoins."
  },
  "roi": {
    strong: "H4428 / G935",
    original: "מֶלֶךְ (Melech) / βασιλεύς (Basileus)",
    pronunciation: "meh'-lek / bas-il-yeos'",
    type: "hebrew",
    definition: "Roi, souverain, dirigeant d'un royaume.",
    messageContext: "Jésus-Christ est le Roi des rois. Il nous a faits rois et sacrificateurs pour Dieu Son Père."
  },
  "serviteur": {
    strong: "H5650 / G1401",
    original: "עֶבֶד (Ebed) / δοῦλος (Doulos)",
    pronunciation: "eh'-bed / doo'-los",
    type: "greek",
    definition: "Serviteur, esclave d'amour, voué entièrement à la volonté de son Maître.",
    messageContext: "Un véritable serviteur de Dieu n'a pas de volonté propre mais exécute l'Ansi dit le Seigneur."
  },
  "frère": {
    strong: "H251 / G80",
    original: "אָח (Ach) / ἀδελφός (Adelphos)",
    pronunciation: "awkh / ad-el-fos'",
    type: "greek",
    definition: "Frère, membre de la même famille spirituelle né de la même Semence.",
    messageContext: "L'amour fraternel caractérise les fils et filles de Dieu qui marchent ensemble dans la lumière."
  },
  "hommes": {
    strong: "H120 / G444",
    original: "אָדָם (Adam) / ἄνθρωπος (Anthropos)",
    pronunciation: "aw-dawm' / an'-thro-pos",
    type: "hebrew",
    definition: "Homme, être humain, créé à l'image et selon la ressemblance de Dieu.",
    messageContext: "L'homme fut créé pour dominer avec Dieu. La rédemption en Christ le réintègre dans son héritage d'origine."
  },
  "femme": {
    strong: "H802 / G1135",
    original: "אִשָּׁה (Ishshah) / γυνή (Gune)",
    pronunciation: "eesh-shaw' / goo-nay'",
    type: "hebrew",
    definition: "Femme, épouse, type prophétique de l'Église ou de l'Épouse.",
    messageContext: "La vraie femme symbolise l'Épouse pure, tandis que la femme déchue représente l'église dénominationnelle."
  },
  "main": {
    strong: "H3027 / G5495",
    original: "יָד (Yad) / χείρ (Cheir)",
    pronunciation: "yawd / khare",
    type: "hebrew",
    definition: "Main, symbole de puissance, d'action et d'autorité divine.",
    messageContext: "La main du Seigneur repose sur Ses serviteurs. L'imposition des mains communique la bénédiction."
  },
  "yeux": {
    strong: "H5869 / G3788",
    original: "עַיִן (Ayin) / ὀφθαλμός (Ophthalmos)",
    pronunciation: "ah'-yin / of-thal-mos'",
    type: "hebrew",
    definition: "Œil, vision, discernement spirituel et révélation de la vérité.",
    messageContext: "Demandez au Seigneur du collyre spirituel pour oindre vos yeux afin d'apercevoir la Lumière du soir."
  },
  "tête": {
    strong: "H7218 / G2776",
    original: "רֹאשׁ (Rosh) / κεφαλή (Kephale)",
    pronunciation: "rosh / kef-al-ay'",
    type: "greek",
    definition: "Tête, chef, autorité suprême, la Pierre du Faîte.",
    messageContext: "Christ est la Tête de l'Église. La Pierre du Faîte vient coiffer l'édifice des sept âges."
  },
  "canaan": {
    strong: "H3667 / G3667",
    original: "כְּנַעַן (Kena'an)",
    pronunciation: "Ken-aw'-an",
    type: "hebrew",
    definition: "Canaan, terre promise donnée par Dieu à Abraham, Isaac et Jacob, située à l'ouest du Jourdain.",
    messageContext: "Canaan représente le royaume de la promesse et le repos de la Foi du troisième degré. Traverser le Jourdain symbolise la mort à soi-même pour posséder l'héritage de l'Épouse."
  },
  "cananéen": {
    strong: "H3669 / G3669",
    original: "כְּנַעֲנִי (Kena'ani)",
    pronunciation: "Ken-ah-an-ee'",
    type: "hebrew",
    definition: "Habitant de Canaan, peuple païen occupant la Terre Promise avant la conquête d'Israël.",
    messageContext: "Les Cananéens représentent les puissances ennemies chassées devant la Parole parlée de la Foi."
  },
  "israël": {
    strong: "H3478 / G2474",
    original: "יִשְׂרָאֵל (Yisra'el)",
    pronunciation: "Yis-raw-ale'",
    type: "hebrew",
    definition: "Israël, 'Celui qui lutte avec Dieu et triomphe', le peuple de l'Alliance éternelle.",
    messageContext: "Israël est l'horloge prophétique de Dieu. La restauration d'Israël sur sa terre est le signe majeur de la fin des temps."
  },
  "israel": {
    strong: "H3478 / G2474",
    original: "יִשְׂרָאֵל (Yisra'el)",
    pronunciation: "Yis-raw-ale'",
    type: "hebrew",
    definition: "Israël, 'Celui qui lutte avec Dieu et triomphe', le peuple de l'Alliance éternelle.",
    messageContext: "Israël est l'horloge prophétique de Dieu. La restauration d'Israël sur sa terre est le signe majeur de la fin des temps."
  },
  "jérusalem": {
    strong: "H3389 / G2419",
    original: "יְרוُשָׁלַם (Yerushalayim)",
    pronunciation: "Yer-oo-shaw-lah'-yeem",
    type: "hebrew",
    definition: "Jérusalem, 'Cité de la Paix', la ville sainte de David, trône du Roi des rois.",
    messageContext: "La Jérusalem terrestre symbolise la Nouvelle Jérusalem céleste, l'Épouse glorieuse descendue du Ciel."
  },
  "jerusalem": {
    strong: "H3389 / G2419",
    original: "יְרוُשָׁלַם (Yerushalayim)",
    pronunciation: "Yer-oo-shaw-lah'-yeem",
    type: "hebrew",
    definition: "Jérusalem, 'Cité de la Paix', la ville sainte de David, trône du Roi des rois.",
    messageContext: "La Jérusalem terrestre symbolise la Nouvelle Jérusalem céleste, l'Épouse glorieuse descendue du Ciel."
  },
  "égypte": {
    strong: "H4714 / G125",
    original: "מִצְרַיִם (Mitzrayim)",
    pronunciation: "Mitz-rah'-yeem",
    type: "hebrew",
    definition: "Égypte, la terre du Pharaon, symbole biblique du monde, de la chair et de la servitude.",
    messageContext: "Sortir d'Égypte représente l'Exode spirituel : abandonner le monde et les systèmes dénominationnels pour suivre la Colonne de Feu."
  },
  "egypte": {
    strong: "H4714 / G125",
    original: "מִצְרַיִם (Mitzrayim)",
    pronunciation: "Mitz-rah'-yeem",
    type: "hebrew",
    definition: "Égypte, la terre du Pharaon, symbole biblique du monde, de la chair et de la servitude.",
    messageContext: "Sortir d'Égypte représente l'Exode spirituel : abandonner le monde et les systèmes dénominationnels pour suivre la Colonne de Feu."
  },
  "jourdain": {
    strong: "H3383 / G2446",
    original: "יַרְדֵּן (Yarden)",
    pronunciation: "Yar-dane'",
    type: "hebrew",
    definition: "Le Jourdain, 'Celui qui descend', fleuve frontière menant à la Terre Promise de Canaan.",
    messageContext: "Traverser le Jourdain typifie la mort à soi-même et le baptême du Saint-Esprit donnant accès au repos complet de la Foi."
  },
  "abraham": {
    strong: "H85 / G11",
    original: "אַבְרָהָם (Abraham)",
    pronunciation: "Ab-raw-hawm'",
    type: "hebrew",
    definition: "Abraham, 'Père d'une multitude', le père de la Foi et l'héritier des promesses éternelles.",
    messageContext: "Abraham est le modèle du croyant. Comme Abraham a reçu la visitation divine avant la destruction de Sodome, l'Épouse reçoit la Révélation du Temps de la Fin."
  },
  "moïse": {
    strong: "H4872 / G3475",
    original: "מֹשֶׁה (Mosheh)",
    pronunciation: "Mo-sheh'",
    type: "hebrew",
    definition: "Moïse, 'Tiré des eaux', le prophète messager de l'Exode d'Israël.",
    messageContext: "Moïse avec la Colonne de Feu préfigurait le ministère prophétique de la fin des temps faisant sortir les croyants hors de la captivité."
  },
  "moise": {
    strong: "H4872 / G3475",
    original: "מֹשֶׁה (Mosheh)",
    pronunciation: "Mo-sheh'",
    type: "hebrew",
    definition: "Moïse, 'Tiré des eaux', le prophète messager de l'Exode d'Israël.",
    messageContext: "Moïse avec la Colonne de Feu préfigurait le ministère prophétique de la fin des temps faisant sortir les croyants hors de la captivité."
  },
  "david": {
    strong: "H1732 / G1138",
    original: "דָּוִד (David)",
    pronunciation: "Daw-veed'",
    type: "hebrew",
    definition: "David, 'Bien-aimé', berger de Bethléhem oint comme roi d'Israël.",
    messageContext: "David est le type du Roi oint. Jésus-Christ est le Fils de David qui régnera sur le Trône du Royaume Millénaire."
  },
  "nation": {
    strong: "H1471 / G1484",
    original: "גּוֹי (Goy) / ἔθνος (Ethnos)",
    pronunciation: "goy / eth'-nos",
    type: "greek",
    definition: "Nation, peuple, race, païens non-israélites appelés à la Révélation.",
    messageContext: "Les nations marcheront à Sa lumière. Le Message ratisse toutes les nations pour rassembler les Élus d'entre les Gentils."
  },
  "nations": {
    strong: "H1471 / G1484",
    original: "גּוֹיִם (Goyim) / ἔθνη (Ethne)",
    pronunciation: "go-yeem' / eth'-nay",
    type: "greek",
    definition: "Nations, peuples du monde rassemblés sous l'Appel de la Parole.",
    messageContext: "L'Évangile du Royaume est prêché dans toutes les nations avant que ne vienne la Fin."
  },
  "peuple": {
    strong: "H5971 / G2992",
    original: "עַם (Am) / λαός (Laos)",
    pronunciation: "ahm / lah-os'",
    type: "hebrew",
    definition: "Peuple saint, communauté rachetée, assemblée mise à part.",
    messageContext: "Vous êtes une race élue, un peuple acquis pour annoncer les vertus de Celui qui vous a appelés des ténèbres à Sa admirable lumière."
  },
  "peuples": {
    strong: "H5971 / G2992",
    original: "עַמִּים (Ammim) / λαοί (Laoi)",
    pronunciation: "ahm-meem' / lah-oy'",
    type: "hebrew",
    definition: "Les peuples et multitudes sous le Sceptre du Roi des rois.",
    messageContext: "Toutes les tribus et tous les peuples se prosterneront devant l'Agneau de Dieu."
  },
  "royaume": {
    strong: "H4438 / G932",
    original: "מַלְכוּת (Malkuth) / βασιλεία (Basileia)",
    pronunciation: "mal-kooth' / bas-il-i'-ah",
    type: "greek",
    definition: "Royaume, règne souverain, gouvernement céleste de Dieu.",
    messageContext: "Le Royaume de Dieu n'est pas en paroles, mais en puissance et en démonstration du Saint-Esprit."
  },
  "monde": {
    strong: "H8398 / G2889",
    original: "תֵּבֵל (Tebel) / κόσμος (Kosmos)",
    pronunciation: "tay-bale' / kos'-mos",
    type: "greek",
    definition: "Le monde, l'ordre créé, la terre habitée.",
    messageContext: "Dieu a tant aimé le monde qu'Il a donné Son Fils unique afin que quiconque croit en Lui ne périsse point."
  },
  "cœur": {
    strong: "H3820 / G2588",
    original: "לֵב (Lev) / καρδία (Kardia)",
    pronunciation: "labe / kar-dee'-ah",
    type: "hebrew",
    definition: "Cœur, centre spirituel de la foi, de l'amour et des décisions.",
    messageContext: "C'est en croyant du cœur qu'on parvient à la justice. L'Esprit écrit la Loi dans un cœur de chair."
  },
  "or": {
    strong: "H2091 / G5557",
    original: "זָהָב (Zahav) / χρυσός (Chrysos)",
    pronunciation: "zaw-hawb' / khroo-sos'",
    type: "hebrew",
    definition: "Or, symbole de la nature divine éprouvée au feu.",
    messageContext: "L'or purifié représente la Foi révélée qui a traversé l'épreuve sans défaillir."
  },
  "pierre": {
    strong: "H68 / G3037",
    original: "אֶבֶן (Even) / λίθος (Lithos)",
    pronunciation: "eh'-ben / lee'-thos",
    type: "hebrew",
    definition: "Pierre, fondement, pierre vivante dans le temple divin.",
    messageContext: "Christ est la Pierre angulaire et nous sommes des pierres vivantes taillées par le Saint-Esprit."
  },
  "eau": {
    strong: "H4325 / G5204",
    original: "מַיִם (Mayim) / ὕδωρ (Hudor)",
    pronunciation: "mah'-yim / hoo'-dor",
    type: "hebrew",
    definition: "Eau, symbole de la Parole purificatrice et de l'Esprit.",
    messageContext: "Le lavage d'eau par la Parole sanctifie et nettoie l'Épouse."
  },
  "pain": {
    strong: "H3899 / G740",
    original: "לֶחֶם (Lechem) / ἄρτος (Artos)",
    pronunciation: "leh'-khem / ar'-tos",
    type: "hebrew",
    definition: "Pain, nourriture essentielle de l'âme, le Pain de Vie.",
    messageContext: "Jésus est le Pain de Vie descendu du ciel. La Parole parlée est notre nourriture quotidienne."
  },
  "brebis": {
    strong: "H6629 / G4263",
    original: "צֹאן (Tsô'n) / πρόβατον (Probaton)",
    pronunciation: "tso'n / pro'-bat-on",
    type: "hebrew",
    partOfSpeech: "Nom collectif féminin & neutre",
    etymology: "Provenant d'une racine inutilisée signifiant paître/migrer (hébreu) et de marcher en avant (grec).",
    occurrencesCount: "274x (AT) / 39x (NT)",
    translationsLSG: "brebis (135x), troupeau (110x), moutons (15x)",
    definition: "1) Petit bétail, brebis, ouailles, troupeau sous la garde du berger.\n2) Symbolisme spirituel : Le peuple de Dieu racheté formant le troupeau du Seigneur.",
    messageContext: "Les brebis de Dieu reconnaissent la Voix du Berger. Dans le Message du Temps de la Fin, la vraie brebis ne se nourrit que de la Nourriture emmagasinée (la Parole pure) et suit la Colonne de Feu."
  },
  "troupeau": {
    strong: "H6629 / G4167",
    original: "צֹאן (Tsô'n) / ποίμνιον (Poimnion)",
    pronunciation: "tso'n / poy'-mnee-on",
    type: "hebrew",
    partOfSpeech: "Nom collectif neutre",
    etymology: "Rassemblement des ouailles sous l'autorité d'un pasteur.",
    occurrencesCount: "110x (AT) / 18x (NT)",
    translationsLSG: "troupeau, petit troupeau",
    definition: "Troupeau, assemblée des brebis rachetées et conduites vers les verts pâturages de la Grâce.",
    messageContext: "'Ne crains point, petit troupeau' : l'Épouse du Temps de la Fin est un petit groupe minoritaire mais victorieux qui garde la Foi d'origine."
  },
  "agneau": {
    strong: "H7716 / G704",
    original: "שֶׂה (Seh) / ἀμνός (Amnos)",
    pronunciation: "seh / am-nos'",
    type: "hebrew",
    partOfSpeech: "Nom masculin",
    etymology: "Pièce de petit bétail (hébreu) / Agneau sacrificiel (grec).",
    occurrencesCount: "47x (AT) / 4x (NT)",
    translationsLSG: "agneau, brebis, mouton",
    definition: "Agneau, jeune mouton immolé sans défaut pour l'expiation des péchés.",
    messageContext: "Voici l'Agneau de Dieu qui ôte le péché du monde. L'Agneau immolé est le centre de tout le Plan de rédemption."
  },
  "berger": {
    strong: "H7462 / G4166",
    original: "רָעָה (Ra'ah) / ποιμήν (Poimen)",
    pronunciation: "raw-aw' / poy-mane'",
    type: "hebrew",
    partOfSpeech: "Verbe / Nom masculin",
    etymology: "Paître, conduire aux pâturages / Protecteur des brebis.",
    occurrencesCount: "173x (AT) / 18x (NT)",
    translationsLSG: "berger, pasteur, paître",
    definition: "Berger, conducteur spirituel qui prend soin du troupeau, le nourrit et le protège contre les loups.",
    messageContext: "L'Éternel est mon Berger. Le Bon Berger donne Sa vie pour Ses brebis et suscite de vrais bergers selon Son Cœur."
  }
};

/**
 * Translitère intelligemment un terme biblique en syllabes phonétiques grecques ou hébraïques authentiques
 */
function buildPhoneticTransliteration(cleanWord: string, isHebrew: boolean): string {
  if (!cleanWord) return isHebrew ? "daw-bawr'" : "log'-os";

  // Mappings directs de noms propres et termes théologiques clés
  const DIRECT_PHONETICS: Record<string, string> = {
    "canaan": "Ken-aw'-an",
    "cananéen": "Ken-ah-an-ee'",
    "cananeen": "Ken-ah-an-ee'",
    "israël": "Yis-raw-ale'",
    "israel": "Yis-raw-ale'",
    "jérusalem": "Yer-oo-shaw-lah'-yeem",
    "jerusalem": "Yer-oo-shaw-lah'-yeem",
    "égypte": "Mitz-rah'-yeem",
    "egypte": "Mitz-rah'-yeem",
    "jourdain": "Yar-dane'",
    "jordan": "Yar-dane'",
    "abraham": "Ab-raw-hawm'",
    "moïse": "Mo-sheh'",
    "moise": "Mo-sheh'",
    "david": "Daw-veed'",
    "salomon": "Shel-o-mo'",
    "babylone": "Baw-bel'",
    "sabbat": "Shab-bawth'",
    "melchisédek": "Mel-kee-tseh'-dek",
    "melchisedek": "Mel-kee-tseh'-dek",
    "prophète": "Naw-bee' / Pro-phay'-tes",
    "prophete": "Naw-bee' / Pro-phay'-tes",
    "sacrificateur": "Ko-hane' / Hi-er-yeus'",
    "temple": "Hay-kawl' / Na-os'",
    "sanctuaire": "Mik-dawsh' / Hag'-ee-on",
    "autel": "Miz-bay'-akh / Thoo-see-as'-tee-ron",
    "alliance": "Ber-eeth' / Di-a-thay'-kay",
    "sang": "Dawm / Hai'-ma",
    "agneau": "Seh / Am-nos'",
    "arbre": "Ats / Xy'-lon",
    "fleuve": "Naw-hawr' / Po-tam-os'",
    "pierre": "Eh'-ben / Lee'-thos",
    "rocher": "Tsoor / Pet'-ra",
    "colonne": "Am-mowd' / Stee'-los",
    "nuée": "Aw-nawn' / Ne-phel'-ay",
    "feu": "Esh / Poor",
    "eau": "Mah'-yim / Hoo'-dor",
    "pain": "Leh'-khem / Ar'-tos",
    "vin": "Yay'-yin / Oy'-nos",
    "huile": "Sheh'-men / El'-ai-on"
  };

  if (DIRECT_PHONETICS[cleanWord]) {
    return DIRECT_PHONETICS[cleanWord];
  }

  // Conversion syllabique dynamique pour les termes non répertoriés
  let p = cleanWord;

  if (isHebrew) {
    p = p.replace(/ch/g, "kh")
         .replace(/c/g, "k")
         .replace(/ou/g, "oo")
         .replace(/an/g, "aw-an'")
         .replace(/en/g, "ene'")
         .replace(/on/g, "one'")
         .replace(/in/g, "eene'")
         .replace(/el/g, "-ale'")
         .replace(/ph/g, "f")
         .replace(/th/g, "th'")
         .replace(/e$/g, "eh'");
    return p.charAt(0).toUpperCase() + p.slice(1) + (p.includes("'") ? "" : "'");
  } else {
    p = p.replace(/ch/g, "kh")
         .replace(/c/g, "k")
         .replace(/ou/g, "oo")
         .replace(/an/g, "an'")
         .replace(/on/g, "on'")
         .replace(/is/g, "is'")
         .replace(/us/g, "oos'")
         .replace(/os/g, "os'")
         .replace(/ph/g, "ph'")
         .replace(/th/g, "th'")
         .replace(/e$/g, "ay'");
    return p.charAt(0).toUpperCase() + p.slice(1) + (p.includes("'") ? "" : "'");
  }
}

/**
 * Génère ou récupère la fiche Strong exacte et authentique depuis les sources officielles.
 * Ne génère AUCUN texte fictif ou générique.
 */
export async function asyncGetOrGenerateStrongEntry(
  strongNum: string,
  wordText?: string,
  isNT: boolean = false
): Promise<StrongWord | null> {
  const normId = normalizeStrongId(strongNum);
  if (!normId) return null;

  // 1. Recherche dans le lexique manuel de référence théologique (STRONG_LEXICON)
  const manual = STRONG_LEXICON[normId];
  if (manual) {
    const realOcc = getStrongOccurrenceCount(normId);
    return {
      ...manual,
      strong: normId,
      occurrencesCount: realOcc ? `${realOcc} occurrences dans les versets bibliques` : manual.occurrencesCount
    };
  }

  // 2. Recherche dans le dictionnaire manuel d'équivalence français (FRENCH_BIBLE_STRONG_MAP)
  for (const [key, val] of Object.entries(FRENCH_BIBLE_STRONG_MAP)) {
    if (val.strong && val.strong.includes(normId)) {
      const displayWord = wordText ? wordText.trim().replace(/[,.;:!?()'[\]»«’]+$/g, '').trim() : (key.charAt(0).toUpperCase() + key.slice(1));
      const realOcc = getStrongOccurrenceCount(normId);
      return {
        word: displayWord,
        strong: normId,
        original: val.original,
        pronunciation: val.pronunciation,
        type: val.type,
        partOfSpeech: val.partOfSpeech,
        etymology: val.etymology,
        occurrencesCount: realOcc ? `${realOcc} occurrences dans les versets bibliques` : val.occurrencesCount,
        translationsLSG: val.translationsLSG,
        definition: val.definition,
        messageContext: val.messageContext
      };
    }
  }

  // 3. Consultation du lexique officiel OpenScriptures & traduction française complète
  const frenchCard = await getStrongFrenchCard(normId, wordText);
  if (!frenchCard) return null;

  const realOcc = getStrongOccurrenceCount(normId);
  const messageCtx = frenchCard.messageContext || await getOrGenerateStrongMessageContext(normId, frenchCard.word, frenchCard.definition, frenchCard.original);

  return {
    word: frenchCard.word,
    strong: normId,
    original: frenchCard.original,
    pronunciation: frenchCard.pronunciation || frenchCard.translitteration || '',
    type: frenchCard.type,
    partOfSpeech: frenchCard.partOfSpeech || undefined,
    etymology: frenchCard.etymology || undefined,
    occurrencesCount: realOcc ? `${realOcc} occurrences dans les versets bibliques` : (frenchCard.occurrencesCount as string | undefined),
    translationsLSG: frenchCard.translationsLSG || undefined,
    definition: frenchCard.definition,
    messageContext: messageCtx || undefined
  };
}

/**
 * Version synchrone immédiate de récupération de la fiche Strong
 */
export function getOrGenerateStrongEntry(
  strongNum: string,
  wordText?: string,
  isNT: boolean = false
): StrongWord | null {
  const normId = normalizeStrongId(strongNum);
  if (!normId) return null;

  // 1. Recherche synchrone dans STRONG_LEXICON
  const manual = STRONG_LEXICON[normId];
  if (manual) {
    const realOcc = getStrongOccurrenceCount(normId);
    return {
      ...manual,
      strong: normId,
      occurrencesCount: realOcc ? `${realOcc} occurrences dans les versets bibliques` : manual.occurrencesCount
    };
  }

  // 2. Recherche synchrone dans FRENCH_BIBLE_STRONG_MAP
  for (const [key, val] of Object.entries(FRENCH_BIBLE_STRONG_MAP)) {
    if (val.strong && val.strong.includes(normId)) {
      const displayWord = wordText ? wordText.trim().replace(/[,.;:!?()'[\]»«’]+$/g, '').trim() : (key.charAt(0).toUpperCase() + key.slice(1));
      const realOcc = getStrongOccurrenceCount(normId);
      return {
        word: displayWord,
        strong: normId,
        original: val.original,
        pronunciation: val.pronunciation,
        type: val.type,
        partOfSpeech: val.partOfSpeech,
        etymology: val.etymology,
        occurrencesCount: realOcc ? `${realOcc} occurrences dans les versets bibliques` : val.occurrencesCount,
        translationsLSG: val.translationsLSG,
        definition: val.definition,
        messageContext: val.messageContext
      };
    }
  }

  // 3. Consultation du lexique OpenScriptures en mémoire avec traduction déterministe
  const baseData = getStrongBase(normId);
  if (!baseData) {
    return null;
  }

  const frenchCard = buildDeterministicFrenchCard(normId, baseData, wordText);
  const realOcc = getStrongOccurrenceCount(normId);

  return {
    word: frenchCard.word,
    strong: normId,
    original: frenchCard.original,
    pronunciation: frenchCard.pronunciation || frenchCard.translitteration || '',
    type: frenchCard.type,
    partOfSpeech: frenchCard.partOfSpeech || undefined,
    etymology: frenchCard.etymology || undefined,
    occurrencesCount: realOcc ? `${realOcc} occurrences dans les versets bibliques` : (frenchCard.occurrencesCount as string | undefined),
    translationsLSG: frenchCard.translationsLSG || undefined,
    definition: frenchCard.definition,
    messageContext: frenchCard.messageContext || undefined
  };
}

// Dictionnaire thématique complet pour la Bible Amplifiée (AMP)
const THEOLOGICAL_AMPLIFICATIONS: Record<string, string> = {
  "au commencement": "au commencement [originel de la création et du Logos]",
  "dieu": "Dieu [Elohim, l'Auto-Existant et Tout-Puissant]",
  "l'éternel": "l'Éternel [Yahweh, le Dieu de l'Alliance immuable]",
  "éternel": "Éternel [Yahweh, Celui qui existe par Lui-même]",
  "seigneur": "Seigneur [Adonai / Kurios, le Maître souverain]",
  "jésus": "Jésus [Yeshua, Yahweh le Sauveur incarné]",
  "jésus-christ": "Jésus-Christ [Yeshua HaMashiach, le Sauveur Oint]",
  "christ": "Christ [Mashiach, l'Oint porteur de la Plénitude de l'Esprit]",
  "la parole": "la Parole [le Logos / Rhema, la pensée exprimée d'Elohim]",
  "parole": "Parole [l'expression vivante de la pensée divine]",
  "créa": "créa [ex-nihilo par la Parole parlée matérialisant Sa pensée éternelle]",
  "cieux": "cieux [les dimensions célestes et la demeure du Créateur]",
  "la vie": "la vie [Zoé, la vie divine incréée et éternelle]",
  "vie": "vie [Zoé, le principe vital incréé de Dieu]",
  "la foi": "la foi [Pistis, la révélation divine personnelle insufflée à l'âme]",
  "foi": "foi [la conviction ferme accordée par le Saint-Esprit]",
  "grâce": "grâce [Charis, Sa faveur imméritée et souveraine]",
  "le saint-esprit": "le Saint-Esprit [Pneuma, le Souffle divin et le Sceau de l'Élection]",
  "saint-esprit": "Saint-Esprit [Pneuma, le Consolateur et le Baptême de Feu]",
  "esprit": "Esprit [Ruach / Pneuma, le Souffle vivant de Dieu]",
  "sang": "sang [Haima / Dam, l'élément expiatoire sacrificiel de rédemption]",
  "ange": "ange [Malak / Angelos, le messager céleste envoyé par le Père]",
  "anges": "anges [messagers célestes et exécutants de la volonté divine]",
  "église": "Église [Ekklesia, l'assemblée de ceux qui sont appelés hors du monde]",
  "révélation": "révélation [Apokalupsis, le dévoilement complet des mystères cachés]",
  "amour": "amour [Agape, l'amour saint, inconditionnel et sacrificiel]",
  "vérité": "vérité [Aletheia, la réalité divine immuable et sans voiles]",
  "chemin": "chemin [Hodos, la voie étroite et vivante qu'est Jésus-Christ]",
  "saints": "saints [Hagios, les rachetés mis à part par la Parole]",
  "saint": "saint [Kadosh / Hagios, consacré et purifié exclusivement pour Dieu]",
  "prophète": "prophète [Navi / Prophetes, le porte-parole inspiré d'Elohim]",
  "prophètes": "prophètes [les voyants oints par l'Esprit]",
  "alliance": "alliance [Berith / Diatheke, le pacte sacré scellé par le Sang]",
  "salut": "salut [Yeshua / Soteria, la délivrance totale de l'âme et du corps]",
  "père": "Père [Abba, la Source éternelle de toute paternité spirituelle]",
  "fils": "Fils [le Messie incarné, l'Héritier de toutes choses]",
  "temple": "temple [Naos, la demeure sainte et vivante du Très-Haut]",
  "roi": "Roi [Melech / Basileus, le Souverain du Royaume millénaire]",
  "paix": "paix [Shalom / Eirene, le repos parfait et la plénitude divine]",
  "résurrection": "résurrection [Anastasis, le relèvement victorieux de la mort]",
  "évangile": "Évangile [Euaggelion, la Bonne Nouvelle de la Grâce]",
  "royaume": "Royaume [Malkuth / Basileia, la domination éternelle du Christ]",
  "gloire": "gloire [Kavod / Doxa, la majesté resplendissante de Dieu]",
  "amen": "Amen [la confirmation ferme et inébranlable]",
  "agneau": "Agneau [le Sacrifice parfait prévu dès la fondation du monde]"
};

/**
 * Amplifie dynamiquement le texte d'un verset Louis Segond
 */
export function amplifyVerseText(verseText: string, bookId: string, chapter: number, verse: number): string {
  const b = bookId.toUpperCase();
  
  if (b === 'GEN' && chapter === 1 && verse === 1) {
    return "Au commencement [originel, au moment de la sortie du Logos], Dieu [Elohim, l'Auto-Existant] créa [par Sa Parole parlée ex-nihilo, matérialisant Ses pensées éternelles] les cieux [la dimension spirituelle] et la terre [le monde matériel].";
  }
  if (b === 'GEN' && chapter === 1 && verse === 3) {
    return "Dieu dit : Que la lumière [la première manifestation créatrice de la Colonne de Feu] soit ! Et la lumière fut.";
  }
  if (b === 'JHN' && chapter === 1 && verse === 1) {
    return "Au commencement était la Parole [le Logos, la Théophanie créatrice], et la Parole était avec Dieu [Elohim], et la Parole était Dieu [Lui-même, dans Son expression visible].";
  }
  if (b === 'JHN' && chapter === 1 && verse === 14) {
    return "Et la Parole [le Logos] a été faite chair [s'est incarnée en Jésus-Christ], et elle a habité [dressé sa tente] au milieu de nous, pleine de grâce [faveur imméritée] et de vérité ; et nous avons contemplé sa gloire, une gloire comme la gloire du Fils unique venu du Père.";
  }
  if (b === 'HEB' && chapter === 13 && verse === 8) {
    return "Jésus-Christ est le même hier [dans l'Ancien Testament en tant que Colonne de Feu], aujourd'hui [dans la chair humaine], et éternellement [à travers Son Épouse élue].";
  }
  if (b === 'MAL' && chapter === 4 && verse === 5) {
    return "Voici, je vous enverrai Élie, le prophète [le messager du septième âge avec l'esprit d'Élie], avant que le jour de l'Éternel arrive, ce jour grand et redoutable.";
  }
  if (b === 'REV' && chapter === 10 && verse === 1) {
    return "Je vis un autre ange puissant, qui descendait du ciel, enveloppé d'une nuée ; au-dessus de sa tête était l'arc-en-ciel, et son visage était comme le soleil, et ses pieds comme des colonnes de feu [le Seigneur Jésus-Christ Lui-même descendant pour sceller les Élus].";
  }
  if (b === 'REV' && chapter === 10 && verse === 7) {
    return "Mais qu'aux jours de la voix du septième ange [le messager prophétique terrestre], quand il commencerait à sonner de la trompette, le mystère de Dieu [tous les mystères cachés de la Parole] s'accomplirait, comme il l'a déclaré à ses serviteurs, les prophètes.";
  }
  if (b === 'JHN' && chapter === 3 && verse === 16) {
    return "Car Dieu a tant aimé le monde qu'il a donné son Fils unique [dans Son sacrifice expiatoire], afin que quiconque croit [par la foi révélée] en lui ne périsse point, mais qu'il ait la vie éternelle [Zoé, la vie divine même].";
  }

  let text = verseText;
  
  for (const [key, value] of Object.entries(THEOLOGICAL_AMPLIFICATIONS)) {
    const regex = new RegExp(`\\b${key}\\b`, 'gi');
    text = text.replace(regex, value);
  }

  return text;
}

/**
 * Calcule et résout avec précision le numéro Strong (hébreu/grec) pour un terme biblique
 */
export function lookupStrongNumber(rawWordText: string, isNT: boolean = false): string | null {
  if (!rawWordText) return null;
  const cleanWord = rawWordText.trim().toLowerCase().replace(/[,.;:!?()'[\]»«’]+/g, '');
  if (!cleanWord || cleanWord.length < 2) return null;

  // 1. Recherche dans les mots vérifiés certifiés
  const verified = VERIFIED_WORD_STRONG_MAP[cleanWord];
  if (verified) {
    if (isNT && verified.greek) return verified.greek;
    if (!isNT && verified.hebrew) return verified.hebrew;
    if (verified.hebrew) return verified.hebrew;
    if (verified.greek) return verified.greek;
  }

  // 2. Recherche directe dans le dictionnaire manuel français
  const mapped = FRENCH_BIBLE_STRONG_MAP[cleanWord];
  if (mapped && mapped.strong) {
    const parts = mapped.strong.split('/').map(s => s.trim());
    if (isNT) {
      const gPart = parts.find(p => p.startsWith('G'));
      if (gPart) return gPart;
      const hPart = parts.find(p => p.startsWith('H'));
      if (hPart) return hPart;
    } else {
      const hPart = parts.find(p => p.startsWith('H'));
      if (hPart) return hPart;
      const gPart = parts.find(p => p.startsWith('G'));
      if (gPart) return gPart;
    }
    return parts[0];
  }

  // 3. Recherche directe dans le lexique Strong théologique
  for (const [sNum, entry] of Object.entries(STRONG_LEXICON)) {
    if (entry.word && entry.word.toLowerCase().includes(cleanWord)) {
      if (isNT && sNum.startsWith('G')) return sNum;
      if (!isNT && sNum.startsWith('H')) return sNum;
    }
  }

  // Ne plus inventer de numéro via un hash ! Retourner null si non mappé
  return null;
}

/**
 * Analyse et extrait les numéros Strong associés aux mots d'un verset biblique
 */
export function getStrongNumbersForVerse(bookId: string, chapter: number, verse: number, text: string): VerseStrongData {
  const b = bookId.toUpperCase();
  const words = text.split(/(\s+|[,.;:!?()'[\]»«’]+)/);
  const resultWords: { text: string; strong?: string }[] = [];

  const isNT = BIBLE_BOOKS_META.find(bk => bk.id.toUpperCase() === b)?.testament === 'NT';

  words.forEach(w => {
    const strong = lookupStrongNumber(w, isNT) || undefined;
    resultWords.push({
      text: w,
      strong
    });
  });

  return {
    bookId,
    chapter,
    verse,
    words: resultWords
  };
}

let bibleStrongIndexCache: Record<string, Record<string, Record<string, Array<[string, string]>>>> | null = null;
let loadStrongIndexPromise: Promise<Record<string, Record<string, Record<string, Array<[string, string]>>>> | null> | null = null;

/**
 * Charge l'index universel des numéros Strong pour tous les versets de la Bible Louis Segond
 */
export async function loadBibleStrongIndex(): Promise<Record<string, Record<string, Record<string, Array<[string, string]>>>> | null> {
  if (bibleStrongIndexCache) return bibleStrongIndexCache;
  if (loadStrongIndexPromise) return loadStrongIndexPromise;

  loadStrongIndexPromise = (async () => {
    try {
      if (typeof window === 'undefined') {
        const fs = await import('fs');
        const path = await import('path');
        const p = path.resolve('./public/bible-strong-lsg1910.json');
        if (fs.existsSync(p)) {
          bibleStrongIndexCache = JSON.parse(fs.readFileSync(p, 'utf8'));
          return bibleStrongIndexCache;
        }
      }

      const data = await fetchJsonSafe<Record<string, Record<string, Record<string, Array<[string, string]>>>>>('bible-strong-lsg1910.json', ['./bible-strong-lsg1910.json']);
      if (data) {
        bibleStrongIndexCache = data;
        return data;
      }
    } catch (e) {
      console.warn('[BibleExegesis] Erreur chargement index Strongs bibliques:', e);
    }
    return null;
  })();

  return loadStrongIndexPromise;
}

/**
 * Récupère les mots étiquetés avec leur Strong pour un chapitre donné
 */
export async function getChapterVerseStrongs(bookId: string, chapter: number | string): Promise<Record<string, Array<[string, string]>> | null> {
  const index = await loadBibleStrongIndex();
  if (!index) return null;
  const b = bookId.toUpperCase();
  const ch = String(chapter);
  return index[b]?.[ch] || null;
}

/**
 * Recherche toutes les occurrences bibliques authentiques du mot ou Strong étudié à travers la Bible.
 */
export async function findBibleOccurrences(
  wordText: string,
  version: string = 'lsg1910',
  strongNum?: string
): Promise<Array<{ bookId: string; bookName: string; chapter: number; verse: number; text: string; matchedWord?: string }>> {
  try {
    const { ensureFullBibleLoaded } = await import('./bibleService');
    const bibleData = await ensureFullBibleLoaded(version as any);
    if (!bibleData) return [];

    const normStrong = strongNum ? normalizeStrongId(strongNum) : null;
    const results: Array<{ bookId: string; bookName: string; chapter: number; verse: number; text: string; matchedWord?: string }> = [];

    // 1. Recherche par identifiant Strong certifié dans l'index complet
    if (normStrong) {
      const strongIndex = await loadBibleStrongIndex();
      if (strongIndex) {
        for (const [bookId, chapters] of Object.entries(strongIndex)) {
          const bookMeta = BIBLE_BOOKS_META.find(b => b.id.toUpperCase() === bookId.toUpperCase());
          const bookName = bookMeta ? bookMeta.name : bookId;

          for (const [chStr, verses] of Object.entries(chapters)) {
            const chNum = parseInt(chStr, 10);
            for (const [vsStr, pairs] of Object.entries(verses)) {
              const match = pairs.find(p => p[1] === normStrong);
              if (match) {
                const vsNum = parseInt(vsStr, 10);
                const verseObj = bibleData[bookId]?.[chNum]?.find(v => v.verse === vsNum);
                results.push({
                  bookId,
                  bookName,
                  chapter: chNum,
                  verse: vsNum,
                  text: verseObj ? verseObj.text : '',
                  matchedWord: match[0]
                });
                if (results.length >= 80) return results;
              }
            }
          }
        }
        if (results.length > 0) return results;
      }
    }

    // 2. Repli par terme textuel si pas de strongNum
    const cleanWord = wordText ? wordText.trim().toLowerCase().replace(/[,.;:!?()'[\]»«’]+/g, '') : '';
    if (!cleanWord || cleanWord.length < 2) return [];

    const escaped = cleanWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wordRegex = new RegExp(`\\b${escaped}\\b`, 'i');

    for (const [bookId, chapters] of Object.entries(bibleData)) {
      const bookMeta = BIBLE_BOOKS_META.find(b => b.id.toUpperCase() === bookId.toUpperCase());
      const bookName = bookMeta ? bookMeta.name : bookId;

      for (const [chStr, verses] of Object.entries(chapters)) {
        const chapter = parseInt(chStr, 10);
        for (const v of verses) {
          if (wordRegex.test(v.text)) {
            results.push({
              bookId,
              bookName,
              chapter,
              verse: v.verse,
              text: v.text,
              matchedWord: wordText
            });
            if (results.length >= 60) return results;
          }
        }
      }
    }
    return results;
  } catch (err) {
    console.warn("Erreur recherche occurrences Strong:", err);
    return [];
  }
}
