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
  // 0. Fournisseur d'IA choisi et clés des autres fournisseurs (Mistral, Groq, OpenRouter)
  try {
    await initAiProviderSettings();
  } catch (e) {
    console.warn("[Security] Échec de lecture des réglages du fournisseur d'IA:", e);
  }

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
 * Nettoie et extrait une liste de clés API valides saisies par l'utilisateur
 * (supporte plusieurs clés séparées par une virgule, un point-virgule ou un retour à la ligne)
 */
export const extractAllApiKeys = (raw: string | undefined | null): string[] => {
  if (!raw || typeof raw !== 'string') return [];
  return raw
    .split(/[\n,;]+/)
    .map(k => cleanApiKey(k))
    .filter(k => k.length > 5);
};

/**
 * Récupère la liste ordonnée de toutes les clés API disponibles
 */
export const getAllGeminiApiKeys = (): string[] => {
  const rawKey = getGeminiApiKey();
  const keys = extractAllApiKeys(rawKey);
  return keys.length > 0 ? keys : (rawKey ? [rawKey] : []);
};

/**
 * Vérifie si une clé API d'au moins 6 caractères est configurée
 */
export const hasValidGeminiApiKey = (): boolean => {
  const keys = getAllGeminiApiKeys();
  return keys.length > 0;
};

// ---------------------------------------------------------------------------
// Fournisseur d'IA (Gemini par défaut) et clés des fournisseurs compatibles OpenAI
// ---------------------------------------------------------------------------

export type AiProviderId = 'gemini' | 'mistral' | 'groq' | 'openrouter';

const AI_PROVIDER_IDS: AiProviderId[] = ['gemini', 'mistral', 'groq', 'openrouter'];
const AI_PROVIDER_STORAGE_KEY = 'kings_sword_ai_provider';
const AI_PROVIDER_KV_KEY = 'ai_provider';

let activeAiProvider: AiProviderId | undefined = undefined;
const inMemoryProviderKeys = new Map<AiProviderId, string>();

const isAiProviderId = (v: any): v is AiProviderId => AI_PROVIDER_IDS.includes(v);
const providerKvKey = (id: AiProviderId) => `${id}_api_key_enc`;
const providerLocalKey = (id: AiProviderId) => `kings_sword_user_${id}_key`;

/**
 * Lecture au démarrage du fournisseur choisi et des clés Mistral / Groq / OpenRouter
 * (Electron : SQLite chiffré ; navigateur : localStorage).
 */
export const initAiProviderSettings = async (): Promise<void> => {
  const hasElectronKV = typeof window !== 'undefined' && window.electronAPI?.db?.getKV;
  if (hasElectronKV) {
    try {
      const stored = await window.electronAPI.db.getKV(AI_PROVIDER_KV_KEY);
      if (isAiProviderId(stored)) activeAiProvider = stored;
    } catch {}
    if (window.electronAPI?.security?.decryptSecureData) {
      for (const id of AI_PROVIDER_IDS) {
        if (id === 'gemini') continue;
        try {
          const encrypted = await window.electronAPI.db.getKV(providerKvKey(id));
          if (encrypted && typeof encrypted === 'string' && encrypted.length > 5) {
            const cleaned = cleanApiKey(await window.electronAPI.security.decryptSecureData(encrypted));
            if (cleaned && cleaned.length > 5) inMemoryProviderKeys.set(id, cleaned);
          }
        } catch {}
      }
    }
  }
  try {
    if (typeof localStorage !== 'undefined') {
      if (!activeAiProvider) {
        const stored = localStorage.getItem(AI_PROVIDER_STORAGE_KEY);
        if (isAiProviderId(stored)) activeAiProvider = stored;
      }
      if (!hasElectronKV) {
        for (const id of AI_PROVIDER_IDS) {
          if (id === 'gemini' || inMemoryProviderKeys.has(id)) continue;
          const cleaned = cleanApiKey(localStorage.getItem(providerLocalKey(id)));
          if (cleaned && cleaned.length > 5) inMemoryProviderKeys.set(id, cleaned);
        }
      }
    }
  } catch {}
};

/** Fournisseur d'IA actif pour la rédaction des réponses (Gemini si rien n'a été choisi) */
export const getActiveAiProvider = (): AiProviderId => {
  if (activeAiProvider) return activeAiProvider;
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(AI_PROVIDER_STORAGE_KEY);
      if (isAiProviderId(stored)) {
        activeAiProvider = stored;
        return stored;
      }
    }
  } catch {}
  return 'gemini';
};

export const setActiveAiProvider = async (id: AiProviderId): Promise<void> => {
  if (!isAiProviderId(id)) return;
  activeAiProvider = id;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(AI_PROVIDER_STORAGE_KEY, id);
  } catch {}
  try {
    if (typeof window !== 'undefined' && window.electronAPI?.db?.setKV) {
      await window.electronAPI.db.setKV(AI_PROVIDER_KV_KEY, id);
    }
  } catch (e) {
    console.error("Erreur lors de la sauvegarde du fournisseur d'IA:", e);
  }
};

/** Clé(s) brute(s) d'un fournisseur (plusieurs clés possibles, une par ligne) */
export const getProviderApiKey = (id: AiProviderId): string | undefined => {
  if (id === 'gemini') return getGeminiApiKey();
  const inMemory = inMemoryProviderKeys.get(id);
  if (inMemory && inMemory.length > 5) return inMemory;
  // Navigateur : la clé est persistée dans localStorage (sous Electron, elle est chiffrée dans SQLite)
  const isElectron = Boolean(typeof window !== 'undefined' && window.electronAPI?.db?.getKV);
  if (!isElectron) {
    try {
      if (typeof localStorage !== 'undefined') {
        const cleaned = cleanApiKey(localStorage.getItem(providerLocalKey(id)));
        if (cleaned && cleaned.length > 5) {
          inMemoryProviderKeys.set(id, cleaned);
          return cleaned;
        }
      }
    } catch {}
  }
  return undefined;
};

export const setProviderApiKey = async (id: AiProviderId, key: string): Promise<void> => {
  if (id === 'gemini') return setGeminiApiKey(key);
  try {
    const cleaned = cleanApiKey(key);
    if (cleaned) inMemoryProviderKeys.set(id, cleaned);
    else inMemoryProviderKeys.delete(id);

    const isElectron = Boolean(typeof window !== 'undefined' && window.electronAPI?.db?.setKV);
    if (isElectron && window.electronAPI?.security?.encryptSecureData) {
      if (!cleaned) {
        await window.electronAPI.db.setKV(providerKvKey(id), '');
      } else {
        const encrypted = await window.electronAPI.security.encryptSecureData(cleaned);
        if (encrypted) await window.electronAPI.db.setKV(providerKvKey(id), encrypted);
      }
    } else if (typeof localStorage !== 'undefined') {
      if (!cleaned) localStorage.removeItem(providerLocalKey(id));
      else localStorage.setItem(providerLocalKey(id), cleaned);
    }
  } catch (e) {
    console.error("Erreur lors de la sauvegarde de la clé API:", e);
  }
};

/** Vrai si le fournisseur actif dispose d'au moins une clé */
export const hasActiveAiKey = (): boolean => {
  const id = getActiveAiProvider();
  if (id === 'gemini') return hasValidGeminiApiKey();
  return extractAllApiKeys(getProviderApiKey(id)).length > 0;
};
