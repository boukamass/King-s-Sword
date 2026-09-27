import { Note, Citation, NoteSeparator } from '../types';

export interface FormattedSource {
  index: number;
  id: string;
  type: 'scripture' | 'sermon' | 'general';
  title: string;
  dateOrVersion?: string;
  paragraphOrVerse?: string;
  formattedLine: string;
  citationIds?: string[];
}

export type NoteSectionItem = 
  | {
      kind: 'citation';
      id: string;
      citationId: string;
      quote: string;
      reference?: string;
      sourceTitle?: string;
      sourceMeta?: string;
      sourceIndex?: number;
      orderIndex: number;
    }
  | {
      kind: 'separator';
      id: string;
      separatorType: 'subtitle' | 'comment';
      text: string;
      category: 'scripture' | 'church_age' | 'teaching';
      orderIndex: number;
    };

export interface FormattedNoteSection {
  title?: string;
  type: 'main_content' | 'scripture_quote' | 'teaching_quote' | 'sources';
  text: string;
  sourceRef?: string;
  sourceIndex?: number;
}

export interface ProcessedNoteData {
  title: string;
  cleanContent: string;
  contentParagraphs: string[];
  scriptureItems: NoteSectionItem[];
  churchAgeItems: NoteSectionItem[];
  teachingItems: NoteSectionItem[];
  scriptureCitations: {
    citationId: string;
    quote: string;
    reference: string;
    sourceIndex?: number;
  }[];
  churchAgeCitations: {
    citationId: string;
    quote: string;
    sourceTitle: string;
    sourceMeta: string;
    sourceIndex?: number;
  }[];
  teachingCitations: {
    citationId: string;
    quote: string;
    sourceTitle: string;
    sourceMeta: string;
    sourceIndex?: number;
  }[];
  sources: FormattedSource[];
  formattedMarkdown: string;
}

/**
 * Liste des livres bibliques pour détection fiable des références bibliques
 */
const BIBLE_BOOKS = [
  'Genèse', 'Exode', 'Lévitique', 'Nombres', 'Deutéronome', 'Josué', 'Juges', 'Ruth',
  '1 Samuel', '2 Samuel', '1 Rois', '2 Rois', '1 Chroniques', '2 Chroniques',
  'Esdras', 'Néhémie', 'Esther', 'Job', 'Psaumes', 'Psaume', 'Proverbes', 'Ecclésiaste',
  'Cantique des Cantiques', 'Ésaïe', 'Esaïe', 'Jérémie', 'Lamentations', 'Ézéchiel', 'Ezechiel',
  'Daniel', 'Osée', 'Osee', 'Joël', 'Joel', 'Amos', 'Abdias', 'Jonas', 'Michée', 'Michee',
  'Nahum', 'Habacuc', 'Sophonie', 'Aggée', 'Aggee', 'Zacharie', 'Malachie',
  'Matthieu', 'Marc', 'Luc', 'Jean', 'Actes', 'Romains', '1 Corinthiens', '2 Corinthiens',
  'Galates', 'Éphésiens', 'Ephesians', 'Éphésiens', 'Philippiens', 'Colossiens',
  '1 Thessaloniens', '2 Thessaloniens', '1 Timothée', '2 Timothée', 'Tite', 'Philémon',
  'Hébreux', 'Hebreux', 'Jacques', '1 Pierre', '2 Pierre', '1 Jean', '2 Jean', '3 Jean',
  'Jude', 'Apocalypse'
];

/**
 * Nettoie une chaîne de texte de tous les artefacts de génération, balises techniques et fautes de frappe récurrentes.
 */
