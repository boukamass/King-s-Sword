import { Note, Citation, NoteSeparator, CitationHighlight, Sermon } from '../types';
import { extractHighlightsFromSermon } from './highlightUtils';

export interface FormattedSource {
  index: number;
  id: string;
  type: 'scripture' | 'sermon' | 'general';
  title: string;
  dateOrVersion?: string;
  paragraphOrVerse?: string;
  formattedLine: string;
  citationIds?: string[];
  sermonId?: string;
  paragraphIndex?: number;
  quotedText?: string;
}

export type NoteSectionItem = 
  | {
      kind: 'citation';
      id: string;
      citationId: string;
      sermonId?: string;
      paragraphIndex?: number;
      quote: string;
      reference?: string;
      sourceTitle?: string;
      sourceMeta?: string;
      sourceIndex?: number;
      orderIndex: number;
      highlights?: CitationHighlight[];
    }
  | {
      kind: 'separator';
      id: string;
      separatorType: 'subtitle' | 'comment';
      text: string;
      category: 'scripture' | 'church_age' | 'teaching';
      orderIndex: number;
    };

export interface ProcessedDefinitionItem {
  id: string;
  citationId: string;
  word: string;
  definition: string;
  etymology?: string;
  synonyms?: string[];
  rawText: string;
  sourceIndex?: number;
  orderIndex: number;
}

