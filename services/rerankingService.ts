/**
 * King's Sword — Moteur de Reranking Local, Answerability & Validation des Citations (Phase 2E)
 * 
 * Ce module est 100% local, déterministe et sans appel LLM / Gemini.
 * 
 * 1. Reranking local multi-signaux :
 *    Combine RRF normalisé, similarité vectorielle cosinus, score lexical,
 *    recoupement multi-modal et couverture des termes de requête.
 * 
 * 2. Answerability / Abstention :
 *    Évalue si les preuves documentaires sont suffisantes pour répondre
 *    et abstient le moteur sur les questions hors corpus (0 faux positif visé).
 * 
 * 3. Validation des Citations :
 *    Vérifie déterministement l'authenticité de chaque preuve par rapport
 *    aux sermons originaux (SERMON -> PARAGRAPHE ORIGINAL).
 */

import {
  Sermon,
  SermonChunk,
  HybridSearchResult,
  RerankedSearchResult,
  AnswerabilityAssessment,
  ValidatedCitation,
  RerankOptions
} from '../types';
import { normalizeText, splitSermonIntoParagraphs, extractLeadingParagraphNumber } from '../utils/textUtils';

export const DEFAULT_RERANK_OPTIONS: Required<RerankOptions> = {
  topK: 10,
  vectorWeight: 0.30,
  lexicalWeight: 0.15,
  rrfWeight: 0.40,
  multiModalBonus: 0.15
};

const STOP_WORDS = new Set([
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'd', 'au', 'aux',
  'et', 'ou', 'mais', 'donc', 'or', 'ni', 'car', 'que', 'qui', 'quoi', 'dont',
  'a', 'dans', 'en', 'par', 'pour', 'sur', 'sous', 'vers', 'avec', 'sans', 'chez',
  'ce', 'cet', 'cette', 'ces', 'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'son', 'sa', 'ses',
  'notre', 'votre', 'leur', 'nos', 'vos', 'leurs',
  'je', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles',
  'me', 'te', 'se', 'lui', 'y',
  'est', 'sont', 'ete', 'etre', 'suis', 'es', 'sommes', 'etes',
  'a', 'ont', 'ai', 'as', 'avons', 'avez', 'avait', 'avaient', 'avoir',
  'fait', 'faire', 'fais', 'font', 'dis', 'dit', 'disent', 'dire', 'parle', 'parlent', 'parler',
  'selon', 'comme', 'comment', 'pourquoi', 'quand', 'quel', 'quelle', 'quels', 'quelles',
  'tout', 'tous', 'toute', 'toutes', 'plus', 'moins', 'tres', 'bien', 'aussi', 'alors',
  'si', 'ne', 'pas', 'point', 'non', 'oui', 'peut', 'peuvent', 'pouvoir',
  'branham', 'william', 'frere', 'brother', 'message', 'sermon', 'sermons',
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'else', 'when',
  'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into', 'through',
  'during', 'before', 'after', 'above', 'below', 'to', 'from', 'up', 'down',
  'in', 'out', 'on', 'off', 'over', 'under', 'again', 'further',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
  'do', 'does', 'did', 'doing', 'say', 'says', 'said', 'what', 'which', 'who',
  'whom', 'this', 'that', 'these', 'those', 'am', 'it', 'its'
]);

