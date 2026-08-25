/**
 * Helper sécurisé pour récupérer la clé API Gemini :
 * 1. Clé personnalisée renseignée par l'utilisateur dans son navigateur/ordinateur (localStorage)
 * 2. Clé d'environnement globale (process.env.API_KEY)
 */
export const getGeminiApiKey = (): string | undefined => {
  try {
    const userCustomKey = localStorage.getItem('kings_sword_user_gemini_key')?.trim();
    if (userCustomKey && userCustomKey.length > 5) {
      return userCustomKey;
    }
  } catch (e) {
    // localStorage non disponible ou restreint
  }

  return process.env.API_KEY;
};

export const setGeminiApiKey = (key: string): void => {
  try {
    const trimmed = key.trim();
    if (!trimmed) {
      localStorage.removeItem('kings_sword_user_gemini_key');
    } else {
      localStorage.setItem('kings_sword_user_gemini_key', trimmed);
    }
  } catch (e) {
    console.error("Impossible de sauvegarder la clé API locale:", e);
  }
};

export const hasValidGeminiApiKey = (): boolean => {
  const key = getGeminiApiKey();
  return !!key && key.length > 5;
};
