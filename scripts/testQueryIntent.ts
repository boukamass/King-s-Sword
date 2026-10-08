import { detectQueryIntent, logQueryIntent } from '../services/queryIntentService';

const tests = [
  {
    query: "Reum c txt n 4 lgns",
    context: "Chapitre 5 - L'Âge de l'Église de Pergame"
  },
  {
    query: "Résume ce texte en 4 lignes",
    context: "Chapitre 5 - L'Âge de l'Église de Pergame"
  },
  {
    query: "Explique ce passage simplement",
    context: "Sermon 63-0324M - Le Septième Sceau"
  },
  {
    query: "Donne-moi les idées principales de ce texte",
    context: "Chapitre 2 - L'Âge de l'Église d'Éphèse"
  },
  {
    query: "Que dit Branham sur la semence du serpent ?",
    context: "11 chapitres de l'Exposé + sermons"
  },
  {
    query: "Pourquoi Caïn a-t-il tué Abel ?",
    context: "11 chapitres de l'Exposé + sermons"
  },
  {
    query: "resum c passage en 3 lgn",
    context: "Sermon 65-1204 - La Maître-Pièce"
  },
  {
    query: "Comment fonctionne la fibre optique ?",
    context: "11 chapitres de l'Exposé + sermons"
  }
];

console.log("=== EXÉCUTION DES 8 TESTS DE DÉTECTION D'INTENTION ===\n");

tests.forEach((t, index) => {
  console.log(`--- TEST ${index + 1} ---`);
  const intentResult = detectQueryIntent(t.query);
  logQueryIntent({
    query: t.query,
    aiContextDescription: t.context,
    intentResult
  });
  console.log("");
});
