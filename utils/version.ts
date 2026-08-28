// Gestionnaire et exposant universel de la version de l'application
declare const __APP_VERSION__: string | undefined;

/**
 * Retourne la version actuelle de l'application configurée dans package.json
 */
export const getAppVersion = (): string => {
  if (typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__) {
    return __APP_VERSION__;
  }
  if (typeof process !== 'undefined' && process.env?.APP_VERSION) {
    return process.env.APP_VERSION;
  }
  return '2.0.0';
};

export const APP_VERSION = getAppVersion();