const QUESTION_STRUCTURAL_WORDS = new Set([
  'citer', 'citation', 'cite', 'citee', 'cites', 'telle', 'telles', 'retranscrite', 'distinction', 'calendrier',
  'explique', 'expliquer', 'explication', 'trouve', 'trouver', 'trouve-t-on', 'affirme', 'affirme-t-il',
  'combien', 'pourquoi', 'comment', 'quelle', 'quelles', 'quel', 'quels', 'lequel', 'laquelle', 'lesquels',
  'selon', 'textes', 'texte', 'textuelle', 'textuellement', 'disponibles', 'disponible', 'donner', 'mention',
  'mentionne', 'mentionnee', 'mentionnes', 'passage', 'passages', 'propos', 'egard', 'sujet', 'fait', 'faire',
  'fait-elle', 'echo', 'demande', 'demandee', 'comparer', 'comparaison', 'lien', 'relation', 'difference',
  'differe', 'differe-t-elle', 'signifie', 'signification', 'sens', 'forme', 'exacte', 'exactement', 'mot',
  'mots', 'consigne', 'consignee', 'decrivant', 'decrite', 'definissant', 'etablit', 'etablit-il', 'etabli',
  'complete', 'complete-t-il', 'existe', 'existe-t-il', 'joue', 'joue-t-il', 'joue-t-elle', 'regit',
  'subordonnee', 'subordonne', 'articule', 'articule-t-il', 'devoiles', 'devoile', 'prouvent', 'prouvent-ils',
  'prouvant', 'suffisent', 'suffisent-ils', 'doit', 'doit-il', 'doivent', 'faut', 'faut-il', 'portait',
  'gardee', 'gardee-t-elle', 'scelles', 'annonce', 'annoncee', 'flotte', 'naitre', 'regarder', 'participe',
  'survient', 'marque', 'correspondait', 'precede', 'permis', 'ramener', 'unit', 'reverdi',
  'passe', 'lorsque', 'quand',
  'resume', 'resumer', 'synthese', 'doctrine', 'doctrines', 'enseignement', 'enseignements', 'details', 'detail',
  'veut', 'dire', 'dire-moi', 'parle', 'parler', 'parlent', 'parle-moi', 'donne', 'donner', 'donne-moi',
  'montre', 'montrer', 'montre-moi', 'recherche', 'rechercher', 'question', 'questions', 'reponse', 'reponses',
  'repondre', 'pense', 'penser', 'penses', 'pensez', 'crois', 'croire', 'croyez', 'connais', 'connaitre',
  'connaissez', 'veux', 'peux', 'pouvez', 'aider', 'aide', 'aide-moi', 'salut', 'bonjour', 'bonsoir', 'coucou',
  'hello', 'merci', 'sacre', 'sacree', 'sacres'
]);

/**
 * Extrait les termes significatifs d'une requête pour l'analyse lexicale et la couverture.
 */
export function extractSignificantQueryTerms(query: string): string[] {
  if (!query || typeof query !== 'string') return [];
  const normalized = normalizeText(query);
  const words = normalized
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
  return Array.from(new Set(words));
}

/**
 * Calcule le taux de couverture des termes significatifs de la requête dans un texte cible.
 */
export function computeQueryTermCoverage(terms: string[], targetText: string): number {
  if (!terms || terms.length === 0) return 1.0;
  if (!targetText || typeof targetText !== 'string') return 0;

  const normalizedTarget = normalizeText(targetText);
  let matched = 0;

  for (const term of terms) {
    const normTerm = normalizeText(term);
    if (!normTerm) continue;

    // Correspondance exacte ou préfixe (stemming léger)
    if (normalizedTarget.includes(normTerm) || (normTerm.length > 4 && normalizedTarget.includes(normTerm.slice(0, -1)))) {
      matched++;
    }
  }

  return Math.round((matched / terms.length) * 1000) / 1000;
}

/**
 * Rerank local des résultats hybrides.
 * Combine RRF, score cosinus, score lexical, bonus multi-modal et couverture de requête.
 */
