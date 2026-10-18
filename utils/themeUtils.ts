import { Note } from '../types';

export const PRESET_THEMES = [
  'Général',
  'Doctrine & Théologie',
  'Exégèse & Sermons',
  'Prophétie & Fin des Temps',
  'Foi & Prière',
  'Études Personnelles'
];

export const getUserCustomThemes = (): string[] => {
  try {
    const stored = localStorage.getItem('kings_sword_user_themes');
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
};

export const saveUserCustomThemes = (themes: string[]): void => {
  try {
    localStorage.setItem('kings_sword_user_themes', JSON.stringify(themes));
  } catch (e) {
    console.error('Erreur sauvegarde thèmes:', e);
  }
};

export const getAllNoteThemes = (notes: Note[] = []): string[] => {
  const customSet = new Set<string>(PRESET_THEMES);
  const userCustom = getUserCustomThemes();
  userCustom.forEach(th => th && th.trim() && customSet.add(th.trim()));
  notes.forEach(n => {
    if (n.theme && n.theme.trim()) {
      customSet.add(n.theme.trim());
    }
  });
  return Array.from(customSet);
};

export const addCustomTheme = (name: string): string[] => {
  const trimmed = name.trim();
  if (!trimmed) return getUserCustomThemes();
  const current = getUserCustomThemes();
  if (!current.includes(trimmed) && !PRESET_THEMES.includes(trimmed)) {
    const updated = [...current, trimmed];
    saveUserCustomThemes(updated);
    return updated;
  }
  return current;
};
