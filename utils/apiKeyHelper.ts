let inMemoryApiKey: string | undefined = undefined;

/**
 * Helper sécurisé pour récupérer la clé API Gemini :
 * 1. Clé en mémoire / cache déchiffré
 * 2. Clé personnalisée renseignée par l'utilisateur (localStorage ou SQLite)
 * 3. Clé d'environnement globale (process.env.API_KEY)
 */
export const getGeminiApiKey = (): string | undefined => {
  if (inMemoryApiKey && inMemoryApiKey.length > 5) {
    return inMemoryApiKey;
  }

  try {
    const rawVal = localStorage.getItem('kings_sword_user_gemini_key')?.trim();
    if (rawVal && rawVal.length > 5) {
      inMemoryApiKey = rawVal;
      return inMemoryApiKey;
    }
  } catch (e) {
    // localStorage non disponible ou restreint
  }

  const envKey = (typeof process !== 'undefined' && (process.env.GEMINI_API_KEY || process.env.API_KEY)) ||
                 (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_GEMINI_API_KEY);
  return envKey || undefined;
};

export const setGeminiApiKey = (key: string): void => {
  try {
    const trimmed = key.trim();
    inMemoryApiKey = trimmed || undefined;
    if (!trimmed) {
      localStorage.removeItem('kings_sword_user_gemini_key');
      if (window.electronAPI?.db?.setKV) {
        window.electronAPI.db.setKV('gemini_api_key_enc', '');
      }
    } else {
      localStorage.setItem('kings_sword_user_gemini_key', trimmed);
      if (window.electronAPI?.security?.encryptSecureData && window.electronAPI?.db?.setKV) {
        window.electronAPI.security.encryptSecureData(trimmed).then((encrypted) => {
          if (encrypted) {
            window.electronAPI.db.setKV('gemini_api_key_enc', encrypted);
          }
        }).catch(() => {});
      }
    }
  } catch (e) {
    console.error("Impossible de sauvegarder la clé API locale:", e);
  }
};

export const hasValidGeminiApiKey = (): boolean => {
  const key = getGeminiApiKey();
  return !!key && key.length > 5;
};
