/**
 * Utilitaire central pour la résolution et le chargement sécurisé de ressources statiques.
 * Compatible Web (HTTP/S) et Electron (protocol file://).
 */

export interface ResourceLoadError {
  primaryUrl: string;
  attemptedUrls: string[];
  failedAt: string;
  reason: string;
}

const resourceLoadErrors: ResourceLoadError[] = [];
type ResourceLoadErrorListener = (errors: ResourceLoadError[]) => void;
const errorListeners: Set<ResourceLoadErrorListener> = new Set();

export function recordResourceLoadError(primaryUrl: string, attemptedUrls: string[], reason = 'Fichier introuvable ou contenu JSON invalide'): void {
  const errItem: ResourceLoadError = {
    primaryUrl,
    attemptedUrls,
    failedAt: new Date().toLocaleTimeString(),
    reason
  };
  resourceLoadErrors.push(errItem);
  errorListeners.forEach(fn => {
    try { fn(getResourceLoadErrors()); } catch (e) {}
  });
}

export function getResourceLoadErrors(): ResourceLoadError[] {
  return [...resourceLoadErrors];
}

export function subscribeResourceLoadErrors(listener: ResourceLoadErrorListener): () => void {
  errorListeners.add(listener);
  listener(getResourceLoadErrors());
  return () => errorListeners.delete(listener);
}

/**
 * Résout une URL de ressource statique de manière sûre, sans jamais préfixer
 * un slash initial sous le protocole file:// (évite ERR_FILE_NOT_FOUND vers file:///C:/...).
 */
export function getStaticResourceUrl(relativePath: string): string {
  if (!relativePath) return '';
  if (relativePath.startsWith('http://') || relativePath.startsWith('https://') || relativePath.startsWith('data:')) {
    return relativePath;
  }

  // Séparer les paramètres de requête s'il y en a
  const [cleanPath, queryStr] = relativePath.split('?');
  const normalizedPath = cleanPath.replace(/^\/+/, '');
  const querySuffix = queryStr ? `?${queryStr}` : '';

  if (typeof window !== 'undefined' && window.location && window.location.protocol === 'file:') {
    const href = window.location.href;
    const dirPath = href.substring(0, href.lastIndexOf('/') + 1);
    return dirPath + normalizedPath + querySuffix;
  }

  return './' + normalizedPath + querySuffix;
}

export async function fetchJsonSafe<T = any>(
  primaryUrl: string,
  fallbackUrls: string[] = [],
  options?: RequestInit
): Promise<T | null> {
  const rawCandidateUrls = [primaryUrl, ...fallbackUrls];
  const resolvedUrls = rawCandidateUrls.map(u => getStaticResourceUrl(u));
  const uniqueUrls = Array.from(new Set(resolvedUrls));

  for (const url of uniqueUrls) {
    try {
      const res = await fetch(url, {
        cache: 'no-cache',
        ...options
      });
      if (!res.ok) continue;

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('text/html')) continue;

      const text = await res.text();
      const trimmed = text.trim();

      if (trimmed.startsWith('<') || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
        continue;
      }

      const parsed = JSON.parse(trimmed) as T;
      if (parsed !== null && parsed !== undefined) {
        return parsed;
      }
    } catch (err) {
      // Continuer vers l'URL suivante
    }
  }

  recordResourceLoadError(primaryUrl, uniqueUrls);
  return null;
}
