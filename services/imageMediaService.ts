import { get as idbGet, set as idbSet } from 'idb-keyval';
import { ProjectedImageMedia, MediaFolder } from '../types';

const MEDIA_STORAGE_KEY = 'kings_sword_media_images_v1';
const FOLDERS_STORAGE_KEY = 'kings_sword_media_folders_v1';

// Default folders for organizing projection images by theme
export const DEFAULT_MEDIA_FOLDERS: MediaFolder[] = [
  { id: 'folder-defaut', name: "Images d'Origine", color: 'teal', createdAt: new Date().toISOString() },
  { id: 'folder-captures', name: 'Captures de Projection', color: 'amber', createdAt: new Date().toISOString() },
  { id: 'folder-annonces', name: 'Annonces', color: 'indigo', createdAt: new Date().toISOString() },
  { id: 'folder-importes', name: 'Images Importées', color: 'emerald', createdAt: new Date().toISOString() }
];

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
    createdAt: new Date().toISOString(),
    folderId: 'folder-defaut'
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
    createdAt: new Date().toISOString(),
    folderId: 'folder-defaut'
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
    createdAt: new Date().toISOString(),
    folderId: 'folder-defaut'
  },
  {
    id: 'preset-starry-galaxy',
    name: 'Ciel Étoilé & Galaxie (Majesté Divine)',
    url: 'https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?q=80&w=1600&auto=format&fit=crop',
    orientation: 'landscape',
    aspectRatio: 1.77,
    width: 1600,
    height: 900,
    caption: '« Les cieux racontent la gloire de Dieu, Et l\'étendue manifeste l\'ouvrage de ses mains. » (Psaumes 19:1)',
    createdAt: new Date().toISOString(),
    folderId: 'folder-defaut'
  },
  {
    id: 'preset-stained-glass-rays',
    name: 'Vitraux Sacrés & Lumière Divinatoire',
    url: 'https://images.unsplash.com/photo-1519817650390-64a93db51149?q=80&w=1600&auto=format&fit=crop',
    orientation: 'landscape',
    aspectRatio: 1.6,
    width: 1600,
    height: 1000,
    caption: 'Lumière céleste traversant les sanctuaires de prière',
    createdAt: new Date().toISOString(),
    folderId: 'folder-defaut'
  },
  {
    id: 'preset-peaceful-lake',
    name: 'Lac Paisible & Réflection Céleste',
    url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?q=80&w=1600&auto=format&fit=crop',
    orientation: 'landscape',
    aspectRatio: 1.77,
    width: 1600,
    height: 900,
    caption: '« Il me fait reposer dans de meurs pâturages, Il me dirige près des eaux paisibles. » (Psaumes 23:2)',
    createdAt: new Date().toISOString(),
    folderId: 'folder-defaut'
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
    createdAt: new Date().toISOString(),
    folderId: 'folder-defaut'
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
    createdAt: new Date().toISOString(),
    folderId: 'folder-defaut'
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
    createdAt: new Date().toISOString(),
    folderId: 'folder-defaut'
  },
  {
    id: 'preset-golden-sky-clouds',
    name: 'Nuages Dorés & Horizon Éclatant',
    url: 'https://images.unsplash.com/photo-1513002749550-c59d786b8e6c?q=80&w=1600&auto=format&fit=crop',
    orientation: 'landscape',
    aspectRatio: 1.77,
    width: 1600,
    height: 900,
    caption: 'Horizon d\'adoration céleste',
    createdAt: new Date().toISOString(),
    folderId: 'folder-defaut'
  },
  {
    id: 'preset-bokeh-warm-lights',
    name: 'Lumières Douces (Ambiance Culte)',
    url: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?q=80&w=1600&auto=format&fit=crop',
    orientation: 'landscape',
    aspectRatio: 1.77,
    width: 1600,
    height: 900,
    caption: 'Atmosphère de louange et de communion spirituelle',
    createdAt: new Date().toISOString(),
    folderId: 'folder-defaut'
  },
  {
    id: 'preset-ethereal-light-beam',
    name: 'Faisceau de Lumière Céleste',
    url: 'https://images.unsplash.com/photo-1518495973542-4542c06a5843?q=80&w=1600&auto=format&fit=crop',
    orientation: 'portrait',
    aspectRatio: 0.67,
    width: 1000,
    height: 1500,
    caption: 'Rayonnement de bénédiction et d\'inspiration',
    createdAt: new Date().toISOString(),
    folderId: 'folder-defaut'
  }
];

/**
 * Preloads an image into browser cache memory for instant rendering.
 */
export const preloadImage = (url: string): void => {
  if (!url) return;
  const img = new Image();
  img.referrerPolicy = 'no-referrer';
  img.src = url;
};

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
 * Loads media folders from IndexedDB/LocalStorage, initializing defaults if empty.
 */
