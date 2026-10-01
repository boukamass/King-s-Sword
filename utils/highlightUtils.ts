import { CitationHighlight, Highlight, Sermon } from '../types';

export interface SimpleWordInfo {
  text: string;
  segmentIndex?: number;
  globalIndex: number;
}

export const HIGHLIGHT_HEX_MAP: Record<string, { bgLight: string; bgDark: string; hex: string }> = {
  amber: { bgLight: 'rgba(245, 158, 11, 0.28)', bgDark: 'rgba(245, 158, 11, 0.35)', hex: 'FEF08A' },
  teal: { bgLight: 'rgba(45, 212, 191, 0.28)', bgDark: 'rgba(20, 184, 166, 0.35)', hex: '99F6E4' },
  sky: { bgLight: 'rgba(56, 189, 248, 0.28)', bgDark: 'rgba(14, 165, 233, 0.35)', hex: 'BAE6FD' },
  rose: { bgLight: 'rgba(251, 113, 133, 0.28)', bgDark: 'rgba(244, 63, 94, 0.35)', hex: 'FECDD3' },
  violet: { bgLight: 'rgba(167, 139, 250, 0.28)', bgDark: 'rgba(139, 92, 246, 0.35)', hex: 'E9D5FF' },
  lime: { bgLight: 'rgba(163, 230, 53, 0.28)', bgDark: 'rgba(132, 204, 22, 0.35)', hex: 'D9F99D' },
  orange: { bgLight: 'rgba(251, 146, 60, 0.28)', bgDark: 'rgba(249, 115, 22, 0.35)', hex: 'FED7AA' },
  default: { bgLight: 'rgba(212, 212, 216, 0.35)', bgDark: 'rgba(113, 113, 122, 0.35)', hex: 'E4E4E7' }
};

/**
 * Extrait les surlignages présents dans un paragraphe lors de l'ajout à une note.
 */
export function extractHighlightsFromParagraph(
  seg: { words: SimpleWordInfo[]; text: string },
  highlightMap: Map<number, Highlight>
): CitationHighlight[] {
  if (!seg || !seg.words || seg.words.length === 0) return [];
  const rawText = seg.text;
  const trimmed = rawText.trim();
  if (!trimmed) return [];

  const offsetInRaw = rawText.indexOf(trimmed);
  const rawHighlights: { start: number; end: number; color: string }[] = [];
  let charPos = 0;

  for (const w of seg.words) {
    const h = highlightMap.get(w.globalIndex);
    const wordStart = charPos;
    const wordEnd = charPos + w.text.length;
    charPos = wordEnd;

    if (h) {
      const startInTrimmed = Math.max(0, wordStart - offsetInRaw);
      const endInTrimmed = Math.min(trimmed.length, wordEnd - offsetInRaw);
      if (endInTrimmed > startInTrimmed) {
        rawHighlights.push({
          start: startInTrimmed,
          end: endInTrimmed,
          color: h.color || 'amber'
        });
      }
    }
  }

  return mergeConsecutiveHighlights(rawHighlights, trimmed);
}

/**
 * Extrait les surlignages présents dans une portion de texte sélectionnée.
 */
export function extractHighlightsFromSelection(
  selectedWords: SimpleWordInfo[],
  selectionText: string,
  highlightMap: Map<number, Highlight>
): CitationHighlight[] {
  if (!selectedWords || selectedWords.length === 0 || !selectionText) return [];
  const fullSelected = selectedWords.map(w => w.text).join('');
  const trimmed = selectionText.trim();
  const offsetInRaw = fullSelected.indexOf(trimmed);

  const rawHighlights: { start: number; end: number; color: string }[] = [];
  let charPos = 0;

  for (const w of selectedWords) {
    const h = highlightMap.get(w.globalIndex);
    const wordStart = charPos;
    const wordEnd = charPos + w.text.length;
    charPos = wordEnd;

    if (h) {
      const startInTrimmed = offsetInRaw >= 0 
        ? Math.max(0, wordStart - offsetInRaw) 
        : wordStart;
      const endInTrimmed = offsetInRaw >= 0 
        ? Math.min(trimmed.length, wordEnd - offsetInRaw) 
        : Math.min(trimmed.length, wordEnd);

      if (endInTrimmed > startInTrimmed) {
        rawHighlights.push({
          start: startInTrimmed,
          end: endInTrimmed,
          color: h.color || 'amber'
        });
      }
    }
  }

  return mergeConsecutiveHighlights(rawHighlights, trimmed);
}

/**
 * Extrait et associe les surlignages d'un sermon pour un texte de citation donné.
 */
