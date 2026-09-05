import { Announcement } from '../types';
import { broadcastProjectionPayload, isProjectionWindowOpen, setProjectionWindow, getProjectionWindow } from './projectionService';

const STORAGE_KEY = 'kings_sword_saved_announcements';
const LAST_PROJECTED_KEY = 'kings_sword_last_projected_announcement';

export const DEFAULT_ANNOUNCEMENT_PRESETS: Announcement[] = [
  {
    id: 'preset-1',
    title: 'CULTE SPÉCIAL DE SAINTE-CÈNE',
    category: 'Sainte Cène',
    date: 'Ce Dimanche à 09h30',
    location: 'Sanctuaire Principal',
    content: '« Car toutes les fois que vous mangez ce pain et que vous buvez cette coupe, vous annoncez la mort du Seigneur, jusqu\'à ce qu\'il vienne. » (1 Cor 11:26)\n\n• Préparation des cœurs dans la prière et la méditation.\n• Lavement des pieds et service de communion fraternelle.\n• Bienvenue chaleureuse à tous les saints et frères de passage.',
    alignment: 'center',
    accentColor: 'teal',
    fontSize: 44,
    updatedAt: new Date().toISOString()
  },
  {
    id: 'preset-2',
    title: 'RÉUNION DE PRIÈRE & D\'INTERCESSION',
    category: 'Prière & Jeûne',
    date: 'Mercredi de 18h00 à 20h00',
    location: 'Salle de Prière',
    content: 'Venez nombreux chercher la face du Seigneur et intercéder pour les malades, les familles et l\'Église locale.\n\n• Sujet spécial : La persévérance et le réveil spirituel\n• Témoignages et louanges',
    alignment: 'center',
    accentColor: 'amber',
    fontSize: 44,
    updatedAt: new Date().toISOString()
  },
  {
    id: 'preset-3',
    title: 'BIENVENUE AUX NOUVEAUX VISITEURS',
    category: 'Accueil',
    date: 'Bienvenue parmi nous !',
    location: 'Sanctuaire',
    content: 'Nous sommes honorés de votre présence ce matin dans la maison du Seigneur.\n\n• Merci de vous manifester auprès du comité d\'accueil à la sortie pour un rafraîchissement fraternel.\n• Que la paix et la grâce de Jésus-Christ reposent sur vous !',
    alignment: 'center',
    accentColor: 'emerald',
    fontSize: 46,
    updatedAt: new Date().toISOString()
  },
  {
    id: 'preset-4',
    title: 'RÉUNION DE LA JEUNESSE',
    category: 'Jeunesse',
    date: 'Samedi à 16h00',
    location: 'Salle Polyvalente',
    content: 'Rencontre fraternelle et étude de la Parole pour tous les jeunes.\n\n• Thème : « La marche chrétienne dans ce siècle présent »\n• Temps d\'échange, questions-réponses et chants d\'adoration.',
    alignment: 'left',
    accentColor: 'blue',
    fontSize: 42,
    updatedAt: new Date().toISOString()
  }
];

export const getStoredAnnouncements = (): Announcement[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_ANNOUNCEMENT_PRESETS));
      return DEFAULT_ANNOUNCEMENT_PRESETS;
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
    return DEFAULT_ANNOUNCEMENT_PRESETS;
  } catch (e) {
    return DEFAULT_ANNOUNCEMENT_PRESETS;
  }
};

export const saveStoredAnnouncements = (announcements: Announcement[]): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(announcements));
  } catch (e) {
    console.error('Failed to save announcements:', e);
  }
};

export const getLastProjectedAnnouncement = (): Announcement | null => {
  try {
    const raw = localStorage.getItem(LAST_PROJECTED_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
};

export const setLastProjectedAnnouncement = (announcement: Announcement | null): void => {
  try {
    if (announcement) {
      localStorage.setItem(LAST_PROJECTED_KEY, JSON.stringify(announcement));
    } else {
      localStorage.removeItem(LAST_PROJECTED_KEY);
    }
  } catch (e) {}
};

/**
 * Broadcasts an announcement to the 2nd screen projection window.
 */
export const projectAnnouncementPayload = (
  announcement: Announcement,
  blackout: boolean = false
): void => {
  setLastProjectedAnnouncement(announcement);

  // Broadcast payload
  broadcastProjectionPayload({
    type: 'sync',
    title: announcement.title.trim() || "ANNONCE",
    date: announcement.category?.trim() || 'Annonce',
    time: announcement.date?.trim() || '',
    city: announcement.location?.trim() || '',
    text: announcement.content.trim(),
    fontSize: announcement.fontSize || 42,
    blackout,
    theme: 'dark',
    highlights: [],
    selectionIndices: [],
    searchResults: [],
    currentResultIndex: -1,
    activeDefinition: null,
    isBible: false,
    isAnnouncement: true,
    announcementAlignment: announcement.alignment || 'center'
  });
};
