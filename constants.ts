
import { Sermon } from './types';

export const CITIES = ['Jeffersonville', 'Tucson', 'Chicago', 'Phoenix', 'Los Angeles'];
export const LANGUAGES = ['Français', 'Anglais', 'Espagnol'];
export const YEARS = ['1947', '1950', '1955', '1960', '1963', '1964', '1965'];
export const VERSIONS = ['VGR', 'Shp', 'MS'];
export const TIMES = ['Matin', 'Après-midi', 'Soir'];

// Couleurs optimisées : suppression des bordures pour un rendu fluide entre les mots
export const PALETTE_HIGHLIGHT_COLORS: { [key: string]: string } = {
  default: 'bg-zinc-300/40 dark:bg-zinc-500/30',
  sky: 'bg-sky-400/30 dark:bg-sky-500/25',
  teal: 'bg-teal-400/30 dark:bg-teal-500/25',
  amber: 'bg-amber-500/25 dark:bg-amber-500/30', // Couleur assortie au bouton du menu
  rose: 'bg-rose-400/30 dark:bg-rose-500/25',
  violet: 'bg-violet-400/30 dark:bg-violet-500/25',
  lime: 'bg-lime-400/30 dark:bg-lime-500/25',
  orange: 'bg-orange-400/30 dark:bg-orange-500/25',
};
