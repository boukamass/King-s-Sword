#!/usr/bin/env node
/**
 * King's Sword — Générateur de Datasets Étendus & Échantillonnage de Paragraphes Réels
 * (Phase 2F.16 — Points 4 & 6)
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { loadExposeAsSermons } from '../services/exposeDocumentService.ts';
import { parseSermonParagraphs } from '../services/chunkingService.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// -------------------------------------------------------------------
// 1. DATASET DE 100 QUESTIONS HORS-CORPUS (50 Pièges + 50 Hors-Domaine)
// -------------------------------------------------------------------

const nearDomainQuestions = [
  "Quelles sont les dimensions exactes de la tente vue en vision par William Branham à Phoenix ?",
  "Quel était le modèle de la voiture Chevrolet break utilisée lors des voyages en Afrique du Sud en 1951 ?",
  "Que dit Frère Branham au sujet de la chasse au grizzli dans les Rocheuses canadiennes en 1961 ?",
  "Quelle est la ville de naissance exacte de Hope Branham selon l'état civil américain ?",
  "Comment réparer le câble d'alimentation du microphone Shure 55S utilisé au Branham Tabernacle ?",
  "Quels sont les détails du certificat de mariage de William Branham et Meda Broy en 1941 ?",
  "Quelle était la marque de l'appareil photo ayant capturé la photo de la Colonne de Feu à Houston en 1950 ?",
  "Combien d'exemplaires du livre 'Un Homme Envoyé de Dieu' par Gordon Lindsay ont été imprimés en première édition ?",
  "Quelle était la recette du pain de maïs servi lors des réunions sous tente dans l'Indiana ?",
  "Quel est le nom de l'infirmière présente lors de l'accident de voiture mortel de décembre 1965 ?",
  "Quels cantiques ont été chantés lors de la réunion de prière du 18 janvier 1954 à West Palm Beach ?",
  "Quelle est l'altitude du sommet du mont Sunset où les sept anges sont apparus en mars 1963 ?",
  "Quel était le numéro d'immatriculation de l'avion loué pour le voyage missionnaire en Inde en 1954 ?",
  "Que déclare le Coran au sujet de la prophétie d'Élie dans la sourate Maryam ?",
  "Quelle est la doctrine de la transsubstantiation selon la session XIII du Concile de Trente ?",
  "Quels sont les canons du synode de Dordrecht concernant la double prédestination absolue ?",
  "Comment les théologiens orthodoxes grecs expliquent-ils la procession de l'Esprit Saint sans le Filioque ?",
  "Quel est le commentaire de Thomas d'Aquin sur l'Apocalypse dans la Somme Théologique ?",
  "Quelles sont les 95 thèses affichées par Martin Luther sur la porte de l'église de Wittenberg en latin ?",
  "Que dit le Catéchisme de Heidelberg au sujet du jour du Seigneur et du repos dominical ?",
  "Quels sont les versets de la Bible de Jérusalem traduisant le mot 'logos' par 'Verbe' dans l'évangile de Jean ?",
  "Comment saint Augustin d'Hippone définit-il la Cité de Dieu face à la chute de Rome en 410 ?",
  "Quelle est l'interprétation des témoins de Jéhovah sur les 144 000 élus de l'Apocalypse ?",
  "Que prescrit la Mishna juive dans le traité Shabbat concernant la distance de marche autorisée ?",
  "Quelle est la position officielle de l'Église Adventiste du Septième Jour sur le sanctuaire céleste en 1844 ?",
  "Comment John Calvin a-t-il géré le procès et la condamnation de Michel Servet à Genève en 1553 ?",
  "Quel est le texte intégral de la confession de foi baptiste de Londres de 1689 sur le baptême des croyants ?",
  "Quelle est l'étymologie araméenne du mot Maranatha selon les manuscrits de la mer Morte ?",
  "Quels sont les critères de canonisation des saints selon le droit canonique catholique romain révisé en 1983 ?",
  "Comment le livre d'Hénoch éthiopien décrit-il la chute des veilleurs angéliques au chapitre 6 ?",
  "Quelle est la prière du chapelet de la Vierge Marie récitée dans les sanctuaires de Lourdes et Fatima ?",
  "Que contient le document Q selon les hypothèses modernes de la critique textuelle synoptique ?",
  "Quel était l'itinéraire exact du troisième voyage missionnaire de l'apôtre Paul à travers la Galatie et la Phrygie ?",
  "Quelle est la liste complète des papes de l'Église catholique depuis Lin jusqu'à Grégoire le Grand ?",
  "Que dit le traité de San Francisco de 1951 sur les frontières maritimes de l'Asie ?",
  "Comment Frère Branham a-t-il payé les droits de douane lors de son entrée en Rhodésie du Nord ?",
  "Quelles espèces de truites William Branham pêchait-il dans la rivière Colorado ?",
  "Quel était le prix du carburant diesel aux États-Unis en novembre 1963 lors de la prédication ?",
  "Quel médecin a signé le rapport médical d'autopsie de William Branham en décembre 1965 ?",
  "Comment accorder une guitare acoustique Martin D-28 en open tuning de ré selon les musiciens du Tabernacle ?",
  "Quelle est la date de pose de la première pierre de l'église de Jeffersonville sur la 8th et Penn Street ?",
  "Quels sermons ont été traduits en dialecte swahili lors de la convention de Dar es Salaam en 1960 ?",
  "Quel était le prénom du premier guide de chasse de Frère Branham en Colombie-Britannique ?",
  "Que dit l'encyclique Papale Humanae Vitae publiée par le pape Paul VI en juillet 1968 ?",
  "Quelle est la composition du sol calcaire autour de la caverne de Patmos en Grèce ?",
  "Comment les premiers chrétiens de Rome célébraient-ils la fête de Pâques selon la controverse quartodécimaine ?",
  "Quelles sont les différences de ponctuation entre le Textus Receptus et le Codex Sinaiticus sur Apocalypse 1:1 ?",
  "Combien de chaises en bois contenaient la salle de réunion du Branham Tabernacle avant sa rénovation en 1963 ?",
  "Quel était le fabricant des bandes magnétiques 1/4 de pouce utilisées pour enregistrer les Sept Sceaux ?",
  "Quel diplôme universitaire l'évangéliste Billy Graham a-t-il obtenu au Wheaton College en 1943 ?"
];

const generalOutOfDomainQuestions = [
  "Quelle est la recette traditionnelle du couscous royal aux sept légumes et à la semoule fine ?",
  "Comment configurer un cluster Kubernetes avec Helm et Ingress NGINX sur AWS EKS ?",
  "Quelle est la distance moyenne entre la planète Mars et le Soleil à l'aphélie en kilomètres ?",
  "Quel est le principe de fonctionnement d'un réacteur nucléaire à eau pressurisée (REP) ?",
  "Comment calculer la transformée de Fourier discrète rapide (FFT) d'un signal audio ?",
  "Quelles sont les équipes finalistes de la Coupe d'Afrique des Nations de football en 2023 ?",
  "Comment tailler les rosiers grimpants à la fin de l'hiver pour favoriser la floraison ?",
  "Quelle est la structure moléculaire et le point de fusion de l'acide acétylsalicylique (aspirine) ?",
  "Comment fonctionne le mécanisme de consensus Proof-of-Stake dans la blockchain Ethereum ?",
  "Quelle est la capitale administrative et le nombre d'habitants de la Nouvelle-Zélande ?",
  "Comment diagnostiquer et remplacer les plaquettes de frein avant sur une Toyota Corolla ?",
  "Quelles sont les causes géologiques et historiques de l'éruption du Vésuve en 79 après J.-C. ?",
  "Comment implémenter un algorithme de tri rapide (QuickSort) en langage Rust avec gestion des pointeurs ?",
  "Quelle est la température d'ébullition de l'hélium liquide sous une pression de 1 bar ?",
  "Quelles sont les règles officielles du rugby à XV concernant le plaquage haut et le carton rouge ?",
  "Comment faire une émulsion stable pour une sauce mayonnaise maison au fouet ?",
  "Quel est le PIB nominal annuel de l'Allemagne exprimé en milliards d'euros pour l'année 2023 ?",
  "Comment calibrer un télescope astronomique de type Newton pour l'observation des anneaux de Saturne ?",
  "Quelle est la vitesse de pointe d'un guépard adulte en pleine course dans la savane africaine ?",
  "Comment programmer un microcontrôleur Arduino pour lire une sonde de température DHT22 ?",
  "Quelles sont les symphonies majeures composées par Ludwig van Beethoven durant sa période viennoise ?",
  "Comment résoudre l'équation différentielle linéaire du second ordre sans second membre ?",
  "Quelle est la procédure d'obtention d'un visa de tourisme pour visiter le Japon pendant 90 jours ?",
  "Quelles sont les propriétés physiques et mécaniques du titane de grade 5 (Ti-6Al-4V) ?",
  "Comment faire un pain au levain naturel avec une fermentation lente de 24 heures au réfrigérateur ?",
  "Quelle est la composition chimique de l'eau de mer en pourcentage massique de chlorure de sodium ?",
  "Comment fonctionne l'injection directe d'essence à rampe commune sur un moteur turbo 4 cylindres ?",
  "Quelle est la théorie de la relativité générale expliquant la courbure de l'espace-temps autour des trous noirs ?",
  "Comment peindre à l'aquarelle un ciel d'orage avec la technique du mouillé sur mouillé ?",
  "Quel est le palmarès du tournoi de tennis de Roland-Garros en simple messieurs depuis 2010 ?",
  "Comment installer et sécuriser un serveur de base de données PostgreSQL 16 sur Ubuntu 24.04 ?",
  "Quelle est la formule chimique et le mode d'action de l'amoxicilline sur la paroi bactérienne ?",
  "Comment fonctionne un capteur d'appareil photo plein format CMOS rétroéclairé (BSI) ?",
  "Quelle est la durée de rotation de la planète Vénus sur elle-même exprimée en jours terrestres ?",
  "Comment calculer le rendement actuariel d'une obligation d'État à coupon fixe sur 10 ans ?",
  "Quels sont les ingrédients nécessaires pour préparer une paella valencienne authentique au feu de bois ?",
  "Comment créer un conteneur Docker multi-stage pour une application web React et Vite ?",
  "Quelle est la pression atmosphérique moyenne au sommet de l'Everest en hectopascals ?",
  "Comment accorder un piano à queue selon le tempérament égal à 440 Hz avec un diapason ?",
  "Quelle est la structure anatomique et le fonctionnement de la rétine de l'œil humain ?",
  "Comment régler les paramètres ISO, ouverture et vitesse pour la photographie de la Voie Lactée ?",
  "Quel est l'historique de la construction du canal de Panama entre l'Atlantique et le Pacifique ?",
  "Comment écrire une fonction récursive en Python pour générer la suite des nombres de Fibonacci ?",
  "Quelle est la consommation électrique moyenne en kilowattheures d'une pompe à chaleur air-eau en hiver ?",
  "Quelles sont les règles de grammaire régissant l'accord du participe passé avec l'auxiliaire avoir ?",
  "Comment doser et appliquer un engrais NPK pour la culture hydroponique de tomates sous serre ?",
  "Quelle est la vitesse de croisière et le rayon d'action maximal d'un avion Airbus A350-900 ?",
  "Comment fonctionne le protocole de chiffrement TLS 1.3 lors de l'échange de clés Diffie-Hellman ?",
  "Quelle est la profondeur maximale de la fosse des Mariannes dans l'océan Pacifique occidental ?",
  "Comment conserver des grains de café torréfiés pour éviter l'oxydation des arômes ?"
];

const outOfDomain100 = [
  ...nearDomainQuestions.map((q, i) => ({
    id: `OOD_NEAR_${String(i + 1).padStart(3, '0')}`,
    category: "piege_proche_domaine",
    question: q,
    expectedDocuments: [],
    answerable: false
  })),
  ...generalOutOfDomainQuestions.map((q, i) => ({
    id: `OOD_GEN_${String(i + 1).padStart(3, '0')}`,
    category: "hors_domaine_general",
    question: q,
    expectedDocuments: [],
    answerable: false
  }))
];

const oodPath = path.join(rootDir, 'eval', 'out_of_domain_100.json');
const oodContent = JSON.stringify(outOfDomain100, null, 2);
fs.writeFileSync(oodPath, oodContent, 'utf8');
const oodHash = crypto.createHash('sha256').update(oodContent).digest('hex');

// -------------------------------------------------------------------
// 2. ÉCHANTILLONNAGE DE 60 PARAGRAPHES RÉELS (Point 6)
// -------------------------------------------------------------------

async function buildSampled60() {
  const libraryPath = path.join(rootDir, 'public', 'library.json');
  const libSermons = JSON.parse(fs.readFileSync(libraryPath, 'utf8'));
  const exposeSermons = await loadExposeAsSermons();
  const allCorpus = [...libSermons, ...exposeSermons];

  const sampledItems = [];
  let sampleId = 1;

  // 16 paragraphes depuis library.json (tous les paragraphes disponibles)
  for (const s of libSermons) {
    const paras = parseSermonParagraphs(s.text);
    for (const p of paras) {
      if (sampledItems.length < 60) {
        sampledItems.push({
          id: `SERMON_SMP_${String(sampleId).padStart(3, '0')}`,
          sermonId: s.id,
          sermonTitle: s.title,
          paragraphNum: p.num,
          question: `Que déclare Frère Branham dans "${s.title}" à propos de : "${p.text.slice(0, 120).replace(/\n/g, ' ')}..." ?`,
          expectedDocuments: [s.id],
          snippet: p.text.slice(0, 200),
          answerable: true
        });
        sampleId++;
      }
    }
  }

  // 44 paragraphes échantillonnés à intervalles réguliers à travers l'Exposé
  const remainingNeeded = 60 - sampledItems.length;
  let totalExposeParas = [];
  for (const exp of exposeSermons) {
    const paras = parseSermonParagraphs(exp.text);
    paras.forEach(p => totalExposeParas.push({ sermonId: exp.id, sermonTitle: exp.title, paragraph: p }));
  }

  const step = Math.floor(totalExposeParas.length / remainingNeeded);
  for (let i = 0; i < remainingNeeded; i++) {
    const item = totalExposeParas[i * step];
    if (item) {
      sampledItems.push({
        id: `SERMON_SMP_${String(sampleId).padStart(3, '0')}`,
        sermonId: item.sermonId,
        sermonTitle: item.sermonTitle,
        paragraphNum: item.paragraph.num,
        question: `Que déclare l'Exposé dans "${item.sermonTitle}" au sujet de : "${item.paragraph.text.slice(0, 120).replace(/\n/g, ' ')}..." ?`,
        expectedDocuments: [item.sermonId],
        snippet: item.paragraph.text.slice(0, 200),
        answerable: true
      });
      sampleId++;
    }
  }

  // 40% Dev (24 questions) / 60% Test (36 questions)
  const dev24 = sampledItems.slice(0, 24);
  const test36 = sampledItems.slice(24, 60);

  const devPath = path.join(rootDir, 'eval', 'sermons_sampled_dev_24.json');
  const devContent = JSON.stringify(dev24, null, 2);
  fs.writeFileSync(devPath, devContent, 'utf8');
  const devHash = crypto.createHash('sha256').update(devContent).digest('hex');

  const testPath = path.join(rootDir, 'eval', 'sermons_sampled_test_36.json');
  const testContent = JSON.stringify(test36, null, 2);
  fs.writeFileSync(testPath, testContent, 'utf8');
  const testHash = crypto.createHash('sha256').update(testContent).digest('hex');

  console.log("==================================================================");
  console.log("✅ DATASETS DE MÉTHODOLOGIE POINT 4 & POINT 6 GÉNÉRÉS & GELÉS");
  console.log("==================================================================");
  console.log(` • Dataset OOD 100 questions (50 proches + 50 hors-domaine) :`);
  console.log(`   └─ Chemin  : ${oodPath}`);
  console.log(`   └─ SHA-256 : ${oodHash}`);
  console.log(` • Dataset Sermons Échantillonnés 40% DEV (24 questions) :`);
  console.log(`   └─ Chemin  : ${devPath}`);
  console.log(`   └─ SHA-256 : ${devHash}`);
  console.log(` • Dataset Sermons Échantillonnés 60% TEST (36 questions) :`);
  console.log(`   └─ Chemin  : ${testPath}`);
  console.log(`   └─ SHA-256 : ${testHash}`);
  console.log("==================================================================\n");
}

buildSampled60().catch(err => {
  console.error("Erreur:", err);
  process.exit(1);
});
