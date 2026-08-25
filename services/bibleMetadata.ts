import { BibleBook } from '../types/bible';

export interface BibleBookMeta {
  id: string;
  name: string;
  testament: 'OT' | 'NT';
  category: 'Pentateuque' | 'Historique' | 'Poétique' | 'Prophètes' | 'Évangiles' | 'Actes' | 'Épîtres' | 'Apocalypse';
  chaptersCount: number;
}

export const BIBLE_BOOKS_META: BibleBookMeta[] = [
  // Ancien Testament - Pentateuque (5)
  { id: 'GEN', name: 'Genèse', testament: 'OT', category: 'Pentateuque', chaptersCount: 50 },
  { id: 'EXO', name: 'Exode', testament: 'OT', category: 'Pentateuque', chaptersCount: 40 },
  { id: 'LEV', name: 'Lévitique', testament: 'OT', category: 'Pentateuque', chaptersCount: 27 },
  { id: 'NUM', name: 'Nombres', testament: 'OT', category: 'Pentateuque', chaptersCount: 36 },
  { id: 'DEU', name: 'Deutéronome', testament: 'OT', category: 'Pentateuque', chaptersCount: 34 },

  // Ancien Testament - Historique (12)
  { id: 'JOS', name: 'Josué', testament: 'OT', category: 'Historique', chaptersCount: 24 },
  { id: 'JDG', name: 'Juges', testament: 'OT', category: 'Historique', chaptersCount: 21 },
  { id: 'RUT', name: 'Ruth', testament: 'OT', category: 'Historique', chaptersCount: 4 },
  { id: '1SA', name: '1 Samuel', testament: 'OT', category: 'Historique', chaptersCount: 31 },
  { id: '2SA', name: '2 Samuel', testament: 'OT', category: 'Historique', chaptersCount: 24 },
  { id: '1KI', name: '1 Rois', testament: 'OT', category: 'Historique', chaptersCount: 22 },
  { id: '2KI', name: '2 Rois', testament: 'OT', category: 'Historique', chaptersCount: 25 },
  { id: '1CH', name: '1 Chroniques', testament: 'OT', category: 'Historique', chaptersCount: 29 },
  { id: '2CH', name: '2 Chroniques', testament: 'OT', category: 'Historique', chaptersCount: 36 },
  { id: 'EZR', name: 'Esdras', testament: 'OT', category: 'Historique', chaptersCount: 10 },
  { id: 'NEH', name: 'Néhémie', testament: 'OT', category: 'Historique', chaptersCount: 13 },
  { id: 'EST', name: 'Esther', testament: 'OT', category: 'Historique', chaptersCount: 10 },

  // Ancien Testament - Poétique (5)
  { id: 'JOB', name: 'Job', testament: 'OT', category: 'Poétique', chaptersCount: 42 },
  { id: 'PSA', name: 'Psaumes', testament: 'OT', category: 'Poétique', chaptersCount: 150 },
  { id: 'PRO', name: 'Proverbes', testament: 'OT', category: 'Poétique', chaptersCount: 31 },
  { id: 'ECC', name: 'Ecclésiaste', testament: 'OT', category: 'Poétique', chaptersCount: 12 },
  { id: 'SNG', name: 'Cantique des Cantiques', testament: 'OT', category: 'Poétique', chaptersCount: 8 },

  // Ancien Testament - Grands & Petits Prophètes (17)
  { id: 'ISA', name: 'Ésaïe', testament: 'OT', category: 'Prophètes', chaptersCount: 66 },
  { id: 'JER', name: 'Jérémie', testament: 'OT', category: 'Prophètes', chaptersCount: 52 },
  { id: 'LAM', name: 'Lamentations', testament: 'OT', category: 'Prophètes', chaptersCount: 5 },
  { id: 'EZK', name: 'Ézéchiel', testament: 'OT', category: 'Prophètes', chaptersCount: 48 },
  { id: 'DAN', name: 'Daniel', testament: 'OT', category: 'Prophètes', chaptersCount: 12 },
  { id: 'HOS', name: 'Osée', testament: 'OT', category: 'Prophètes', chaptersCount: 14 },
  { id: 'JOL', name: 'Joël', testament: 'OT', category: 'Prophètes', chaptersCount: 3 },
  { id: 'AMO', name: 'Amos', testament: 'OT', category: 'Prophètes', chaptersCount: 9 },
  { id: 'OBA', name: 'Abdias', testament: 'OT', category: 'Prophètes', chaptersCount: 1 },
  { id: 'JON', name: 'Jonas', testament: 'OT', category: 'Prophètes', chaptersCount: 4 },
  { id: 'MIC', name: 'Michée', testament: 'OT', category: 'Prophètes', chaptersCount: 7 },
  { id: 'NAM', name: 'Nahum', testament: 'OT', category: 'Prophètes', chaptersCount: 3 },
  { id: 'HAB', name: 'Habacuc', testament: 'OT', category: 'Prophètes', chaptersCount: 3 },
  { id: 'ZEP', name: 'Sophonie', testament: 'OT', category: 'Prophètes', chaptersCount: 3 },
  { id: 'HAG', name: 'Aggée', testament: 'OT', category: 'Prophètes', chaptersCount: 2 },
  { id: 'ZEC', name: 'Zacharie', testament: 'OT', category: 'Prophètes', chaptersCount: 14 },
  { id: 'MAL', name: 'Malachie', testament: 'OT', category: 'Prophètes', chaptersCount: 4 },

  // Nouveau Testament - Évangiles (4)
  { id: 'MAT', name: 'Matthieu', testament: 'NT', category: 'Évangiles', chaptersCount: 28 },
  { id: 'MRK', name: 'Marc', testament: 'NT', category: 'Évangiles', chaptersCount: 16 },
  { id: 'LUK', name: 'Luc', testament: 'NT', category: 'Évangiles', chaptersCount: 24 },
  { id: 'JHN', name: 'Jean', testament: 'NT', category: 'Évangiles', chaptersCount: 21 },

  // Nouveau Testament - Actes (1)
  { id: 'ACT', name: 'Actes', testament: 'NT', category: 'Actes', chaptersCount: 28 },

  // Nouveau Testament - Épîtres (21)
  { id: 'ROM', name: 'Romains', testament: 'NT', category: 'Épîtres', chaptersCount: 16 },
  { id: '1CO', name: '1 Corinthiens', testament: 'NT', category: 'Épîtres', chaptersCount: 16 },
  { id: '2CO', name: '2 Corinthiens', testament: 'NT', category: 'Épîtres', chaptersCount: 13 },
  { id: 'GAL', name: 'Galates', testament: 'NT', category: 'Épîtres', chaptersCount: 6 },
  { id: 'EPH', name: 'Éphésiens', testament: 'NT', category: 'Épîtres', chaptersCount: 6 },
  { id: 'PHP', name: 'Philippiens', testament: 'NT', category: 'Épîtres', chaptersCount: 4 },
  { id: 'COL', name: 'Colossiens', testament: 'NT', category: 'Épîtres', chaptersCount: 4 },
  { id: '1TH', name: '1 Thessaloniciens', testament: 'NT', category: 'Épîtres', chaptersCount: 5 },
  { id: '2TH', name: '2 Thessaloniciens', testament: 'NT', category: 'Épîtres', chaptersCount: 3 },
  { id: '1TI', name: '1 Timothée', testament: 'NT', category: 'Épîtres', chaptersCount: 6 },
  { id: '2TI', name: '2 Timothée', testament: 'NT', category: 'Épîtres', chaptersCount: 4 },
  { id: 'TIT', name: 'Tite', testament: 'NT', category: 'Épîtres', chaptersCount: 3 },
  { id: 'PHM', name: 'Philémon', testament: 'NT', category: 'Épîtres', chaptersCount: 1 },
  { id: 'HEB', name: 'Hébreux', testament: 'NT', category: 'Épîtres', chaptersCount: 13 },
  { id: 'JAS', name: 'Jacques', testament: 'NT', category: 'Épîtres', chaptersCount: 5 },
  { id: '1PE', name: '1 Pierre', testament: 'NT', category: 'Épîtres', chaptersCount: 5 },
  { id: '2PE', name: '2 Pierre', testament: 'NT', category: 'Épîtres', chaptersCount: 3 },
  { id: '1JN', name: '1 Jean', testament: 'NT', category: 'Épîtres', chaptersCount: 5 },
  { id: '2JN', name: '2 Jean', testament: 'NT', category: 'Épîtres', chaptersCount: 1 },
  { id: '3JN', name: '3 Jean', testament: 'NT', category: 'Épîtres', chaptersCount: 1 },
  { id: 'JUD', name: 'Jude', testament: 'NT', category: 'Épîtres', chaptersCount: 1 },

  // Nouveau Testament - Apocalypse (1)
  { id: 'REV', name: 'Apocalypse', testament: 'NT', category: 'Apocalypse', chaptersCount: 22 }
];