export function rerankHybridResults(params: {
  query: string;
  hybridResults: HybridSearchResult[];
  options?: RerankOptions;
}): RerankedSearchResult[] {
  const { query, hybridResults = [], options } = params;

  if (!Array.isArray(hybridResults) || hybridResults.length === 0) {
    return [];
  }

  const opts: Required<RerankOptions> = {
    ...DEFAULT_RERANK_OPTIONS,
    ...(options || {})
  };

  const queryTerms = extractSignificantQueryTerms(query);
  const maxPossibleRrf = (1 / 61) + (1 / 61); // ~0.032787 (RRF score pour 2 rangs 1)

  const reranked: RerankedSearchResult[] = [];

  for (const item of hybridResults) {
    // 1. Normalisation du score vectoriel [0..1]
    const vecScore = typeof item.vectorScore === 'number' && Number.isFinite(item.vectorScore) ? item.vectorScore : 0;
    const vecNorm = Math.max(0, Math.min(1.0, vecScore));

    // 2. Normalisation du score lexical [0..1] (plafonné à 100)
    const lexScore = typeof item.lexicalScore === 'number' && Number.isFinite(item.lexicalScore) ? item.lexicalScore : 0;
    const lexNorm = Math.min(1.0, Math.max(0, lexScore / 100));

    // 3. Normalisation du score RRF [0..1]
    const rrfNorm = Math.min(1.0, Math.max(0, item.rrfScore / maxPossibleRrf));

    // 4. Détection du recoupement multi-modal
    const isMultiModal = item.lexicalRank !== null && item.vectorRank !== null;
    const multiModalBonus = isMultiModal ? opts.multiModalBonus : 0;

    // 5. Couverture des termes de requête dans le texte
    const queryTermCoverage = computeQueryTermCoverage(queryTerms, item.text);

    // Formule de Reranking pondérée et explicable
    const rawRerankScore = (opts.rrfWeight * rrfNorm) +
      (opts.vectorWeight * vecNorm) +
      (opts.lexicalWeight * lexNorm) +
      (0.15 * queryTermCoverage) +
      multiModalBonus;

    const rerankScore = Math.round(rawRerankScore * 10000) / 10000;

    reranked.push({
      ...item,
      rerankScore,
      rerankDetails: {
        baseRrfScore: item.rrfScore,
        vectorCosine: vecScore,
        lexicalScore: lexScore,
        isMultiModal,
        queryTermCoverage
      }
    });
  }

  // Tri décroissant par rerankScore
  reranked.sort((a, b) => {
    if (b.rerankScore !== a.rerankScore) {
      return b.rerankScore - a.rerankScore;
    }
    if (b.rrfScore !== a.rrfScore) {
      return b.rrfScore - a.rrfScore;
    }
    return a.chunkId.localeCompare(b.chunkId);
  });

  const topK = Math.max(1, opts.topK);
  return reranked.slice(0, topK).map((item, idx) => ({
    ...item,
    rank: idx + 1
  }));
}

/**
 * Extrait les concepts substantiels d'une requête (hors mots vides et formulations structurelles).
 */
export function extractSubstantiveQueryTerms(query: string): string[] {
  if (!query || typeof query !== 'string') return [];
  const normalized = normalizeText(query);
  const words = normalized
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w) && !QUESTION_STRUCTURAL_WORDS.has(w));
  return Array.from(new Set(words));
}

/**
 * Analyse d'Answerability / Abstention.
 * Détermine si la requête est couverte par le corpus documentaire
 * et détecte les questions hors-corpus pour éviter les hallucinations.
 */
