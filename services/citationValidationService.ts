/**
 * King's Sword — Validateur Déterministe de Citations (Phase 2F.4)
 * 
 * Analyse et authentifie déterministement les citations insérées par le générateur
 * (Gemini) dans sa réponse textuelle en les confrontant exclusivement au package
 * d'Evidence documentaire réellement transmis dans le contexte.
 * 
 * RÈGLES DE VALIDATION STRICTES :
 * 1. Format attendu : [Réf: SERMON_ID, §N] ou [Réf: SERMON_ID, Para. N]
 * 2. Invalide si l'identifiant est un CHUNK_ID (ex: 63-0324M_c1_p1_p2).
 * 3. Invalide si le sermonId n'est pas présent dans le RetrievalEvidencePackage fourni.
 * 4. Invalide si le paragraphe §N n'est pas présent dans citationParagraphs de l'Evidence.
 * 5. Invalide si answerable === false (abstention / hors corpus : zéro citation autorisée).
 * 6. Si aucune citation n'est présente dans le texte, validCitationCount = 0, invalidCitationCount = 0, allCitationsValid = true.
 * 7. Le texte original est préservé sans modification silencieuse.
 */

import {
  RetrievalEvidencePackage,
  RetrievalEvidence,
  ValidatedCitationDetail,
  CitationValidationResult
} from '../types';

/**
 * Expression régulière universelle pour capturer toutes les balises de référence [Réf: ...]
 * Supporte :
 * - Sermons & Exposé : [Réf: 63-0324M, §2], [Réf: expose-ch-8, §15]
 * - Bible : [Réf: Jean 3:16], [Réf: bible-jhn-3, §16]
 * - Chants : [Réf: Song-12, §1], [Réf: Song-12, §3]
 */
const CITATION_REGEX = /\[Réf:\s*([^,\]:]+?)(?:(?::|,?\s*(?:Para\.?|§|v\.?|verset|p\.?))\s*(\d+))?\]/gi;

/**
 * Valide les citations d'un texte généré par rapport aux preuves documentaires fournies.
 */
