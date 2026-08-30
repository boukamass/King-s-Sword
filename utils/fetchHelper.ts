/**
 * Utilitaire pour effectuer des requêtes fetch sécurisées vers des fichiers JSON locaux ou distants.
 * Empêche les erreurs "Unexpected token '<', '<!doctype ...' is not valid JSON" lorsque le serveur SPA renvoie index.html (404 fallback).
 */

export async function fetchJsonSafe<T = any>(
  primaryUrl: string,
  fallbackUrls: string[] = [],
  options?: RequestInit
): Promise<T | null> {
  const allUrls = [primaryUrl, ...fallbackUrls];

  for (const url of allUrls) {
    try {
      const res = await fetch(url, {
        cache: 'no-cache',
        ...options
      });
      if (!res.ok) continue;

      const contentType = res.headers.get('content-type') || '';
      // Si la réponse est du HTML (ex: index.html servi en SPA fallback), ignorer
      if (contentType.includes('text/html')) continue;

      const text = await res.text();
      const trimmed = text.trim();
      
      // Vérifier que le texte ressemble à du JSON valide ({...} ou [...]) et non à du HTML (<!doctype...)
      if (trimmed.startsWith('<') || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
        continue;
      }

      const parsed = JSON.parse(trimmed) as T;
      if (parsed !== null && parsed !== undefined) {
        return parsed;
      }
    } catch (err) {
      // Ignorer et essayer l'URL suivante
    }
  }

  return null;
}