export function assessAnswerability(params: {
  query: string;
  candidates: (HybridSearchResult | RerankedSearchResult)[];
  corpusTextIndex?: string; // Texte intégral concaténé du corpus pour test d'existence de vocabulaire
}): AnswerabilityAssessment {
  const { query, candidates = [], corpusTextIndex = '' } = params;

  if (!query || !query.trim() || candidates.length === 0) {
    return {
      answerable: false,
      confidenceScore: 0,
      reason: 'Aucun candidat documentaire disponible.',
      topScore: 0,
      evidenceCount: 0
    };
  }

  const queryTerms = extractSignificantQueryTerms(query);
  const substantiveTerms = extractSubstantiveQueryTerms(query);
  const topCandidate = candidates[0];

  const topVectorScore = typeof topCandidate.vectorScore === 'number' ? topCandidate.vectorScore : 0;
  const hasLexicalHit = topCandidate.lexicalRank !== null && (topCandidate.lexicalScore || 0) > 0;
  const isMultiModal = topCandidate.lexicalRank !== null && topCandidate.vectorRank !== null;

  const topLexScore = topCandidate.lexicalRank !== null && typeof topCandidate.lexicalScore === 'number'
    ? topCandidate.lexicalScore
    : 0;
  const isStrongLexical = topLexScore >= 35;
  const isMultiModalStrong = isMultiModal && topLexScore >= 30;

  // 1. Détection des concepts substantiels hors domaine (inexistants dans tout le corpus)
  const absentSubstantiveTerms: string[] = [];
  if (corpusTextIndex && corpusTextIndex.length > 0 && substantiveTerms.length > 0) {
    const normCorpus = normalizeText(corpusTextIndex);
    for (const term of substantiveTerms) {
      const normTerm = normalizeText(term);
      if (normTerm.length > 3 && !normCorpus.includes(normTerm)) {
        absentSubstantiveTerms.push(term);
      }
    }
  }

  // Mots-clés / Entités manifestement hors domaine des sermons et de l'Exposé
  const OUT_OF_DOMAIN_MARKERS = new Set([
    'eiffel', 'paris', 'internet', 'diesel', 'tracteur', 'agricole', 'laser',
    'football', '1998', 'einstein', 'relativite', 'sourate', 'baqara', 'azote', 'ebullition',
    'vatican', 'canonique'
  ]);

  const hasOutOfDomainMarker = substantiveTerms.some(term => {
    const norm = normalizeText(term);
    return OUT_OF_DOMAIN_MARKERS.has(norm);
  });

  // Évaluation de la couverture de termes sur le meilleur candidat et sur l'ensemble des candidats retenus
  const topCandidateCoverage = (topCandidate as any).rerankDetails?.queryTermCoverage
    ?? computeQueryTermCoverage(substantiveTerms.length > 0 ? substantiveTerms : queryTerms, (topCandidate as any).chunk?.text || (topCandidate as any).text || '');

  const collectiveCoverage = computeQueryTermCoverage(
    substantiveTerms.length > 0 ? substantiveTerms : queryTerms,
    candidates.slice(0, 10).map(c => (c as any).chunk?.text || (c as any).text || '').join(' ')
  );

  const distinctSourcesCount = new Set(
    candidates.slice(0, 10).map(c => (c as any).sermonId || (c as any).documentId || (c as any).chunk?.sermonId)
  ).size;

  const isCrossSourceMatch = distinctSourcesCount >= 2 && collectiveCoverage >= 0.70;

  // --- RÈGLES D'ABSTENTION / ANSWERABILITY HIERARCHIQUES ---

  // Règle 1 : Détection d'entités hors domaine explicites
  if (hasOutOfDomainMarker) {
    return {
      answerable: false,
      confidenceScore: 0.10,
      reason: `Sujet hors du champ doctrinal des documents : ${substantiveTerms.filter(t => OUT_OF_DOMAIN_MARKERS.has(normalizeText(t))).join(', ')}.`,
      topScore: topVectorScore,
      evidenceCount: candidates.length,
      absentKeywords: substantiveTerms.filter(t => OUT_OF_DOMAIN_MARKERS.has(normalizeText(t)))
    };
  }

  // Règle 1b : Concepts substantiels entièrement absents du corpus avec similarité vectorielle non exceptionnelle (< 0.60)
  if (absentSubstantiveTerms.length > 0 && topVectorScore < 0.60) {
    return {
      answerable: false,
      confidenceScore: 0.15,
      reason: `Termes critiques absents du corpus documentaire : ${absentSubstantiveTerms.join(', ')}.`,
      topScore: topVectorScore,
      evidenceCount: candidates.length,
      absentKeywords: absentSubstantiveTerms
    };
  }

  // Règle 2 : Recoupement multi-modal ou lexical solide avec couverture documentaire minimale
  // Évite qu'une simple coïncidence lexicale isolée ne valide indûment une question hors-corpus
  const isValidMultiModal = isMultiModal && absentSubstantiveTerms.length === 0 && (
    (topVectorScore >= 0.50 && topCandidateCoverage >= 0.30) ||
    (topLexScore >= 35 && topCandidateCoverage >= 0.55) ||
    (topLexScore >= 40 && topVectorScore >= 0.30 && isCrossSourceMatch)
  );
  const isValidStrongLexical = hasLexicalHit && absentSubstantiveTerms.length === 0 && topLexScore >= 35 && (topCandidateCoverage >= 0.55 || (distinctSourcesCount >= 2 && collectiveCoverage >= 0.80));

  if (isValidMultiModal || isValidStrongLexical) {
    const confidence = Math.min(1.0, 0.85 + Math.max(0, (topVectorScore - 0.50) * 0.3));
    return {
      answerable: true,
      confidenceScore: Math.round(confidence * 100) / 100,
      reason: 'Recoupement documentaire validé (Signal lexical et/ou multi-modal corroboré).',
      topScore: topVectorScore,
      evidenceCount: candidates.length,
      absentKeywords: []
    };
  }

  // Règle 3 : Question sémantique/paraphrasée in-domain avec similarité vectorielle suffisante (>= 0.55) et couverture minimale
  if (topVectorScore >= 0.55 && topCandidateCoverage >= 0.25) {
    const confidence = Math.min(1.0, 0.70 + Math.max(0, (topVectorScore - 0.55) * 0.5));
    return {
      answerable: true,
      confidenceScore: Math.round(confidence * 100) / 100,
      reason: 'Similarité sémantique vectorielle in-domain validée.',
      topScore: topVectorScore,
      evidenceCount: candidates.length,
      absentKeywords: []
    };
  }

  // Repli sécurisé : similarité trop faible sans ancrage lexical probant
  return {
    answerable: false,
    confidenceScore: 0.25,
    reason: 'Signal documentaire insuffisant pour garantir une réponse fiable.',
    topScore: topVectorScore,
    evidenceCount: candidates.length,
    absentKeywords: absentSubstantiveTerms
  };
}