export function extractHighlightsFromSermon(
  sermon: Partial<Sermon>,
  quotedText: string,
  paragraphIndex?: number
): CitationHighlight[] {
  if (!sermon || !sermon.highlights || sermon.highlights.length === 0 || !quotedText) {
    return [];
  }

  const trimmedQuote = quotedText.trim();
  if (!trimmedQuote || !sermon.text) return [];

  const segments = sermon.text
    .split(/\n\s*\n+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  let globalIdx = 0;
  const structuredSegments: { words: SimpleWordInfo[]; text: string }[] = [];
  segments.forEach((seg, segIdx) => {
    const segWords: SimpleWordInfo[] = [];
    const tokens = seg.split(/(\s+)/);
    tokens.forEach(token => {
      if (token !== '') {
        segWords.push({ text: token, segmentIndex: segIdx, globalIndex: globalIdx++ });
      }
    });
    structuredSegments.push({ words: segWords, text: seg });
  });

  const highlightMap = new Map<number, Highlight>();
  for (const h of sermon.highlights) {
    for (let i = h.start; i <= h.end; i++) {
      highlightMap.set(i, h);
    }
  }

  // 1. Si le paragraphIndex est spécifié
  if (paragraphIndex !== undefined && paragraphIndex !== null && paragraphIndex > 0) {
    const segIdx = paragraphIndex - 1;
    if (structuredSegments[segIdx]) {
      const seg = structuredSegments[segIdx];
      // Si la citation correspond au paragraphe entier
      if (seg.text.trim() === trimmedQuote) {
        return extractHighlightsFromParagraph(seg, highlightMap);
      }
      // Si la citation est un sous-extrait de ce paragraphe
      const idxInSeg = seg.text.indexOf(trimmedQuote);
      if (idxInSeg >= 0) {
        const segHighlights = extractHighlightsFromParagraph(seg, highlightMap);
        const relative: CitationHighlight[] = [];
        for (const sh of segHighlights) {
          const s = Math.max(0, sh.start - idxInSeg);
          const e = Math.min(trimmedQuote.length, sh.end - idxInSeg);
          if (e > s) {
            relative.push({
              start: s,
              end: e,
              color: sh.color,
              text: trimmedQuote.slice(s, e)
            });
          }
        }
        if (relative.length > 0) return relative;
      }
    }
  }

  // 2. Recherche du texte dans l'ensemble des mots du sermon
  const allWords = structuredSegments.flatMap(s => s.words);
  const fullText = allWords.map(w => w.text).join('');
  const quoteIdx = fullText.indexOf(trimmedQuote);
  if (quoteIdx >= 0) {
    const quoteEnd = quoteIdx + trimmedQuote.length;
    const selectedWords: SimpleWordInfo[] = [];
    let cur = 0;
    for (const w of allWords) {
      const wStart = cur;
      const wEnd = cur + w.text.length;
      cur = wEnd;
      if (wEnd > quoteIdx && wStart < quoteEnd) {
        selectedWords.push(w);
      }
    }
    return extractHighlightsFromSelection(selectedWords, trimmedQuote, highlightMap);
  }

  return [];
}

/**
 * Fusionne les surlignages adjacents ou contigus de même couleur.
 */
function mergeConsecutiveHighlights(
  rawHighlights: { start: number; end: number; color: string }[],
  referenceText: string
): CitationHighlight[] {
  if (rawHighlights.length === 0) return [];

  // Trier par position de départ
  const sorted = [...rawHighlights].sort((a, b) => a.start - b.start);
  const merged: CitationHighlight[] = [];
  let current = { ...sorted[0] };

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    if (next.start <= current.end && next.color === current.color) {
      current.end = Math.max(current.end, next.end);
    } else {
      merged.push({
        start: current.start,
        end: current.end,
        color: current.color,
        text: referenceText.slice(current.start, current.end)
      });
      current = { ...next };
    }
  }

  merged.push({
    start: current.start,
    end: current.end,
    color: current.color,
    text: referenceText.slice(current.start, current.end)
  });

  return merged;
}

/**
 * Découpe une citation en segments de texte normaux et segments surlignés
 * pour un rendu propre dans React ou d'autres générateurs.
 */
export function splitQuoteIntoHighlightedSegments(
  quote: string,
  highlights?: CitationHighlight[]
): Array<{ text: string; isHighlighted: boolean; color?: string }> {
  if (!quote) return [];
  if (!highlights || highlights.length === 0) {
    return [{ text: quote, isHighlighted: false }];
  }

  // Filtrer les surlignages valides et dans les bornes
  const valid = highlights
    .filter(h => h.start >= 0 && h.end <= quote.length && h.start < h.end)
    .sort((a, b) => a.start - b.start);

  if (valid.length === 0) {
    return [{ text: quote, isHighlighted: false }];
  }

  const segments: Array<{ text: string; isHighlighted: boolean; color?: string }> = [];
  let cursor = 0;

  for (const h of valid) {
    if (h.start < cursor) continue; // éviter les chevauchements
    if (h.start > cursor) {
      segments.push({
        text: quote.substring(cursor, h.start),
        isHighlighted: false
      });
    }

    segments.push({
      text: quote.substring(h.start, h.end),
      isHighlighted: true,
      color: h.color || 'amber'
    });
    cursor = h.end;
  }

  if (cursor < quote.length) {
    segments.push({
      text: quote.substring(cursor),
      isHighlighted: false
    });
  }

  return segments;
}
