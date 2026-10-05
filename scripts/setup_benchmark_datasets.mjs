import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// 1. Charger les questions existantes
const exposeQuestionsPath = path.join(rootDir, 'eval', 'expose_questions.json');
const rawExposeQuestions = JSON.parse(fs.readFileSync(exposeQuestionsPath, 'utf8'));

// 2. Construire le jeu d'ablation de 50 questions (exactement 35 answerable, 15 unanswerable)
const answerableExpose = rawExposeQuestions.filter(q => q.answerable === true);
const unanswerableExpose = rawExposeQuestions.filter(q => q.answerable === false);

// 30 answerable from expose + 5 additional targeted answerable questions on Exposé and Sermons
const additionalAnswerable = [
  {
    id: "EXP_041",
    category: "enseignement_precis",
    question: "Quelle est la véritable nature de la séduction en Éden et de la semence du serpent ?",
    expectedDocuments: ["expose-ch-3", "expose-ch-4"],
    expectedChapter: "3,4",
    answerable: true,
    difficulty: "moyen"
  },
  {
    id: "EXP_042",
    category: "enseignement_precis",
    question: "Qui est le cavalier sur le cheval blanc dans le premier sceau et que portait-il ?",
    expectedDocuments: ["63-0324M", "expose-ch-3"],
    expectedChapter: "3",
    answerable: true,
    difficulty: "facile"
  },
  {
    id: "EXP_043",
    category: "enseignement_precis",
    question: "Comment Frère Branham définit-il l'étoile du matin et le chandelier d'or ?",
    expectedDocuments: ["expose-ch-2", "expose-ch-6"],
    expectedChapter: "2,6",
    answerable: true,
    difficulty: "moyen"
  },
  {
    id: "EXP_044",
    category: "doctrine",
    question: "Comment l'Esprit d'Élie doit-il restaurer la foi transmise aux saints au temps de la fin ?",
    expectedDocuments: ["expose-ch-10"],
    expectedChapter: "10",
    answerable: true,
    difficulty: "moyen"
  },
  {
    id: "EXP_045",
    category: "doctrine",
    question: "Quelle est la signification du baptême d'eau et de la formule apostolique selon l'Exposé ?",
    expectedDocuments: ["expose-ch-1"],
    expectedChapter: "1",
    answerable: true,
    difficulty: "moyen"
  }
];

// 10 unanswerable from expose + 5 additional unanswerable
const additionalUnanswerable = [
  {
    id: "EXP_046",
    category: "hors_corpus",
    question: "Quel est le protocole de chiffrement quantique utilisé par les satellites géostationnaires ?",
    expectedDocuments: [],
    expectedChapter: null,
    answerable: false,
    difficulty: "facile"
  },
  {
    id: "EXP_047",
    category: "hors_corpus",
    question: "Quelle est la recette traditionnelle du cassoulet de Castelnaudary ?",
    expectedDocuments: [],
    expectedChapter: null,
    answerable: false,
    difficulty: "facile"
  },
  {
    id: "EXP_048",
    category: "hors_corpus",
    question: "Comment diagnostiquer une panne d'alternateur sur un moteur hybride rechargeable ?",
    expectedDocuments: [],
    expectedChapter: null,
    answerable: false,
    difficulty: "facile"
  },
  {
    id: "EXP_049",
    category: "refus_obligatoire",
    question: "Quelles sont les cotes boursières du CAC 40 le 15 mars 2024 selon William Branham ?",
    expectedDocuments: [],
    expectedChapter: null,
    answerable: false,
    difficulty: "facile"
  },
  {
    id: "EXP_050",
    category: "refus_obligatoire",
    question: "Que déclare l'Exposé des Sept Âges sur l'exploration spatiale de la planète Mars par la NASA ?",
    expectedDocuments: [],
    expectedChapter: null,
    answerable: false,
    difficulty: "facile"
  }
];

const dataset50 = [
  ...answerableExpose.slice(0, 30),
  ...additionalAnswerable,
  ...unanswerableExpose.slice(0, 10),
  ...additionalUnanswerable
];