export const getStoredMediaFolders = async (): Promise<MediaFolder[]> => {
  const legacyIds = new Set(['folder-surnaturel', 'folder-culte', 'folder-nature', 'folder-symboles']);

  try {
    const data = await idbGet<MediaFolder[]>(FOLDERS_STORAGE_KEY);
    if (data && Array.isArray(data) && data.length > 0) {
      // Filter out old default folders and ensure new defaults exist
      const userCustomFolders = data.filter(f => !legacyIds.has(f.id));
      const existingIds = new Set(userCustomFolders.map(f => f.id));
      const missingDefaults = DEFAULT_MEDIA_FOLDERS.filter(def => !existingIds.has(def.id));

      if (missingDefaults.length > 0 || userCustomFolders.length !== data.length) {
        const merged = [...DEFAULT_MEDIA_FOLDERS, ...userCustomFolders.filter(f => !DEFAULT_MEDIA_FOLDERS.some(d => d.id === f.id))];
        await saveStoredMediaFolders(merged);
        return merged;
      }
      return data;
    }
  } catch (e) {
    try {
      const ls = localStorage.getItem(FOLDERS_STORAGE_KEY);
      if (ls) {
        const parsed = JSON.parse(ls);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (_) {}
  }
  await saveStoredMediaFolders(DEFAULT_MEDIA_FOLDERS);
  return DEFAULT_MEDIA_FOLDERS;
};

/**
 * Persists media folders to IndexedDB and LocalStorage fallback.
 */
export const saveStoredMediaFolders = async (folders: MediaFolder[]): Promise<void> => {
  try {
    await idbSet(FOLDERS_STORAGE_KEY, folders);
  } catch (e) {
    try {
      localStorage.setItem(FOLDERS_STORAGE_KEY, JSON.stringify(folders));
    } catch (_) {}
  }
};

/**
 * Asynchronously downloads remote image URLs and converts them to local base64 Data URLs in IndexedDB.
 * This guarantees that all default and imported images are stored 100% locally for offline usage.
 */
export const cacheRemoteImagesLocally = async (images: ProjectedImageMedia[]): Promise<void> => {
  let modified = false;
  const updatedImages = [...images];

  for (let i = 0; i < updatedImages.length; i++) {
    const img = updatedImages[i];
    if (img.url && img.url.startsWith('http')) {
      try {
        const response = await fetch(img.url, { mode: 'cors' });
        if (response.ok) {
          const blob = await response.blob();
          const base64Url = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });

          if (base64Url && base64Url.startsWith('data:image')) {
            updatedImages[i] = { ...img, url: base64Url };
            modified = true;
          }
        }
      } catch (err) {
        // Skip silently if network or CORS fails
      }
    }
  }

  if (modified) {
    await saveStoredMediaImages(updatedImages);
  }
};

/**
 * Loads media images from IndexedDB, initializing with presets if empty.
 */
export const getStoredMediaImages = async (): Promise<ProjectedImageMedia[]> => {
  const legacyIds = new Set(['folder-surnaturel', 'folder-culte', 'folder-nature', 'folder-symboles']);

  try {
    const data = await idbGet<ProjectedImageMedia[]>(MEDIA_STORAGE_KEY);
    if (data && Array.isArray(data) && data.length > 0) {
      // Preload images into memory
      data.forEach(img => preloadImage(img.url));

      // Attach folderId to default presets or migrate legacy folderIds
      const presetMap = new Map(DEFAULT_PRESET_IMAGES.map(p => [p.id, p.folderId]));
      let updated = false;
      const normalized = data.map(img => {
        if (presetMap.has(img.id)) {
          const expected = presetMap.get(img.id);
          if (img.folderId !== expected) {
            updated = true;
            return { ...img, folderId: expected };
          }
        } else if (img.folderId && legacyIds.has(img.folderId)) {
          updated = true;
          return { ...img, folderId: 'folder-defaut' };
        } else if (!img.folderId) {
          updated = true;
          const isCapture = img.name.toLowerCase().startsWith('capture');
          return { ...img, folderId: isCapture ? 'folder-captures' : 'folder-importes' };
        }
        return img;
      });

      // Automatically merge missing default preset images if any
      const existingIds = new Set(normalized.map(img => img.id));
      const missingPresets = DEFAULT_PRESET_IMAGES.filter(preset => !existingIds.has(preset.id));
      let finalImages = normalized;

      if (missingPresets.length > 0) {
        finalImages = [...normalized, ...missingPresets];
        await saveStoredMediaImages(finalImages);
      } else if (updated) {
        await saveStoredMediaImages(finalImages);
      }

      // Background local caching of remote HTTP images to Base64
      setTimeout(() => {
        cacheRemoteImagesLocally(finalImages).catch(() => {});
      }, 500);

      return finalImages;
    }
  } catch (e) {
    try {
      const ls = localStorage.getItem(MEDIA_STORAGE_KEY);
      if (ls) {
        const parsed = JSON.parse(ls);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (_) {}
  }
  // Initialize with presets
  DEFAULT_PRESET_IMAGES.forEach(img => preloadImage(img.url));
  await saveStoredMediaImages(DEFAULT_PRESET_IMAGES);

  // Background local caching of remote HTTP images to Base64
  setTimeout(() => {
    cacheRemoteImagesLocally(DEFAULT_PRESET_IMAGES).catch(() => {});
  }, 500);

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