export interface ProcessedStrongItem {
  id: string;
  citationId: string;
  strongNumber: string;
  word: string;
  original: string;
  pronunciation: string;
  type: 'hebrew' | 'greek';
  partOfSpeech?: string;
  etymology?: string;
  translationsLSG?: string;
  occurrencesCountStr?: string;
  definition: string;
  messageContext?: string;
  originVerseRef?: string;
  originVerseText?: string;
  otherOccurrencesCount?: number;
  allOccurrences?: Array<{ bookName: string; chapter: number; verse: number; text: string }>;
  rawText: string;
  sourceIndex?: number;
  orderIndex: number;
}

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
  definitionItems: ProcessedDefinitionItem[];
  strongItems: ProcessedStrongItem[];
  scriptureCitations: {
    citationId: string;
    sermonId?: string;
    paragraphIndex?: number;
    quote: string;
    reference: string;
    sourceIndex?: number;
    highlights?: CitationHighlight[];
  }[];
  churchAgeCitations: {
    citationId: string;
    sermonId?: string;
    paragraphIndex?: number;
    quote: string;
    sourceTitle: string;
    sourceMeta: string;
    sourceIndex?: number;
    highlights?: CitationHighlight[];
  }[];
  teachingCitations: {
    citationId: string;
    sermonId?: string;
    paragraphIndex?: number;
    quote: string;
    sourceTitle: string;
    sourceMeta: string;
    sourceIndex?: number;
    highlights?: CitationHighlight[];
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
 * Parse et structure proprement un texte de définition de dictionnaire
 * en extrayant le terme, le sens, l'étymologie et les synonymes sans aucun artéfact markdown (*)
 */
export function parseDefinitionText(rawQuote: string, title?: string): {
  word: string;
  definition: string;
  etymology?: string;
  synonyms?: string[];
} {
  const clean = stripMarkdown(rawQuote || '');

  let word = '';
  if (title && /Dictionnaire\s*:\s*(.+)/i.test(title)) {
    word = title.match(/Dictionnaire\s*:\s*(.+)/i)![1].trim();
  }

  let definition = '';
  let etymology: string | undefined = undefined;
  let synonyms: string[] | undefined = undefined;

  const lines = clean.split('\n').map(l => l.trim()).filter(Boolean);

  if (lines.length > 0) {
    const firstLine = lines[0];
    const colonMatch = firstLine.match(/^([A-Za-zÀ-ÿ0-9'\s-]+?)\s*:\s*(.+)$/);
    if (colonMatch && !firstLine.toLowerCase().startsWith('définition') && !firstLine.toLowerCase().startsWith('étymologie') && !firstLine.toLowerCase().startsWith('synonymes')) {
      if (!word) word = colonMatch[1].trim();
      definition = colonMatch[2].trim();
    } else if (!word && !firstLine.includes(':')) {
      word = firstLine.trim();
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0 && (line === word || line.startsWith(word + ' :'))) continue;

    if (/^définition\s*:\s*(.+)/i.test(line)) {
      const defMatch = line.match(/^définition\s*:\s*(.+)/i);
      if (defMatch) definition = (definition ? definition + ' ' : '') + defMatch[1].trim();
    } else if (/^étymologie\s*:\s*(.+)/i.test(line)) {
      const etyMatch = line.match(/^étymologie\s*:\s*(.+)/i);
      if (etyMatch) etymology = etyMatch[1].trim();
    } else if (/^synonymes?\s*:\s*(.+)/i.test(line)) {
      const synMatch = line.match(/^synonymes?\s*:\s*(.+)/i);
      if (synMatch) {
        synonyms = synMatch[1].split(',').map(s => s.trim()).filter(Boolean);
      }
    } else if (!definition) {
      definition = line;
    } else {
      definition += '\n' + line;
    }
  }

  if (!word) {
    word = title ? title.replace(/Dictionnaire\s*:?/i, '').replace(/Définition\s*:?/i, '').trim() : 'Terme';
  }

  return {
    word: stripMarkdown(word ? word.charAt(0).toUpperCase() + word.slice(1) : 'Terme'),
    definition: stripMarkdown(definition || clean),
    etymology: etymology && etymology !== 'Non spécifiée' && !etymology.includes('non répertoriés') ? stripMarkdown(etymology) : undefined,
    synonyms: synonyms && synonyms.length > 0 ? synonyms.map(s => stripMarkdown(s)).filter(Boolean) : undefined
  };
}

/**
 * Analyse et structure le contenu d'une exégèse Strong (supporte le JSON sérialisé et le format Markdown historique).
 */
export function parseStrongText(rawQuote: string, title?: string, dateOrType?: string): {
  strongNumber: string;
  word: string;
  original: string;
  pronunciation: string;
  type: 'hebrew' | 'greek';
  partOfSpeech?: string;
  etymology?: string;
  translationsLSG?: string;
  occurrencesCountStr?: string;
  definition: string;
  messageContext?: string;
  originVerseRef?: string;
  originVerseText?: string;
  otherOccurrencesCount?: number;
  allOccurrences?: Array<{ bookName: string; chapter: number; verse: number; text: string }>;
} {
  // 1. Détection format JSON structuré
  try {
    const data = JSON.parse(rawQuote);
    if (data && (data.strongNumber || data.word)) {
      const occs = Array.isArray(data.allOccurrences) ? data.allOccurrences : [];
      const origRef = data.originVerseRef || (occs.length > 0 ? `${occs[0].bookName} ${occs[0].chapter}:${occs[0].verse}` : undefined);
      const origText = data.originVerseText || (occs.length > 0 ? occs[0].text : undefined);
      const otherCount = data.otherOccurrencesCount !== undefined 
        ? data.otherOccurrencesCount 
        : (occs.length > 1 ? occs.length - 1 : 0);

      return {
        strongNumber: data.strongNumber || (title?.match(/[HG]\d+/i)?.[0]?.toUpperCase() || 'H0000'),
        word: data.word || 'Terme',
        original: data.original || '',
        pronunciation: data.pronunciation || '',
        type: data.type === 'greek' ? 'greek' : 'hebrew',
        partOfSpeech: data.partOfSpeech || undefined,
        etymology: data.etymology || undefined,
        translationsLSG: data.translationsLSG || undefined,
        occurrencesCountStr: data.occurrencesCountStr || undefined,
        definition: data.definition || '',
        messageContext: data.messageContext || undefined,
        originVerseRef: origRef,
        originVerseText: origText,
        otherOccurrencesCount: otherCount,
        allOccurrences: occs
      };
    }
  } catch {
    // Si ce n'est pas du JSON, continuer avec l'analyseur textuel
  }

  // 2. Détection format Markdown ou textuel
  const clean = (rawQuote || '').trim();
  const strongNumMatch = title?.match(/[HG]\d+/i)?.[0]?.toUpperCase() || 
                         clean.match(/[HG]\d+/i)?.[0]?.toUpperCase() || 
                         'H0000';

  let word = '';
  let original = '';
  let pronunciation = '';
  let type: 'hebrew' | 'greek' = strongNumMatch.startsWith('G') || /Grec/i.test(dateOrType || '') ? 'greek' : 'hebrew';
  let definition = '';
  let messageContext: string | undefined = undefined;
  let originVerseRef: string | undefined = undefined;
  let originVerseText: string | undefined = undefined;
  const allOccurrences: Array<{ bookName: string; chapter: number; verse: number; text: string }> = [];

  const wordHeaderMatch = clean.match(/Exégèse Strong\s+[HG]\d+\s*—\s*\*\*([^*]+)\*\*\s*(?:\(([^)]+)\))?/i);
  if (wordHeaderMatch) {
    word = wordHeaderMatch[1].trim();
    original = wordHeaderMatch[2]?.trim() || '';
  } else if (title) {
    const titleMatch = title.match(/Exégèse Strong\s+[HG]\d+\s*[:—\-]\s*(.+)/i);
    if (titleMatch) word = titleMatch[1].trim();
  }

  const pronMatch = clean.match(/Prononciation\s*:\s*\*?\[([^\]]+)\]\*?/i);
  if (pronMatch) pronunciation = pronMatch[1].trim();

  const typeMatch = clean.match(/Type\s*:\s*\*?(Hébreu|Grec)\*?/i);
  if (typeMatch) type = typeMatch[1].toLowerCase() === 'grec' ? 'greek' : 'hebrew';

  const defMatch = clean.match(/(?:###\s*💡\s*Définition Littérale|\*\*Définition\s*:\*\*)\s*\n*([\s\S]+?)(?=\n*###|\n*\*\*Éclairage|\n*\*\*Occurrences|$)/i);
  if (defMatch) {
    definition = defMatch[1].replace(/\*\*/g, '').trim();
  }

  const msgMatch = clean.match(/(?:###\s*✨\s*Éclairage dans le Message|\*\*Éclairage du Message\s*:\*\*)\s*\n*([\s\S]+?)(?=\n*###|\n*\*\*Occurrences|$)/i);
  if (msgMatch) {
    messageContext = msgMatch[1].replace(/\*\*/g, '').trim();
  }

  // Extraire les occurrences si présentes
  const occMatches = clean.matchAll(/\*\s*\*\*([^*:]+)\s+(\d+):(\d+)\*\*\s*:\s*\*?"?([^"\n*]+)"?\*?/g);
  for (const m of occMatches) {
    allOccurrences.push({
      bookName: m[1].trim(),
      chapter: parseInt(m[2], 10),
      verse: parseInt(m[3], 10),
      text: m[4].trim()
    });
  }

  if (allOccurrences.length > 0) {
    originVerseRef = `${allOccurrences[0].bookName} ${allOccurrences[0].chapter}:${allOccurrences[0].verse}`;
    originVerseText = allOccurrences[0].text;
  }

  if (!definition) {
    definition = clean.replace(/^[#*].+/gm, '').trim() || clean;
  }

  return {
    strongNumber: strongNumMatch,
    word: stripMarkdown(word || 'Terme biblique'),
    original: stripMarkdown(original || ''),
    pronunciation: stripMarkdown(pronunciation || ''),
    type,
    definition: stripMarkdown(definition.trim()),
    messageContext: messageContext ? stripMarkdown(messageContext) : undefined,
    originVerseRef,
    originVerseText: originVerseText ? stripMarkdown(originVerseText) : undefined,
    otherOccurrencesCount: allOccurrences.length > 1 ? allOccurrences.length - 1 : 0,
    allOccurrences: allOccurrences.map(o => ({ ...o, text: stripMarkdown(o.text) }))
  };
}

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
 * Nettoie et supprime tous les marqueurs de balisage Markdown (#, *, **, -, etc.)
 * pour l'affichage en texte brut / aperçu lisible sans symboles et sans résidus parasites.
 */
export function stripMarkdown(text: string): string {
  if (!text) return '';
  return text
    // Supprimer les en-têtes markdown de type # Titre, ## Sous-titre, ### Section
    .replace(/^#{1,6}\s+/gm, '')
    // Supprimer tous les autres # résiduels isolés
    .replace(/(^|\s)#+(\s|$)/g, '$1$2')
    // Supprimer les étoiles multiples ou simples (gras, italique, puces)
    .replace(/\*{1,4}/g, '')
    // Supprimer les soulignements markdown (_ ou __)
    .replace(/(^|\W)_{1,3}(\w+)_{1,3}(\W|$)/g, '$1$2$3')
    .replace(/_{1,3}/g, '')
    // Supprimer le barré ~ ou ~~
    .replace(/~{1,2}/g, '')
    // Supprimer les backticks de code ` ou ```
    .replace(/`{1,3}/g, '')
    // Supprimer les puces de liste en début de ligne (- item, + item, * item)
    .replace(/^[\s\-\*\+\>]+(?=\S)/gm, '')
    // Supprimer la numérotation automatique en début de ligne si présente (1. , 2. )
    .replace(/^\s*\d+\.\s+/gm, '')
    // Conserver le libellé des liens markdown [Texte](url)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Nettoyer les balises internes
    .replace(/\[\[\[NOTE_EXTERNE\]\]\]/g, '')
    .replace(/\[Réf:\s*[^\]]+\]/gi, '')
    .replace(/\[Source:\s*[^\]]+\]/gi, '')
    // Supprimer les barres obliques inverses d'échappement
    .replace(/\\([#*_~`\[\]()])/g, '$1')
    .replace(/\\/g, '')
    // Espaces et sauts de ligne propres
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
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
export function processNoteData(note: Note, sermons?: Array<Partial<Sermon>>): ProcessedNoteData {
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
    citationId?: string,
    sermonId?: string,
    paragraphIndex?: number,
    quotedText?: string
  ): number => {
    const key = `${type}_${title}_${dateOrVersion || ''}_${paragraphOrVerse || ''}`.toLowerCase();
    if (sourcesMap.has(key)) {
      const existing = sourcesMap.get(key)!;
      if (citationId && (!existing.citationIds || !existing.citationIds.includes(citationId))) {
        existing.citationIds = [...(existing.citationIds || []), citationId];
      }
      if (sermonId && !existing.sermonId) existing.sermonId = sermonId;
      if (paragraphIndex !== undefined && existing.paragraphIndex === undefined) existing.paragraphIndex = paragraphIndex;
      if (quotedText && !existing.quotedText) existing.quotedText = quotedText;
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
      citationIds: citationId ? [citationId] : [],
      sermonId,
      paragraphIndex,
      quotedText
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
  const definitionItems: ProcessedDefinitionItem[] = [];
  const strongItems: ProcessedStrongItem[] = [];

  if (note.citations && note.citations.length > 0) {
    const seenCitations = new Set<string>();

    for (const citation of note.citations) {
      const cleanQuote = cleanTextArtifacts(citation.quoted_text || '');
      if (!cleanQuote) continue;

      const titleSnap = cleanTextArtifacts(citation.sermon_title_snapshot || '');
      const dateSnap = cleanTextArtifacts(citation.sermon_date_snapshot || '');
      const versionSnap = cleanTextArtifacts(citation.sermon_version_snapshot || '');
      const paraRef = formatParagraphRef(citation.paragraph_index);

      // Détection de l'exégèse Strong (Prioritaire)
      const isStrongSource = citation.sermon_id?.startsWith('strong') || 
        /Exégèse Strong|Concordance Strong|Lexique Strong/i.test(titleSnap) || 
        (citation.sermon_id?.includes('strong') && !citation.sermon_id?.startsWith('bible-'));

      if (isStrongSource) {
        const parsed = parseStrongText(cleanQuote, titleSnap, dateSnap);
        const srcIdx = getOrAddSource(
          `Concordance Strong [${parsed.strongNumber}] — ${parsed.word}${parsed.original ? ` (${parsed.original})` : ''}`,
          'general',
          parsed.type === 'hebrew' ? 'Hébreu' : 'Grec',
          undefined,
          citation.id,
          citation.sermon_id,
          undefined,
          cleanQuote
        );
        strongItems.push({
          id: citation.id,
          citationId: citation.id,
          strongNumber: parsed.strongNumber,
          word: parsed.word,
          original: parsed.original,
          pronunciation: parsed.pronunciation,
          type: parsed.type,
          partOfSpeech: parsed.partOfSpeech,
          etymology: parsed.etymology,
          translationsLSG: parsed.translationsLSG,
          occurrencesCountStr: parsed.occurrencesCountStr,
          definition: parsed.definition,
          messageContext: parsed.messageContext,
          originVerseRef: parsed.originVerseRef,
          originVerseText: parsed.originVerseText,
          otherOccurrencesCount: parsed.otherOccurrencesCount,
          allOccurrences: parsed.allOccurrences,
          rawText: cleanQuote,
          sourceIndex: srcIdx,
          orderIndex: strongItems.length * 10
        });
        continue;
      }

      // Détection des définitions du dictionnaire
      const isDefinitionSource = citation.sermon_id?.startsWith('definition') || 
        /Dictionnaire|Définition/i.test(titleSnap) || 
        citation.sermon_id?.includes('definition');

      if (isDefinitionSource) {
        const parsed = parseDefinitionText(cleanQuote, titleSnap);
        const srcIdx = getOrAddSource(`Dictionnaire — Terme « ${parsed.word} »`, 'general', 'Lexique Biblique', undefined, citation.id, citation.sermon_id, undefined, cleanQuote);
        definitionItems.push({
          id: citation.id,
          citationId: citation.id,
          word: parsed.word,
          definition: parsed.definition,
          etymology: parsed.etymology,
          synonyms: parsed.synonyms,
          rawText: cleanQuote,
          sourceIndex: srcIdx,
          orderIndex: definitionItems.length * 10
        });
        continue;
      }

      // Résolution des surlignages : s'ils sont stockés dans la citation, on les utilise en priorité.
      // S'ils ne sont pas encore stockés et que la liste des sermons est fournie, on les extrait du sermon correspondant.
      let citationHighlights = citation.highlights;
      if ((!citationHighlights || citationHighlights.length === 0) && sermons && sermons.length > 0 && citation.sermon_id) {
        const matchingSermon = sermons.find(s => s.id === citation.sermon_id);
        if (matchingSermon && matchingSermon.highlights && matchingSermon.highlights.length > 0) {
          citationHighlights = extractHighlightsFromSermon(matchingSermon, cleanQuote, citation.paragraph_index);
        }
      }

      // Clé d'unicité pour filtrer les doublons historiques
      const dedupKey = `${citation.sermon_id || ''}_${citation.paragraph_index ?? ''}_${cleanQuote.toLowerCase()}`;
      if (seenCitations.has(dedupKey)) continue;
      seenCitations.add(dedupKey);

      // Classification stricte : Si le titre de la source est une référence biblique ou si la version est une version biblique (LSG)
      const isScriptureSource = isBibleReference(titleSnap) || (!!versionSnap && /LSG|Louis Segond/i.test(versionSnap) && !isBibleReference(titleSnap));
      const isChurchAgeSource = /Exposé|Expose|Sept Âges|7 Âges|Church Ages|Âges de l'Église/i.test(titleSnap);

      if (isScriptureSource && !/Exposé|Expose|Sermon|Prédication|Brochure|Message/i.test(titleSnap)) {
        const version = versionSnap || 'LSG 1910';
        const srcIdx = getOrAddSource(titleSnap || 'Bible', 'scripture', version, paraRef, citation.id, citation.sermon_id, citation.paragraph_index, cleanQuote);
        scriptureCitations.push({
          citationId: citation.id,
          sermonId: citation.sermon_id,
          paragraphIndex: citation.paragraph_index,
          quote: cleanQuote,
          reference: `${titleSnap || 'Bible'}${version ? ` — ${version}` : ''}`,
          sourceIndex: srcIdx,
          highlights: citationHighlights
        });
      } else if (isChurchAgeSource) {
        const metaParts = [];
        if (dateSnap) metaParts.push(dateSnap);
        if (paraRef) metaParts.push(paraRef);

        const srcIdx = getOrAddSource(titleSnap || "Exposé des Sept Âges", 'sermon', dateSnap, paraRef, citation.id, citation.sermon_id, citation.paragraph_index, cleanQuote);
        churchAgeCitations.push({
          citationId: citation.id,
          sermonId: citation.sermon_id,
          paragraphIndex: citation.paragraph_index,
          quote: cleanQuote,
          sourceTitle: titleSnap || "Exposé des Sept Âges",
          sourceMeta: metaParts.join(' — '),
          sourceIndex: srcIdx,
          highlights: citationHighlights
        });
      } else {
        const metaParts = [];
        if (dateSnap) metaParts.push(dateSnap);
        if (paraRef) metaParts.push(paraRef);

        const srcIdx = getOrAddSource(titleSnap || 'Exposé / Enseignement', 'sermon', dateSnap, paraRef, citation.id, citation.sermon_id, citation.paragraph_index, cleanQuote);
        teachingCitations.push({
          citationId: citation.id,
          sermonId: citation.sermon_id,
          paragraphIndex: citation.paragraph_index,
          quote: cleanQuote,
          sourceTitle: titleSnap || 'Exposé / Enseignement',
          sourceMeta: metaParts.join(' — '),
          sourceIndex: srcIdx,
          highlights: citationHighlights
        });
      }
    }
  }

  // Construction des listes unifiées d'éléments (Citations + Séparateurs indépendants)
  const noteSeparators: NoteSeparator[] = Array.isArray(note.separators) ? note.separators : [];

  const buildSectionItems = (
    category: 'scripture' | 'church_age' | 'teaching',
    citations: Array<{ citationId: string; sermonId?: string; paragraphIndex?: number; quote: string; reference?: string; sourceTitle?: string; sourceMeta?: string; sourceIndex?: number; highlights?: CitationHighlight[] }>
  ): NoteSectionItem[] => {
    const items: NoteSectionItem[] = [];

    // 1. Ajouter les citations avec des orderIndex entiers espacés (0, 10, 20...) pour permettre des insertions stables
    citations.forEach((c, idx) => {
      items.push({
        kind: 'citation',
        id: c.citationId,
        citationId: c.citationId,
        sermonId: c.sermonId,
        paragraphIndex: c.paragraphIndex,
        quote: c.quote,
        reference: c.reference,
        sourceTitle: c.sourceTitle,
        sourceMeta: c.sourceMeta,
        sourceIndex: c.sourceIndex,
        orderIndex: idx * 10,
        highlights: c.highlights
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

  // Assainissement de la zone de commentaire : extraire les blocs d'exégèse Strong historiques résiduels
  // afin de ne jamais polluer la zone de commentaire de la note.
  const legacyStrongRegex = /(?:---\s*)?#{2,3}\s*📜\s*Exégèse Strong\s+([HG]\d+)[\s\S]*?(?=(?:---\s*)?#{2,3}\s*📜\s*Exégèse Strong|$)/gi;
  let sanitizedContent = rawContent;
  let legacyMatch: RegExpExecArray | null;
  while ((legacyMatch = legacyStrongRegex.exec(rawContent)) !== null) {
    const block = legacyMatch[0];
    const strongNum = legacyMatch[1]?.toUpperCase();
    if (strongNum && !strongItems.some(item => item.strongNumber.toUpperCase() === strongNum)) {
      const parsed = parseStrongText(block, `Exégèse Strong ${strongNum}`);
      const srcIdx = getOrAddSource(
        `Concordance Strong [${parsed.strongNumber}] — ${parsed.word}${parsed.original ? ` (${parsed.original})` : ''}`,
        'general',
        parsed.type === 'hebrew' ? 'Hébreu' : 'Grec',
        undefined,
        `legacy-${parsed.strongNumber}`,
        `strong-${parsed.strongNumber}`,
        undefined,
        block
      );
      strongItems.push({
        id: `legacy-${parsed.strongNumber}`,
        citationId: `legacy-${parsed.strongNumber}`,
        strongNumber: parsed.strongNumber,
        word: parsed.word,
        original: parsed.original,
        pronunciation: parsed.pronunciation,
        type: parsed.type,
        definition: parsed.definition,
        messageContext: parsed.messageContext,
        originVerseRef: parsed.originVerseRef,
        originVerseText: parsed.originVerseText,
        otherOccurrencesCount: parsed.otherOccurrencesCount,
        allOccurrences: parsed.allOccurrences,
        rawText: block,
        sourceIndex: srcIdx,
        orderIndex: strongItems.length * 10
      });
    }
    sanitizedContent = sanitizedContent.replace(block, '');
  }
  sanitizedContent = sanitizedContent.replace(/---\s*$/g, '').trim();

  // Traitement des paragraphes du contenu principal (zone de commentaire épurée)
  const rawParagraphs = sanitizedContent
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
    for (const item of definitionItems) {
      if (item.sourceIndex && indexMapping.has(item.sourceIndex)) {
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

  if (strongItems.length > 0) {
    markdown += `### Concordance & Exégèse Strong\n\n`;
    for (const item of strongItems) {
      markdown += `#### Strong ${item.strongNumber} : **${item.word}** (${item.original}) — [${item.pronunciation}] (${item.type === 'hebrew' ? 'Hébreu' : 'Grec'})\n\n`;
      markdown += `* **Définition Littérale :** ${item.definition}\n\n`;
      if (item.messageContext) {
        markdown += `* **Éclairage dans le Message :** ${item.messageContext}\n\n`;
      }
      if (item.originVerseRef) {
        markdown += `> **Verset d'origine (${item.originVerseRef}) :**\n> « ${item.originVerseText} »\n\n`;
      }
      if (item.allOccurrences && item.allOccurrences.length > 1) {
        markdown += `*Autres occurrences (${item.allOccurrences.length}) :* ${item.allOccurrences.slice(0, 10).map(o => `${o.bookName} ${o.chapter}:${o.verse}`).join(', ')}${item.allOccurrences.length > 10 ? ` (+${item.allOccurrences.length - 10} autres)` : ''}\n\n`;
      }
    }
  }

  if (definitionItems.length > 0) {
    markdown += `### Dictionnaire & Lexique Biblique\n\n`;
    for (const item of definitionItems) {
      markdown += `**${item.word}** : ${item.definition}\n\n`;
      if (item.etymology) markdown += `*Étymologie :* ${item.etymology}\n\n`;
      if (item.synonyms && item.synonyms.length > 0) markdown += `*Synonymes :* ${item.synonyms.join(', ')}\n\n`;
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
    definitionItems,
    strongItems,
    scriptureCitations,
    churchAgeCitations,
    teachingCitations,
    sources: sourcesList,
    formattedMarkdown: markdown.trim()
  };
}