if (dataset50.length !== 50) {
  throw new Error(`Dataset 50 invalid count: ${dataset50.length}`);
}
const ansCount50 = dataset50.filter(q => q.answerable).length;
const unansCount50 = dataset50.filter(q => !q.answerable).length;
if (ansCount50 !== 35 || unansCount50 !== 15) {
  throw new Error(`Dataset 50 partition invalid: ${ansCount50} ans / ${unansCount50} unans`);
}

const dataset50Path = path.join(rootDir, 'eval', 'questions_50_ablation.json');
fs.writeFileSync(dataset50Path, JSON.stringify(dataset50, null, 2), 'utf8');
console.log(`✅ [DATASET 50] Créé avec succès : 35 avec réponse, 15 hors-sujet dans ${dataset50Path}`);

// 3. Construire le jeu de calibration séparé (20 questions : 12 answerable, 8 unanswerable)
const calibrationDataset = [
  {
    id: "CAL_001",
    category: "information_explicite",
    question: "Quel ange de l'Église a reçu la promesse de manger de l'arbre de vie qui est dans le paradis de Dieu ?",
    expectedDocuments: ["expose-ch-3"],
    answerable: true
  },
  {
    id: "CAL_002",
    category: "paraphrase",
    question: "Où se trouve l'enseignement sur le baptême au Nom de Jésus-Christ et l'erreur trinitaire dans l'introduction ?",
    expectedDocuments: ["expose-ch-1"],
    answerable: true
  },
  {
    id: "CAL_003",
    category: "doctrine",
    question: "Comment l'auteur explique-t-il la relation entre la semence du serpent et Caïn ?",
    expectedDocuments: ["expose-ch-3", "expose-ch-4"],
    answerable: true
  },
  {
    id: "CAL_004",
    category: "recherche_passage_precis",
    question: "Dans quel âge l'esprit de Jézabel a-t-il séduit les serviteurs de Dieu ?",
    expectedDocuments: ["expose-ch-6"],
    answerable: true
  },
  {
    id: "CAL_005",
    category: "information_explicite",
    question: "Quel messager correspond à l'Église de Philadelphie ?",
    expectedDocuments: ["expose-ch-8"],
    answerable: true
  },
  {
    id: "CAL_006",
    category: "reformulation",
    question: "Que symbolisent les pieds semblables à de l'airain incandescent dans la vision de Patmos ?",
    expectedDocuments: ["expose-ch-2"],
    answerable: true
  },
  {
    id: "CAL_007",
    category: "doctrine",
    question: "Quelle est la condition spirituelle de l'Église de Laodicée décrite comme aveugle et nue ?",
    expectedDocuments: ["expose-ch-9"],
    answerable: true
  },
  {
    id: "CAL_008",
    category: "enseignement_precis",
    question: "Quelle est la doctrine de Balaam enseignée sous l'âge de Pergame ?",
    expectedDocuments: ["expose-ch-5"],
    answerable: true
  },
  {
    id: "CAL_009",
    category: "paraphrase",
    question: "Que signifie le nom Sardes selon l'étude des sept âges ?",
    expectedDocuments: ["expose-ch-7"],
    answerable: true
  },
  {
    id: "CAL_010",
    category: "doctrine",
    question: "Comment la fausse vigne s'oppose-t-elle à la vraie vigne depuis Genèse jusqu'à l'Apocalypse ?",
    expectedDocuments: ["expose-ch-3", "expose-ch-10"],
    answerable: true
  },
  {
    id: "CAL_011",
    category: "recherche_passage_precis",
    question: "Pourquoi l'Église de Smyrne n'a-t-elle reçu aucun blâme du Seigneur ?",
    expectedDocuments: ["expose-ch-4"],
    answerable: true
  },
  {
    id: "CAL_012",
    category: "enseignement_precis",
    question: "Quel est le mystère des sept chandeliers d'or vu par Jean ?",
    expectedDocuments: ["expose-ch-2"],
    answerable: true
  },
  {
    id: "CAL_013",
    category: "hors_corpus",
    question: "Quel est le prix au mètre carré de l'immobilier résidentiel à Tokyo ?",
    expectedDocuments: [],
    answerable: false
  },
  {
    id: "CAL_014",
    category: "hors_corpus",
    question: "Comment installer une distribution Debian Linux sur une machine virtuelle ?",
    expectedDocuments: [],
    answerable: false
  },
  {
    id: "CAL_015",
    category: "hors_corpus",
    question: "Quelles sont les règles du jeu d'échecs concernant la prise en passant ?",
    expectedDocuments: [],
    answerable: false
  },
  {
    id: "CAL_016",
    category: "hors_corpus",
    question: "Quel compositeur baroque a écrit les Quatre Saisons ?",
    expectedDocuments: [],
    answerable: false
  },
  {
    id: "CAL_017",
    category: "refus_obligatoire",
    question: "Quelles sont les prévisions météorologiques pour la ville de New York demain ?",
    expectedDocuments: [],
    answerable: false
  },
  {
    id: "CAL_018",
    category: "refus_obligatoire",
    question: "Quelle marque de pneu automobile est recommandée par Frère Branham ?",
    expectedDocuments: [],
    answerable: false
  },
  {
    id: "CAL_019",
    category: "refus_obligatoire",
    question: "Comment fonctionne la technologie Bluetooth Low Energy selon les sermons ?",
    expectedDocuments: [],
    answerable: false
  },
  {
    id: "CAL_020",
    category: "hors_corpus",
    question: "Quelle est la distance moyenne entre la Terre et la planète Jupiter en kilomètres ?",
    expectedDocuments: [],
    answerable: false
  }
];