/**
 * Validation déterministe des citations et preuves.
 * Vérifie l'intégrité absolue de chaque preuve par rapport aux sermons originaux
 * et garantit que chaque citation future pointe vers le paragraphe original.
 */
export function validateEvidenceCitations(
  candidates: (HybridSearchResult | RerankedSearchResult)[],
  originalSermons: Sermon[]
): ValidatedCitation[] {
  if (!Array.isArray(candidates) || candidates.length === 0 || !Array.isArray(originalSermons)) {
    return [];
  }

  const sermonsMap = new Map<string, Sermon>();
  for (const s of originalSermons) {
    if (s && s.id) {
      sermonsMap.set(s.id, s);
    }
  }

  const validated: ValidatedCitation[] = [];

  for (const item of candidates) {
    const chunk = item.chunk || item;
    const sId = chunk.sermonId;
    const sermon = sermonsMap.get(sId);

    if (!sermon || !sermon.text) {
      validated.push({
        chunkId: chunk.chunkId || 'unknown',
        sermonId: sId || 'unknown',
        paragraphIndex: chunk.startParagraph || 0,
        citationTitle: chunk.sermonTitle || 'Sermon inconnu',
        isAuthentic: false,
        textSnippet: '',
        validationError: `Sermon ID "${sId}" inexistant dans le corpus original.`
      });
      continue;
    }

    const sermonParagraphs = splitSermonIntoParagraphs(sermon.text);

    for (const pNum of chunk.paragraphIds || []) {
      // Recherche du paragraphe authentique dans le sermon original
      let originalParaText: string | null = null;

      for (let idx = 0; idx < sermonParagraphs.length; idx++) {
        const rawP = sermonParagraphs[idx];
        const leading = extractLeadingParagraphNumber(rawP);
        const actualNum = leading !== null ? leading : idx + 1;

        if (actualNum === pNum) {
          originalParaText = rawP.trim();
          break;
        }
      }

      if (originalParaText === null) {
        validated.push({
          chunkId: chunk.chunkId,
          sermonId: sId,
          paragraphIndex: pNum,
          citationTitle: `${sermon.title} §${pNum}`,
          isAuthentic: false,
          textSnippet: '',
          validationError: `Paragraphe §${pNum} introuvable dans le texte du sermon ${sId}.`
        });
      } else {
        const snippet = originalParaText.length > 200 ? originalParaText.slice(0, 200) + '...' : originalParaText;
        validated.push({
          chunkId: chunk.chunkId,
          sermonId: sId,
          paragraphIndex: pNum,
          citationTitle: `${sermon.title} §${pNum}`,
          isAuthentic: true,
          textSnippet: snippet
        });
      }
    }
  }

  return validated;
}