export function validateResponseCitations(params: {
  responseText: string;
  evidencePackage?: RetrievalEvidencePackage;
}): CitationValidationResult {
  const { responseText = '', evidencePackage } = params;

  if (!responseText || typeof responseText !== 'string') {
    return {
      text: '',
      citations: [],
      validCitationCount: 0,
      invalidCitationCount: 0,
      allCitationsValid: true
    };
  }

  // 1. Extraction de toutes les occurrences de citations dans le texte
  const matches = [...responseText.matchAll(CITATION_REGEX)];

  if (matches.length === 0) {
    return {
      text: responseText,
      citations: [],
      validCitationCount: 0,
      invalidCitationCount: 0,
      allCitationsValid: true
    };
  }

  // Indexation rapide des Evidence par sermonId, sermonTitle et alias
  const evidenceBySermonMap = new Map<string, RetrievalEvidence[]>();
  if (evidencePackage && evidencePackage.answerable && Array.isArray(evidencePackage.evidence)) {
    for (const ev of evidencePackage.evidence) {
      if (ev) {
        const keys = [
          ev.sermonId?.trim().toLowerCase(),
          ev.sermonTitle?.trim().toLowerCase(),
          (ev as any).documentId?.trim().toLowerCase()
        ].filter(Boolean) as string[];

        for (const k of keys) {
          const existing = evidenceBySermonMap.get(k) || [];
          if (!existing.includes(ev)) existing.push(ev);
          evidenceBySermonMap.set(k, existing);
        }
      }
    }
  }

  const citations: ValidatedCitationDetail[] = [];
  let validCitationCount = 0;
  let invalidCitationCount = 0;

  for (const match of matches) {
    const rawMatch = match[0];
    const rawSermonId = match[1] ? match[1].trim() : null;
    const rawParaIndex = match[2] ? parseInt(match[2], 10) : null;

    // Étape 1 : Vérification d'utilisation d'un identifiant technique (CHUNK_ID)
    if (rawSermonId && (rawSermonId.includes('_c') || rawSermonId.toLowerCase().includes('chunk'))) {
      invalidCitationCount++;
      citations.push({
        rawMatch,
        sermonId: rawSermonId,
        paragraphIndex: rawParaIndex,
        isValid: false,
        reason: `Identifiant technique de découpage (CHUNK_ID) "${rawSermonId}" utilisé à la place d'un ID de sermon.`
      });
      continue;
    }

    // Étape 2 : Vérification de la présence d'Evidence (answerable === false ou pas de package)
    if (!evidencePackage || !evidencePackage.answerable || !Array.isArray(evidencePackage.evidence) || evidencePackage.evidence.length === 0) {
      invalidCitationCount++;
      citations.push({
        rawMatch,
        sermonId: rawSermonId,
        paragraphIndex: rawParaIndex,
        isValid: false,
        reason: 'Aucune preuve documentaire n\'a été fournie dans le contexte pour cette question (abstention / hors corpus).'
      });
      continue;
    }

    if (!rawSermonId) {
      invalidCitationCount++;
      citations.push({
        rawMatch,
        sermonId: null,
        paragraphIndex: rawParaIndex,
        isValid: false,
        reason: 'Identifiant de sermon manquant dans la citation.'
      });
      continue;
    }

    // Étape 3 : Vérification de l'existence du sermon dans le package d'Evidence transmis
    const normSermonId = rawSermonId.toLowerCase();
    let matchingEvidences = evidenceBySermonMap.get(normSermonId);

    // Support des alias de titres (ex: "Song-12" pour "song-12", "Jean 3" pour "bible-jhn-3")
    if (!matchingEvidences || matchingEvidences.length === 0) {
      for (const [key, evList] of evidenceBySermonMap.entries()) {
        if (key.includes(normSermonId) || normSermonId.includes(key)) {
          matchingEvidences = evList;
          break;
        }
      }
    }

    if (!matchingEvidences || matchingEvidences.length === 0) {
      invalidCitationCount++;
      citations.push({
        rawMatch,
        sermonId: rawSermonId,
        paragraphIndex: rawParaIndex,
        isValid: false,
        reason: `Le sermon ID "${rawSermonId}" n'était pas présent dans les preuves documentaires transmises dans le contexte.`
      });
      continue;
    }

    // Étape 4 : Vérification du paragraphe dans les citationParagraphs authentifiés
    let matchedParagraphSnippet: string | null = null;
    let matchedFullParagraphText: string | null = null;
    let matchedEvidenceObj: RetrievalEvidence | null = null;

    for (const ev of matchingEvidences) {
      if (rawParaIndex !== null) {
        const foundPara = ev.citationParagraphs.find(cp => cp.paragraphIndex === rawParaIndex && cp.isAuthentic);
        if (foundPara) {
          matchedParagraphSnippet = foundPara.textSnippet;
          matchedFullParagraphText = foundPara.fullParagraphText || foundPara.textSnippet;
          matchedEvidenceObj = ev;
          break;
        }
      } else {
        // Citation sans numéro de paragraphe mais sermon authentifié dans l'Evidence
        matchedEvidenceObj = ev;
        matchedFullParagraphText = ev.text;
        break;
      }
    }

    if (rawParaIndex !== null && matchedParagraphSnippet === null) {
      invalidCitationCount++;
      citations.push({
        rawMatch,
        sermonId: rawSermonId,
        paragraphIndex: rawParaIndex,
        isValid: false,
        reason: `Le paragraphe §${rawParaIndex} n'est pas présent dans les preuves fournies pour le document ${rawSermonId}.`
      });
      continue;
    }

    // Étape 5 : Validation du texte cité entre guillemets contre le paragraphe entier
    const matchIndex = match.index ?? responseText.indexOf(rawMatch);
    const textBefore = responseText.slice(Math.max(0, matchIndex - 400), matchIndex).trim();
    
    // Extraction de la citation textuelle précédant la référence (supporte fragments contigus ou uniques)
    let extractedQuote: string | null = null;
    const multiGuillemetsMatch = textBefore.match(/(«[^»]+»(?:\s*(?:puis|et|\.{3}|…|,)?\s*«[^»]+»)+)\s*$/);
    if (multiGuillemetsMatch) {
      const subQuotes = [...multiGuillemetsMatch[1].matchAll(/«\s*([^»]+?)\s*»/g)].map(m => m[1].trim());
      extractedQuote = subQuotes.join(' ... ');
    } else {
      const guillemetsMatch = textBefore.match(/«\s*([^»]+?)\s*»\s*$/);
      if (guillemetsMatch) {
        extractedQuote = guillemetsMatch[1].trim();
      } else {
        const quotesMatch = textBefore.match(/"\s*([^"]+?)\s*"\s*$/);
        if (quotesMatch) {
          extractedQuote = quotesMatch[1].trim();
        }
      }
    }

    let isQuoteAuthentic = true;
    if (extractedQuote && matchedFullParagraphText) {
      const cleanQuote = extractedQuote
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      const cleanFullPara = matchedFullParagraphText
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (cleanQuote.length > 8 && !cleanFullPara.includes(cleanQuote)) {
        // Test sur sous-segments si coupure avec ellipses ou fragments fusionnés
        const subParts = cleanQuote.split(/\s*(?:\.{3}|…)\s*/).filter(p => p.length > 6);
        const matchesSubParts = subParts.length > 0 && subParts.every(p => cleanFullPara.includes(p));
        if (!matchesSubParts) {
          isQuoteAuthentic = false;
        }
      }
    }

    if (!isQuoteAuthentic) {
      invalidCitationCount++;
      citations.push({
        rawMatch,
        sermonId: rawSermonId,
        paragraphIndex: rawParaIndex,
        isValid: false,
        quotedText: extractedQuote || undefined,
        isQuoteAuthentic: false,
        reason: `Le texte cité entre guillemets ne correspond pas au contenu du paragraphe intégral §${rawParaIndex}.`
      });
      continue;
    }

    // Citation 100% authentifiée
    validCitationCount++;
    citations.push({
      rawMatch,
      sermonId: rawSermonId,
      paragraphIndex: rawParaIndex,
      isValid: true,
      quotedText: extractedQuote || undefined,
      isQuoteAuthentic: true,
      reason: 'Citation authentifiée avec succès contre le paragraphe intégral du document.',
      matchedEvidence: matchedEvidenceObj ? {
        sermonId: matchedEvidenceObj.sermonId,
        sermonTitle: matchedEvidenceObj.sermonTitle,
        paragraphIndex: rawParaIndex || matchedEvidenceObj.startParagraph,
        snippet: matchedParagraphSnippet || matchedEvidenceObj.text.slice(0, 150)
      } : undefined
    });
  }

  return {
    text: responseText,
    citations,
    validCitationCount,
    invalidCitationCount,
    allCitationsValid: invalidCitationCount === 0
  };
}