export function cleanTextArtifacts(rawText: string): string {
  if (!rawText) return '';

  let text = rawText;

  // 1. Remplacement des marqueurs d'assistant
  text = text.replace(/\[\[\[NOTE_EXTERNE\]\]\]/g, "Note de l'Assistant : ");

  // 2. Nettoyage des balises [Réf: ...] et [Source: ...] incorporées sauvagement
  text = text.replace(/\[Réf:\s*([^\]]+)\]/gi, '');
  text = text.replace(/\[Source:\s*([^\]]+)\]/gi, '');

  // 3. Suppression des "Para." ou "Para" résiduels orphelins (sans numéro)
  text = text.replace(/\bPara\.\s*(?=[^\d]|$)/gi, '');
  text = text.replace(/\bPara\b(?=[^\d]|$)/gi, '');

  // 4. Correction des fautes de caractères corrompus / symboles parasites
  text = text.replace(/Hiddékel\s*\/\s*;/gi, 'Hiddékel');
  text = text.replace(/[\t]/g, ' ');

  // 5. Normalisation des espaces avant la ponctuation
  text = text.replace(/\s+([.,;:!%?])/g, '$1');

  // 6. Remplacement des multiples espaces consécutifs
  text = text.replace(/ {2,}/g, ' ');

  // 7. Nettoyage des guillemets vides ou collés
  text = text.replace(/«\s+/g, '« ');
  text = text.replace(/\s+»/g, ' »');

  return text.trim();
}

/**
 * Détermine si un titre de source provient directement de la Bible.
 * Les citations d'exposés, prédications et enseignements sont exclues pour aller dans "CITATIONS & ENSEIGNEMENTS".
 */
export function isBibleReference(text: string): boolean {
  if (!text) return false;
  const t = text.trim();

  // Exclure explicitement les exposés, prédications, brochures, messages et dates de prédication
  if (/Exposé|Expose|Sermon|Prédication|Predication|Brochure|Sept Âges|7 Âges|Âges|Ages|Message|Chronique|\b\d{2}-\d{4}\b|\b\d{2}-\d{2}\b/i.test(t)) {
    return false;
  }

  // Vérifier la présence explicite d'indicateurs bibliques
  if (/LSG|Louis Segond|Bible|Segond/i.test(t)) return true;

  // Vérifier si le titre commence par ou contient exactement un nom de livre biblique
  return BIBLE_BOOKS.some(book => {
    const pattern = new RegExp(`^(${book}|\\d\\s*${book})\\b`, 'i');
    return pattern.test(t);
  });
}

/**
 * Formate proprement une référence de paragraphe :
 * Si le numéro de paragraphe est valide, retourne "§N" (ou "paragraphe N").
 * Sinon, ne produit AUCUN artéfact "Para." vide.
 */
export function formatParagraphRef(paragraphIndex?: number | string): string {
  if (paragraphIndex === undefined || paragraphIndex === null || paragraphIndex === '') {
    return '';
  }
  const str = String(paragraphIndex).trim();
  if (!str || str.toLowerCase() === 'null' || str.toLowerCase() === 'undefined') {
    return '';
  }
  // extraire seulement les chiffres si possible
  const digits = str.match(/\d+/);
  if (digits) {
    return `§${digits[0]}`;
  }
  return '';
}

/**
 * Transforme une Note complète en structure nettoyée et professionnelle.
 */
