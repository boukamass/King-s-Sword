import { Note, Citation } from '../types';

export interface FormattedSource {
  index: number;
  id: string;
  type: 'scripture' | 'sermon' | 'general';
  title: string;
  dateOrVersion?: string;
  paragraphOrVerse?: string;
  formattedLine: string;
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
  scriptureCitations: {
    citationId: string;
    quote: string;
    reference: string;
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
    paragraphOrVerse?: string
  ): number => {
    const key = `${type}_${title}_${dateOrVersion || ''}_${paragraphOrVerse || ''}`.toLowerCase();
    if (sourcesMap.has(key)) {
      return sourcesMap.get(key)!.index;
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
      formattedLine
    };

    sourcesMap.set(key, sourceObj);
    sourcesList.push(sourceObj);
    sourceCounter++;
    return sourceObj.index;
  };

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

  // Traitement des citations rattachées (Citations)
  const scriptureCitations: ProcessedNoteData['scriptureCitations'] = [];
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

      if (isScriptureSource && !/Exposé|Expose|Sermon|Prédication|Brochure|Message/i.test(titleSnap)) {
        const version = versionSnap || 'LSG 1910';
        const srcIdx = getOrAddSource(titleSnap || 'Bible', 'scripture', version, paraRef);
        scriptureCitations.push({
          citationId: citation.id,
          quote: cleanQuote,
          reference: `${titleSnap || 'Bible'}${version ? ` — ${version}` : ''}`,
          sourceIndex: srcIdx
        });
      } else {
        const metaParts = [];
        if (dateSnap) metaParts.push(dateSnap);
        if (paraRef) metaParts.push(paraRef);

        const srcIdx = getOrAddSource(titleSnap || 'Exposé / Enseignement', 'sermon', dateSnap, paraRef);
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

  // Construction du Markdown récapitulatif
  let markdown = `# ${cleanTitle}\n\n`;

  if (contentParagraphs.length > 0) {
    markdown += `## Contenu\n\n`;
    markdown += contentParagraphs.join('\n\n') + '\n\n';
  }

  if (scriptureCitations.length > 0) {
    markdown += `### Citation biblique\n\n`;
    for (const sc of scriptureCitations) {
      markdown += `> « ${sc.quote} »\n\n`;
      markdown += `**${sc.reference}**${sc.sourceIndex ? ` **[${sc.sourceIndex}]**` : ''}\n\n`;
    }
  }

  if (teachingCitations.length > 0) {
    markdown += `### Citation / Enseignement\n\n`;
    for (const tc of teachingCitations) {
      markdown += `> « ${tc.quote} »\n\n`;
      markdown += `*${tc.sourceTitle}*${tc.sourceMeta ? ` — ${tc.sourceMeta}` : ''}${tc.sourceIndex ? ` **[${tc.sourceIndex}]**` : ''}\n\n`;
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
    scriptureCitations,
    teachingCitations,
    sources: sourcesList,
    formattedMarkdown: markdown.trim()
  };
}
