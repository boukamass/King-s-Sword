/**
 * King's Sword — Service de Détection d'Intention des Requêtes (Unified RAG)
 * 
 * Classifieur autonome et déterministe (sans appel Gemini supplémentaire) :
 * - CONTENT_TRANSFORMATION : instruction de transformation, résumé, explication, simplification,
 *   traduction ou extraction d'idées sur un contenu sélectionné/disponible dans l'AI Context.
 * - DOCUMENT_RETRIEVAL : question de recherche documentaire ou doctrinale dans l'ensemble du corpus.
 * 
 * Tolérance absolue : Fautes de frappe, langage SMS, abréviations ("Reum c txt n 4 lgns"),
 * absence d'accents et mots tronqués.
 */

import { normalizeText } from '../utils/textUtils';

export type QueryIntentType = 'CONTENT_TRANSFORMATION' | 'DOCUMENT_RETRIEVAL';

export interface QueryIntentResult {
  intent: QueryIntentType;
  requestedLineCount?: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  route: 'SELECTED_CONTEXT_GENERATION' | 'UNIFIED_RAG';
}

/**
 * Extrait le nombre de lignes éventuellement demandé dans la requête (ex: "4 lignes", "n 4 lgns", "3 lgn", "en 4")
 */
export function extractRequestedLineCount(query: string): number | undefined {
  if (!query || typeof query !== 'string') return undefined;
  const raw = query.trim();
  const norm = normalizeText(raw).toLowerCase();

  const patterns = [
    /(\d+)\s*(?:lignes|ligne|lgns|lgne|lgn|lines|line)\b/i,
    /\b(?:en|n|sur|de|max|fais|faites|fai)\s*(\d+)\s*(?:lignes|ligne|lgns|lgne|lgn|lines|line)?\b/i,
    /\b(?:résumé|resume|resum|reum|rsm)\s*(?:de|en|n)?\s*(\d+)\s*(?:lignes|ligne|lgns|lgne|lgn|lines|line)?\b/i,
    /\b(?:en|n)\s*(\d+)\b/i
  ];

  for (const pat of patterns) {
    const match = raw.match(pat) || norm.match(pat);
    if (match && match[1]) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > 0 && num <= 100) {
        return num;
      }
    }
  }

  return undefined;
}

/**
 * Classifie l'intention de la requête utilisateur de manière déterministe.
 */
export function detectQueryIntent(query: string): QueryIntentResult {
  if (!query || typeof query !== 'string' || !query.trim()) {
    return {
      intent: 'DOCUMENT_RETRIEVAL',
      confidence: 'HIGH',
      route: 'UNIFIED_RAG'
    };
  }

  const rawQuery = query.trim();
  const normQuery = normalizeText(rawQuery).toLowerCase();
  const requestedLineCount = extractRequestedLineCount(rawQuery);

  // Mots / racines d'action de transformation (supporte fautes et SMS)
  const transformationStems = [
    // Résumé / Synthèse
    'resum', 'reum', 'rsm', 'synth', 'survol', 'apercu', 'condens', 'raccourc', 'redui',
    // Explication / Simplification
    'explik', 'expliq', 'expliqu', 'explain', 'simplif', 'reformul', 'eclairc', 'vulgaris',
    // Traduction / Correction
    'tradui', 'traduir', 'translat', 'corrig',
    // Extraction d'idées ou de points
    'idees principal', 'idee principal', 'points important', 'point important', 'points cles', 'point cle',
    'idees cles', 'points fort', 'les points', 'idees'
  ];

  // Mots / abréviations désignant le contenu ou texte
  const contextTargetTerms = [
    'ce texte', 'c txt', 'ce passage', 'c passage', 'ce doc', 'ce document',
    'cet extrait', 'ce chapitre', 'ce sermon', 'ce livre', 'ce contenu', 'le texte', 'le passage', 'txt'
  ];

  // Directives courantes
  const directCommands = [
    'fais un resume', 'fai un resume', 'faites un resume', 'fais 1 resume',
    'fais un rsm', 'fai 1 rsm', 'donne moi les idees', 'donne moi les points',
    'donne les idees', 'donne les points', 'extrayez', 'extrais', 'fais-moi'
  ];

  const hasTransformationAction = transformationStems.some(s => normQuery.includes(s)) ||
    /\b(resum|reum|rsm|explik|expliq|simplif|tradui)\b/i.test(normQuery) ||
    requestedLineCount !== undefined;

  const hasContextTarget = contextTargetTerms.some(t => normQuery.includes(t)) ||
    /\b(?:txt|passage|extrait|texte|doc)\b/i.test(normQuery);

  const hasDirectCommand = directCommands.some(c => normQuery.includes(c));

  // Exclure les questions documentaires doctrinales spécifiques sur des sujets du corpus
  const isDoctrinalSearch = (
    /\b(que dit|pourquoi|comment|quand|ou|qui est|qui etait|quel est|quelle est|quels sont|quelles sont)\b/i.test(normQuery) &&
    !hasContextTarget &&
    !hasDirectCommand &&
    !normQuery.startsWith('explik') &&
    !normQuery.startsWith('resum') &&
    !normQuery.startsWith('reum')
  );

  if (!isDoctrinalSearch && (
    (hasTransformationAction && (hasContextTarget || requestedLineCount !== undefined || hasDirectCommand)) ||
    (hasTransformationAction && normQuery.length < 50 && !/\b(branham|serpent|cain|abel|pergame|bapteme|epouse|sceau|troisieme)\b/i.test(normQuery))
  )) {
    return {
      intent: 'CONTENT_TRANSFORMATION',
      requestedLineCount,
      confidence: 'HIGH',
      route: 'SELECTED_CONTEXT_GENERATION'
    };
  }

  return {
    intent: 'DOCUMENT_RETRIEVAL',
    confidence: 'HIGH',
    route: 'UNIFIED_RAG'
  };
}

/**
 * Affiche les logs structurés obligatoires pour la vérification et les tests.
 */
export function logQueryIntent(params: {
  query: string;
  aiContextDescription: string;
  intentResult: QueryIntentResult;
}): void {
  const { query, aiContextDescription, intentResult } = params;
  console.log(`QUERY: ${query}`);
  console.log(`AI CONTEXT: ${aiContextDescription}`);
  console.log(`DETECTED INTENT: ${intentResult.intent}`);
  console.log(`CONFIDENCE: ${intentResult.confidence}`);
  if (intentResult.requestedLineCount !== undefined) {
    console.log(`REQUESTED LINE COUNT: ${intentResult.requestedLineCount}`);
  }
  console.log(`ROUTE: ${intentResult.route}`);
}