export function processNoteData(note: Note): ProcessedNoteData {
  const cleanTitle = cleanTextArtifacts(note.title || 'Nouvelle Note');
  const rawContent = cleanTextArtifacts(note.content || '');

  const sourcesMap = new Map<string, FormattedSource>();
  const sourcesList: FormattedSource[] = [];

  let sourceCounter = 1;

  const getOrAddSource = (
    title: string,
    type: 'scripture' | 'sermon' | 'general',
    dateOrVersion?: string,
    paragraphOrVerse?: string,
    citationId?: string
  ): number => {
    const key = `${type}_${title}_${dateOrVersion || ''}_${paragraphOrVerse || ''}`.toLowerCase();
    if (sourcesMap.has(key)) {
      const existing = sourcesMap.get(key)!;
      if (citationId && (!existing.citationIds || !existing.citationIds.includes(citationId))) {
        existing.citationIds = [...(existing.citationIds || []), citationId];
      }
      return existing.index;
    }

    const cleanT = cleanTextArtifacts(title);
    const cleanD = cleanTextArtifacts(dateOrVersion || '');
    const cleanP = cleanTextArtifacts(paragraphOrVerse || '');

    let formattedLine = '';
    if (type === 'scripture') {
      const version = cleanD || 'LSG 1910';
      formattedLine = `Bible — ${version} — ${cleanT}${cleanP ? `:${cleanP}` : ''}.`;
    } else if (type === 'sermon') {
      const parts = [cleanT];
      if (cleanD) parts.push(cleanD);
      if (cleanP) parts.push(cleanP.startsWith('§') ? cleanP : `§${cleanP}`);
      formattedLine = `${parts.join(' — ')}.`;
    } else {
      formattedLine = `${cleanT}${cleanD ? ` — ${cleanD}` : ''}.`;
    }

    formattedLine = formattedLine.replace(/\*/g, '');

    const sourceObj: FormattedSource = {
      index: sourceCounter,
      id: key,
      type,
      title: cleanT,
      dateOrVersion: cleanD,
      paragraphOrVerse: cleanP,
      formattedLine,
      citationIds: citationId ? [citationId] : []
    };

    sourcesMap.set(key, sourceObj);
    sourcesList.push(sourceObj);
    sourceCounter++;
    return sourceObj.index;
  };

  // Traitement des citations rattachées (Citations)
  const scriptureCitations: ProcessedNoteData['scriptureCitations'] = [];
  const churchAgeCitations: ProcessedNoteData['churchAgeCitations'] = [];
  const teachingCitations: ProcessedNoteData['teachingCitations'] = [];

  if (note.citations && note.citations.length > 0) {
    const seenCitations = new Set<string>();

    for (const citation of note.citations) {
      const cleanQuote = cleanTextArtifacts(citation.quoted_text || '');
      if (!cleanQuote) continue;

      const titleSnap = cleanTextArtifacts(citation.sermon_title_snapshot || '');
      const dateSnap = cleanTextArtifacts(citation.sermon_date_snapshot || '');
      const versionSnap = cleanTextArtifacts(citation.sermon_version_snapshot || '');
      const paraRef = formatParagraphRef(citation.paragraph_index);

      // Clé d'unicité pour filtrer les doublons historiques
      const dedupKey = `${citation.sermon_id || ''}_${citation.paragraph_index ?? ''}_${cleanQuote.toLowerCase()}`;
      if (seenCitations.has(dedupKey)) continue;
      seenCitations.add(dedupKey);

      // Classification stricte : Si le titre de la source est une référence biblique ou si la version est une version biblique (LSG)
      const isScriptureSource = isBibleReference(titleSnap) || (!!versionSnap && /LSG|Louis Segond/i.test(versionSnap) && !isBibleReference(titleSnap));
      const isChurchAgeSource = /Exposé|Expose|Sept Âges|7 Âges|Church Ages|Âges de l'Église/i.test(titleSnap);

      if (isScriptureSource && !/Exposé|Expose|Sermon|Prédication|Brochure|Message/i.test(titleSnap)) {
        const version = versionSnap || 'LSG 1910';
        const srcIdx = getOrAddSource(titleSnap || 'Bible', 'scripture', version, paraRef, citation.id);
        scriptureCitations.push({
          citationId: citation.id,
          quote: cleanQuote,
          reference: `${titleSnap || 'Bible'}${version ? ` — ${version}` : ''}`,
          sourceIndex: srcIdx
        });
      } else if (isChurchAgeSource) {
        const metaParts = [];
        if (dateSnap) metaParts.push(dateSnap);
        if (paraRef) metaParts.push(paraRef);

        const srcIdx = getOrAddSource(titleSnap || "Exposé des Sept Âges", 'sermon', dateSnap, paraRef, citation.id);
        churchAgeCitations.push({
          citationId: citation.id,
          quote: cleanQuote,
          sourceTitle: titleSnap || "Exposé des Sept Âges",
          sourceMeta: metaParts.join(' — '),
          sourceIndex: srcIdx
        });
      } else {
        const metaParts = [];
        if (dateSnap) metaParts.push(dateSnap);
        if (paraRef) metaParts.push(paraRef);

        const srcIdx = getOrAddSource(titleSnap || 'Exposé / Enseignement', 'sermon', dateSnap, paraRef, citation.id);
        teachingCitations.push({
          citationId: citation.id,
          quote: cleanQuote,
          sourceTitle: titleSnap || 'Exposé / Enseignement',
          sourceMeta: metaParts.join(' — '),
          sourceIndex: srcIdx
        });
      }
    }
  }

  // Construction des listes unifiées d'éléments (Citations + Séparateurs indépendants)
  const noteSeparators: NoteSeparator[] = Array.isArray(note.separators) ? note.separators : [];

  const buildSectionItems = (
    category: 'scripture' | 'church_age' | 'teaching',
    citations: Array<{ citationId: string; quote: string; reference?: string; sourceTitle?: string; sourceMeta?: string; sourceIndex?: number }>
  ): NoteSectionItem[] => {
    const items: NoteSectionItem[] = [];

    // 1. Ajouter les citations avec des orderIndex entiers espacés (0, 10, 20...) pour permettre des insertions stables
    citations.forEach((c, idx) => {
      items.push({
        kind: 'citation',
        id: c.citationId,
        citationId: c.citationId,
        quote: c.quote,
        reference: c.reference,
        sourceTitle: c.sourceTitle,
        sourceMeta: c.sourceMeta,
        sourceIndex: c.sourceIndex,
        orderIndex: idx * 10
      });
    });

    // 2. Ajouter les séparateurs indépendants de cette catégorie
    const catSeparators = noteSeparators.filter(s => s.category === category);
    catSeparators.forEach(sep => {
      items.push({
        kind: 'separator',
        id: sep.id,
        separatorType: sep.type,
        text: cleanTextArtifacts(sep.text),
        category: sep.category,
        orderIndex: sep.orderIndex
      });
    });

    // 3. Trier par orderIndex
    items.sort((a, b) => a.orderIndex - b.orderIndex);
    return items;
  };

  const scriptureItems = buildSectionItems('scripture', scriptureCitations);
  const churchAgeItems = buildSectionItems('church_age', churchAgeCitations);
  const teachingItems = buildSectionItems('teaching', teachingCitations);

  // Traitement des paragraphes du contenu principal
  const rawParagraphs = rawContent
    .split(/\n+/)
    .map(p => cleanTextArtifacts(p))
    .filter(p => p.length > 0);

  const contentParagraphs: string[] = [];

  // Détecter si des citations ou sources bibliques sont incrustées dans le texte
  for (const paragraph of rawParagraphs) {
    let pText = paragraph;

    // Remplacer les chaînes de type: — Genèse 2 (LSG 1910) — Para. 5
    pText = pText.replace(/—\s*([A-Za-zÀ-ÿ0-9\s]+?)\s*\((LSG\s*1910|Louis Segond)\)\s*—\s*Para\.?\s*\d*/gi, (match, book) => {
      const idx = getOrAddSource(book.trim(), 'scripture', 'LSG 1910');
      return `(${book.trim()}, LSG 1910) [${idx}]`;
    });

    contentParagraphs.push(pText);
  }

  // Si un ordre personnalisé de sources (sourceOrder) est défini, réordonner la liste des sources
  if (note.sourceOrder && note.sourceOrder.length > 0 && sourcesList.length > 1) {
    const orderMap = new Map<string, number>();
    note.sourceOrder.forEach((id, idx) => orderMap.set(id.toLowerCase(), idx));

    sourcesList.sort((a, b) => {
      const posA = orderMap.has(a.id.toLowerCase()) ? orderMap.get(a.id.toLowerCase())! : 9999;
      const posB = orderMap.has(b.id.toLowerCase()) ? orderMap.get(b.id.toLowerCase())! : 9999;
      return posA - posB;
    });

    // Réassigner les index finaux 1..N
    const indexMapping = new Map<number, number>();
    sourcesList.forEach((src, idx) => {
      const newIndex = idx + 1;
      indexMapping.set(src.index, newIndex);
      src.index = newIndex;
    });

    // Mettre à jour les références d'index dans les citations et items
    for (const item of scriptureItems) {
      if (item.kind === 'citation' && item.sourceIndex && indexMapping.has(item.sourceIndex)) {
        item.sourceIndex = indexMapping.get(item.sourceIndex);
      }
    }
    for (const item of churchAgeItems) {
      if (item.kind === 'citation' && item.sourceIndex && indexMapping.has(item.sourceIndex)) {
        item.sourceIndex = indexMapping.get(item.sourceIndex);
      }
    }
    for (const item of teachingItems) {
      if (item.kind === 'citation' && item.sourceIndex && indexMapping.has(item.sourceIndex)) {
        item.sourceIndex = indexMapping.get(item.sourceIndex);
      }
    }
    for (const sc of scriptureCitations) {
      if (sc.sourceIndex && indexMapping.has(sc.sourceIndex)) {
        sc.sourceIndex = indexMapping.get(sc.sourceIndex);
      }
    }
    for (const cac of churchAgeCitations) {
      if (cac.sourceIndex && indexMapping.has(cac.sourceIndex)) {
        cac.sourceIndex = indexMapping.get(cac.sourceIndex);
      }
    }
    for (const tc of teachingCitations) {
      if (tc.sourceIndex && indexMapping.has(tc.sourceIndex)) {
        tc.sourceIndex = indexMapping.get(tc.sourceIndex);
      }
    }
  }

  // Construction du Markdown récapitulatif
  let markdown = `# ${cleanTitle}\n\n`;

  if (contentParagraphs.length > 0) {
    markdown += `## Contenu\n\n`;
    markdown += contentParagraphs.join('\n\n') + '\n\n';
  }

  if (scriptureItems.length > 0) {
    markdown += `### Citations bibliques\n\n`;
    for (const item of scriptureItems) {
      if (item.kind === 'separator') {
        if (item.separatorType === 'subtitle') {
          markdown += `#### ${item.text}\n\n`;
        } else {
          markdown += `> 💬 *${item.text}*\n\n`;
        }
      } else {
        markdown += `> « ${item.quote} »\n\n`;
        markdown += `**${item.reference}**${item.sourceIndex ? ` **[${item.sourceIndex}]**` : ''}\n\n`;
      }
    }
  }

  if (churchAgeItems.length > 0) {
    markdown += `### Citations de l'Exposé des Sept Âges\n\n`;
    for (const item of churchAgeItems) {
      if (item.kind === 'separator') {
        if (item.separatorType === 'subtitle') {
          markdown += `#### ${item.text}\n\n`;
        } else {
          markdown += `> 💬 *${item.text}*\n\n`;
        }
      } else {
        markdown += `> « ${item.quote} »\n\n`;
        markdown += `*${item.sourceTitle}*${item.sourceMeta ? ` — ${item.sourceMeta}` : ''}${item.sourceIndex ? ` **[${item.sourceIndex}]**` : ''}\n\n`;
      }
    }
  }

  if (teachingItems.length > 0) {
    markdown += `### Citations d'Enseignements\n\n`;
    for (const item of teachingItems) {
      if (item.kind === 'separator') {
        if (item.separatorType === 'subtitle') {
          markdown += `#### ${item.text}\n\n`;
        } else {
          markdown += `> 💬 *${item.text}*\n\n`;
        }
      } else {
        markdown += `> « ${item.quote} »\n\n`;
        markdown += `*${item.sourceTitle}*${item.sourceMeta ? ` — ${item.sourceMeta}` : ''}${item.sourceIndex ? ` **[${item.sourceIndex}]**` : ''}\n\n`;
      }
    }
  }

  if (sourcesList.length > 0) {
    markdown += `## Sources\n\n`;
    for (const src of sourcesList) {
      markdown += `**[${src.index}]** ${src.formattedLine}\n\n`;
    }
  }

  return {
    title: cleanTitle,
    cleanContent: contentParagraphs.join('\n\n'),
    contentParagraphs,
    scriptureItems,
    churchAgeItems,
    teachingItems,
    scriptureCitations,
    churchAgeCitations,
    teachingCitations,
    sources: sourcesList,
    formattedMarkdown: markdown.trim()
  };
}
