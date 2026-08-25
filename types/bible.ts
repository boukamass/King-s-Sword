export type BibleVersion = 'lsg1910' | 'darby' | 'kjv';

export interface BibleVersionMeta {
  id: BibleVersion;
  label: string;
  shortName: string;
  lang: 'fr' | 'en';
  subtext: string;
  file: string;
  apiCode: string;
}

export const BIBLE_VERSIONS_META: Record<BibleVersion, BibleVersionMeta> = {
  lsg1910: {
    id: 'lsg1910',
    label: 'Louis Segond 1910',
    shortName: 'LSG 1910',
    lang: 'fr',
    subtext: 'Français • Version classique',
    file: '/bible-lsg1910.json',
    apiCode: 'ls1910'
  },
  darby: {
    id: 'darby',
    label: 'Darby (Français)',
    shortName: 'Darby',
    lang: 'fr',
    subtext: 'Français • Traduction littérale',
    file: '/bible-darby.json',
    apiCode: 'darby'
  },
  kjv: {
    id: 'kjv',
    label: 'King James Version',
    shortName: 'KJV',
    lang: 'en',
    subtext: 'English • Authorized Version',
    file: '/bible-kjv.json',
    apiCode: 'kjv'
  }
};

export interface BibleVerse {
  verse: number;
  text: string;
}

export interface BibleChapter {
  chapter: number;
  verses: BibleVerse[];
}

export interface BibleBook {
  id: string; // Ex: 'GEN', 'EXO', 'MAT', 'REV'
  name: string; // Ex: 'Genèse'
  testament: 'OT' | 'NT';
  category: 'Pentateuque' | 'Historique' | 'Poétique' | 'Prophètes' | 'Évangiles' | 'Actes' | 'Épîtres' | 'Apocalypse';
  chaptersCount: number;
  chapters: Record<number, BibleVerse[]>;
}

export interface BibleNavigationSelection {
  bookId: string;
  chapter: number;
  verse?: number;
}