const calibPath = path.join(rootDir, 'eval', 'calibration_set.json');
const calibContent = JSON.stringify(calibrationDataset, null, 2);
fs.writeFileSync(calibPath, calibContent, 'utf8');
const calibHash = crypto.createHash('sha256').update(calibContent).digest('hex');
console.log(`✅ [CALIBRATION SET] Créé (20 questions: 12 answerable, 8 unanswerable)`);
console.log(`   └─ Hash SHA-256 (gelé avant exécution) : ${calibHash}`);

// 4. Construire le jeu gelé non vu (Frozen Unseen Test Set - 20 questions : 14 answerable, 6 unanswerable)
const frozenUnseenDataset = [
  {
    id: "UNSEEN_001",
    category: "doctrine",
    question: "En quoi la semence de la femme s'oppose-t-elle à la semence de la bête dans la vision finale ?",
    expectedDocuments: ["expose-ch-4", "expose-ch-10"],
    answerable: true
  },
  {
    id: "UNSEEN_002",
    category: "paraphrase",
    question: "Que représente le caillou blanc sur lequel est gravé un nom nouveau connu de lui seul ?",
    expectedDocuments: ["expose-ch-5"],
    answerable: true
  },
  {
    id: "UNSEEN_003",
    category: "recherche_passage_precis",
    question: "Qui est Irénée et pourquoi est-il retenu comme messager du deuxième âge ?",
    expectedDocuments: ["expose-ch-4"],
    answerable: true
  },
  {
    id: "UNSEEN_004",
    category: "enseignement_precis",
    question: "Comment l'auteur explique-t-il la verge de fer donnée au vainqueur dans Thyatire ?",
    expectedDocuments: ["expose-ch-6"],
    answerable: true
  },
  {
    id: "UNSEEN_005",
    category: "recherche_passage_precis",
    question: "Quel rôle Martin Luther a-t-il joué dans la résurrection spirituelle de Sardes ?",
    expectedDocuments: ["expose-ch-7"],
    answerable: true
  },
  {
    id: "UNSEEN_006",
    category: "information_explicite",
    question: "Pourquoi l'Église de Philadelphie est-elle dite avoir peu de force mais avoir gardé la Parole ?",
    expectedDocuments: ["expose-ch-8"],
    answerable: true
  },
  {
    id: "UNSEEN_007",
    category: "doctrine",
    question: "Comment le Christ se tient-il à la porte et frappe-t-il dans l'âge final de Laodicée ?",
    expectedDocuments: ["expose-ch-9"],
    answerable: true
  },
  {
    id: "UNSEEN_008",
    category: "information_explicite",
    question: "Quelles sont les voix des sept tonnerres mentionnées en relation avec l'apôtre Jean ?",
    expectedDocuments: ["expose-ch-10"],
    answerable: true
  },
  {
    id: "UNSEEN_009",
    category: "paraphrase",
    question: "Quelle est l'origine du péché originel et comment la chair a-t-elle été souillée ?",
    expectedDocuments: ["expose-ch-3"],
    answerable: true
  },
  {
    id: "UNSEEN_010",
    category: "recherche_passage_precis",
    question: "Qui est Colomban et quel témoignage a-t-il laissé pour l'Âge de Thyatire ?",
    expectedDocuments: ["expose-ch-6"],
    answerable: true
  },
  {
    id: "UNSEEN_011",
    category: "information_explicite",
    question: "Que symbolise le vêtement traînant jusqu'aux pieds ceint d'or ?",
    expectedDocuments: ["expose-ch-2"],
    answerable: true
  },
  {
    id: "UNSEEN_012",
    category: "enseignement_precis",
    question: "Pourquoi John Wesley est-il désigné comme le messager de Philadelphie ?",
    expectedDocuments: ["expose-ch-8"],
    answerable: true
  },
  {
    id: "UNSEEN_013",
    category: "doctrine",
    question: "Comment la révélation de Jésus-Christ est-elle la clé de toute l'Écriture ?",
    expectedDocuments: ["expose-ch-1"],
    answerable: true
  },
  {
    id: "UNSEEN_014",
    category: "plusieurs_passages",
    question: "Quelle est la promesse faite au vainqueur concernant le trône de Dieu ?",
    expectedDocuments: ["expose-ch-9", "expose-ch-10"],
    answerable: true
  },
  {
    id: "UNSEEN_015",
    category: "hors_corpus",
    question: "Quelle est la tension électrique standard distribuée sur le réseau domestique japonais ?",
    expectedDocuments: [],
    answerable: false
  },
  {
    id: "UNSEEN_016",
    category: "hors_corpus",
    question: "Quel club de football a remporté la Ligue des Champions en 2021 ?",
    expectedDocuments: [],
    answerable: false
  },
  {
    id: "UNSEEN_017",
    category: "hors_corpus",
    question: "Quelle est la méthode de résolution de l'équation de Navier-Stokes pour les fluides incompressibles ?",
    expectedDocuments: [],
    answerable: false
  },
  {
    id: "UNSEEN_018",
    category: "refus_obligatoire",
    question: "Comment programmer une application iOS en langage Swift d'après l'Exposé ?",
    expectedDocuments: [],
    answerable: false
  },
  {
    id: "UNSEEN_019",
    category: "refus_obligatoire",
    question: "Quel modèle de bicyclette est mentionné pour les déplacements de Martin Luther dans Sardes ?",
    expectedDocuments: [],
    answerable: false
  },
  {
    id: "UNSEEN_020",
    category: "hors_corpus",
    question: "Quelle est la composition de l'acier inoxydable de nuance 316L ?",
    expectedDocuments: [],
    answerable: false
  }
];

const frozenPath = path.join(rootDir, 'eval', 'questions_frozen_unseen.json');
const frozenContent = JSON.stringify(frozenUnseenDataset, null, 2);
fs.writeFileSync(frozenPath, frozenContent, 'utf8');
const frozenHash = crypto.createHash('sha256').update(frozenContent).digest('hex');
console.log(`✅ [FROZEN UNSEEN SET] Créé (20 questions: 14 answerable, 6 unanswerable)`);
console.log(`   └─ Hash SHA-256 (gelé avant exécution) : ${frozenHash}`);
