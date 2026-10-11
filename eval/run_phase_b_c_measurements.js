/**
 * Evaluation & Measurement script for Phase B and C
 */

import fs from 'fs';
import path from 'path';

// Construct realistic 106-paragraph test sermon for 47-0412-SHP
export function createMockSermon470412() {
  const paragraphs = [];
  
  // §1: Opening
  paragraphs.push("§1 Inclinons la tête un moment pour prier.");
  // §2: Introduction
  paragraphs.push("§2 C'est un privilège d'être ici ce soir avec vous tous dans le service du Seigneur.");
  // §3: Rocky Mountains passage!
  paragraphs.push("§3 Quel rôle joue l'isolement et le fait de se retirer seul avec Dieu dans les montagnes Rocheuses pour la communion personnelle et le ressourcement spirituel d'un serviteur de Dieu ? Quand un homme de Dieu s'éloigne du bruit du monde et monte seul sur la montagne, en prière à l'écart, il retrouve la présence divine et la force spirituelle nécessaire pour accomplir sa mission.");
  
  // §4 to §89: General sermon preaching body
  for (let i = 4; i <= 89; i++) {
    paragraphs.push(`§${i} Et Jésus a dit que si vous croyez en Lui, vous ferez aussi les œuvres qu'Il a faites. La foi vient de ce qu'on entend, et ce qu'on entend vient de la parole de Dieu. Nous devons marcher par la foi et non par la vue dans ces derniers jours.`);
  }

  // §90: Editorial note (tape end)
  paragraphs.push("§90 [N.D.E. Fin de l'enregistrement sur la bande originale.]");

  // §91 to §99: More preaching
  for (let i = 91; i <= 99; i++) {
    paragraphs.push(`§${i} Que le Seigneur bénisse Sa parole dans vos cœurs ce soir. Prions tous ensemble.`);
  }

  // §100: Inaudible passage
  paragraphs.push("§100 …?… [Passage inaudible sur la bande enregistrée]");

  // §101 to §102: Closing
  paragraphs.push("§101 Merci frere. Que Dieu vous bénisse.");
  paragraphs.push("§102 Que le Seigneur vous bénisse tous richement.");
  paragraphs.push("§103 [Fin de la bande]");
  paragraphs.push("§104 …?…");
  paragraphs.push("§105 [N.D.E. Prière finale pour les malades]");
  paragraphs.push("§106 La partie suivante était sur une bande enregistrée… [N.D.E. Solo de trompette et drôlement de musique]");

  return {
    id: "47-0412-SHP",
    title: "La Communion par la Réhabilitation",
    date: "1947-04-12",
    text: paragraphs.join("\n\n"),
    paragraphs
  };
}

// 50 test vocabulary words to test false positive matching
export const TEST_50_WORDS = [
  "isolement", "communion", "ressourcement", "spirituel", "serviteur",
  "montagne", "rocheuses", "priere", "solitude", "retirer",
  "foi", "grace", "revelation", "evangile", "prophete",
  "rocher", "caverne", "desert", "silence", "presence",
  "ecriture", "bapteme", "seigneur", "sauveur", "disciple",
  "apostolique", "soiree", "message", "frere", "predication",
  "guerison", "miracle", "fidele", "saintete", "sacrement",
  "tabernacle", "eglise", "colonne", "nuage", "lumiere",
  "redemption", "alliance", "esperance", "souffle", "esprit",
  "adoration", "louange", "temoignage", "verite", "pardon"
];

console.log("Mock Sermon 47-0412-SHP initialized with 106 paragraphs.");
