// Helper universel sécurisé pour la gestion, le chiffrement et la persistance de la clé API Gemini
let inMemoryApiKey: string | undefined = undefined;

/**
 * Nettoie scrupuleusement une clé API saisie par l'utilisateur
 * (supprime les espaces insécables, retours à la ligne, guillemets accidentels issus d'un copier/coller)
 */
export const cleanApiKey = (raw: string | undefined | null): string => {
  if (!raw || typeof raw !== 'string') return '';
  return raw
    .trim()
    .replace(/^["'`\s]+|["'`\s]+$/g, '')
    .trim();
};

/**
 * Initialisation asynchrone sécurisée de la clé au démarrage de l'application :
 * 1. Vérifie le cache mémoire immédiat
 * 2. Sous Electron : interroge SQLite sécurisé (key_value_store) et déchiffre via les primitives DPAPI/AES
 * 3. En mode Navigateur : lit le localStorage
 * 4. Fallback : variables d'environnement (GEMINI_API_KEY / API_KEY)
 */
export const initGeminiApiKey = async (): Promise<string | undefined> => {
  // 1. Cache mémoire déjà présent
  if (inMemoryApiKey && inMemoryApiKey.length > 5) {
    return inMemoryApiKey;
  }

  // 2. Environnement Electron : lecture SQLite prioritaire (source de vérité sécurisée)
  if (typeof window !== 'undefined' && window.electronAPI?.db?.getKV && window.electronAPI?.security?.decryptSecureData) {
    try {
      const encrypted = await window.electronAPI.db.getKV('gemini_api_key_enc');
      if (encrypted && typeof encrypted === 'string' && encrypted.length > 5) {
        const decrypted = await window.electronAPI.security.decryptSecureData(encrypted);
        const cleaned = cleanApiKey(decrypted);
        if (cleaned && cleaned.length > 5) {
          inMemoryApiKey = cleaned;
          return inMemoryApiKey;
        }
      }
    } catch (electronErr) {
      console.warn("[Security] Échec de lecture de la clé depuis SQLite sécurisé:", electronErr);
    }
  }

  // 3. Environnement Navigateur / Web : lecture du localStorage
  try {
    if (typeof localStorage !== 'undefined') {
      const rawVal = localStorage.getItem('kings_sword_user_gemini_key');
      const cleaned = cleanApiKey(rawVal);
      if (cleaned && cleaned.length > 5) {
        inMemoryApiKey = cleaned;
        return inMemoryApiKey;
      }
    }
  } catch (e) {
    // localStorage inaccessible (navigation privée stricte, etc.)
  }

  // 4. Variables d'environnement
  const envKey = (typeof process !== 'undefined' && (process.env.GEMINI_API_KEY || process.env.API_KEY)) ||
                 (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_GEMINI_API_KEY);
  const cleanedEnv = cleanApiKey(envKey);
  if (cleanedEnv && cleanedEnv.length > 5) {
    inMemoryApiKey = cleanedEnv;
    return inMemoryApiKey;
  }

  return undefined;
};

/**
 * Récupération synchrone de la clé API pour les appels de services (sans condition de course si initGeminiApiKey a tourné)
 */
export const getGeminiApiKey = (): string | undefined => {
  if (inMemoryApiKey && inMemoryApiKey.length > 5) {
    return inMemoryApiKey;
  }

  // Fallback direct localStorage si non encore en mémoire (ex: avant fin de initGeminiApiKey)
  try {
    if (typeof localStorage !== 'undefined') {
      const rawVal = localStorage.getItem('kings_sword_user_gemini_key');
      const cleaned = cleanApiKey(rawVal);
      if (cleaned && cleaned.length > 5) {
        inMemoryApiKey = cleaned;
        return inMemoryApiKey;
      }
    }
  } catch (e) {}

  const envKey = (typeof process !== 'undefined' && (process.env.GEMINI_API_KEY || process.env.API_KEY)) ||
                 (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_GEMINI_API_KEY);
  const cleanedEnv = cleanApiKey(envKey);
  if (cleanedEnv && cleanedEnv.length > 5) {
    inMemoryApiKey = cleanedEnv;
    return inMemoryApiKey;
  }

  return undefined;
};

/**
 * Enregistrement sécurisé de la clé API :
 * - Stocke en mémoire cache immédiate
 * - Sous Electron : chiffre et enregistre dans SQLite sécurisé (key_value_store)
 * - En Navigateur : persiste dans localStorage
 */
export const setGeminiApiKey = async (key: string): Promise<void> => {
  try {
    const cleaned = cleanApiKey(key);
    inMemoryApiKey = cleaned || undefined;

    const isElectron = Boolean(typeof window !== 'undefined' && window.electronAPI?.db?.setKV);

    if (isElectron && window.electronAPI?.security?.encryptSecureData) {
      // Mode Electron : persistance SQLite sécurisée
      if (!cleaned) {
        await window.electronAPI.db.setKV('gemini_api_key_enc', '');
      } else {
        const encrypted = await window.electronAPI.security.encryptSecureData(cleaned);
        if (encrypted) {
          await window.electronAPI.db.setKV('gemini_api_key_enc', encrypted);
        }
      }
    } else {
      // Mode Navigateur / Web : persistance localStorage
      if (typeof localStorage !== 'undefined') {
        if (!cleaned) {
          localStorage.removeItem('kings_sword_user_gemini_key');
        } else {
          localStorage.setItem('kings_sword_user_gemini_key', cleaned);
        }
      }
    }
  } catch (e) {
    console.error("Erreur lors de la sauvegarde de la clé API:", e);
  }
};

/**
 * Vérifie si une clé API d'au moins 6 caractères est configurée
 */
export const hasValidGeminiApiKey = (): boolean => {
  const key = getGeminiApiKey();
  return Boolean(key && key.length > 5);
};
