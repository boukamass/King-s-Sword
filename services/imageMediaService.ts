import { get as idbGet, set as idbSet } from 'idb-keyval';
import { ProjectedImageMedia } from '../types';

const MEDIA_STORAGE_KEY = 'kings_sword_media_images_v1';

// Inspiring preset media images for services, preaching, announcements and worship
export const DEFAULT_PRESET_IMAGES: ProjectedImageMedia[] = [
  {
    id: 'preset-pillar-of-fire',
    name: 'La Colonne de Feu (Houston 1950)',
    url: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?q=80&w=1600&auto=format&fit=crop',
    orientation: 'portrait',
    aspectRatio: 0.75,
    width: 1200,
    height: 1600,
    caption: 'La Colonne de Feu au-dessus du prophète William Marrion Branham - Houston, Texas (1950)',
    createdAt: new Date().toISOString()
  },
  {
    id: 'preset-supernatural-cloud',
    name: 'La Nuée Surnaturelle (Sunset 1963)',
    url: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?q=80&w=1600&auto=format&fit=crop',
    orientation: 'landscape',
    aspectRatio: 1.77,
    width: 1600,
    height: 900,
    caption: 'Les Sept Anges et la Nuée Mystérieuse - Arizona (1963)',
    createdAt: new Date().toISOString()
  },
  {
    id: 'preset-holy-bible',
    name: 'La Sainte Bible Ouverte',
    url: 'https://images.unsplash.com/photo-1504052434569-70ad5836ab65?q=80&w=1600&auto=format&fit=crop',
    orientation: 'landscape',
    aspectRatio: 1.5,
    width: 1600,
    height: 1067,
    caption: '« Ta parole est une lampe à mes pieds, Et une lumière sur mon sentier. » (Psaumes 119:105)',
    createdAt: new Date().toISOString()
  },
  {
    id: 'preset-eagle-flight',
    name: "L'Aigle dans les Hauteurs",
    url: 'https://images.unsplash.com/photo-1611689342806-0863700ce1e4?q=80&w=1600&auto=format&fit=crop',
    orientation: 'landscape',
    aspectRatio: 1.5,
    width: 1600,
    height: 1067,
    caption: '« Mais ceux qui se confient en l\'Éternel renouvellent leur force. Ils prennent le vol comme les aigles... » (Ésaïe 40:31)',
    createdAt: new Date().toISOString()
  },
  {
    id: 'preset-sunset-mountain',
    name: 'Montagnes au Coucher du Soleil',
    url: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?q=80&w=1600&auto=format&fit=crop',
    orientation: 'landscape',
    aspectRatio: 1.6,
    width: 1600,
    height: 1000,
    caption: '« Au temps du soir la lumière paraîtra. » (Zacharie 14:7)',
    createdAt: new Date().toISOString()
  },
  {
    id: 'preset-cross-worship',
    name: 'La Croix & Rayons de Gloire',
    url: 'https://images.unsplash.com/photo-1544642899-f0d453658900?q=80&w=1600&auto=format&fit=crop',
    orientation: 'portrait',
    aspectRatio: 0.67,
    width: 1000,
    height: 1500,
    caption: '« Car Dieu a tant aimé le monde qu\'il a donné son Fils unique... » (Jean 3:16)',
    createdAt: new Date().toISOString()
  }
];

/**
 * Automatically detects image orientation, aspect ratio, natural dimensions and returns formatted info.
 */
export const detectImageMeta = (
  source: string
): Promise<{
  orientation: 'landscape' | 'portrait' | 'square';
  aspectRatio: number;
  width: number;
  height: number;
  url: string;
}> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const width = img.naturalWidth || img.width || 1920;
      const height = img.naturalHeight || img.height || 1080;
      const aspectRatio = width / (height || 1);

      let orientation: 'landscape' | 'portrait' | 'square' = 'landscape';
      if (aspectRatio > 1.12) {
        orientation = 'landscape';
      } else if (aspectRatio < 0.89) {
        orientation = 'portrait';
      } else {
        orientation = 'square';
      }

      resolve({
        orientation,
        aspectRatio: Number(aspectRatio.toFixed(3)),
        width,
        height,
        url: source
      });
    };
    img.onerror = () => {
      // Fallback in case of CORS or loading issue on dimension probing
      resolve({
        orientation: 'landscape',
        aspectRatio: 1.777,
        width: 1920,
        height: 1080,
        url: source
      });
    };
    img.src = source;
  });
};

/**
 * Loads media images from IndexedDB, initializing with presets if empty.
 */
export const getStoredMediaImages = async (): Promise<ProjectedImageMedia[]> => {
  try {
    const data = await idbGet<ProjectedImageMedia[]>(MEDIA_STORAGE_KEY);
    if (data && Array.isArray(data) && data.length > 0) {
      return data;
    }
  } catch (e) {
    try {
      const ls = localStorage.getItem(MEDIA_STORAGE_KEY);
      if (ls) return JSON.parse(ls);
    } catch (_) {}
  }
  // Initialize with presets
  await saveStoredMediaImages(DEFAULT_PRESET_IMAGES);
  return DEFAULT_PRESET_IMAGES;
};

/**
 * Persists media images to IndexedDB and LocalStorage fallback.
 */
export const saveStoredMediaImages = async (images: ProjectedImageMedia[]): Promise<void> => {
  try {
    await idbSet(MEDIA_STORAGE_KEY, images);
  } catch (e) {
    try {
      // Keep only first 20 in localStorage to avoid quota limits if base64
      const trimmed = images.slice(0, 20);
      localStorage.setItem(MEDIA_STORAGE_KEY, JSON.stringify(trimmed));
    } catch (_) {}
  }
};
