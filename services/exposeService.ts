import { getAccentInsensitiveRegex, getMultiWordHighlightRegex, normalizeText } from '../utils/textUtils';
import { Sermon, SearchMode } from '../types';
import { fetchJsonSafe } from '../utils/fetchHelper';

export interface ExposeMetadata {
  title: string;
  author: string;
  total_pages: number;
}

export interface ExposeTOC {
  chapter_number: number;
  title: string;
  page_start: number;
}

export interface ExposeChapter {
  chapter_number: string;
  title: string;
  page_start: number;
  page_end: number;
}

export interface ExposeParagraph {
  paragraph_id: string;
  page_number: number;
  chapter_number: string | null;
  chapter_title: string | null;
  section_title: string | null;
  index_in_page: number;
  text: string;
}

export interface ExposePage {
  page_number: number;
  chapter_number: string | null;
  chapter_title: string | null;
  paragraphs: ExposeParagraph[];
}

export const cleanExposeText = (str: string): string => {
  if (!str) return '';
  return str
    .replace(/’½“/g, '’“')
    .replace(/'½“/g, '’“')
    .replace(/’½"/g, '’"')
    .replace(/½:/g, ' :')
    .replace(/½/g, ' ')
    .replace(/÷/g, 'œ')
    .replace(/×([a-zà-ÿ])/g, 'œ$1')
    .replace(/×/g, 'Œ');
};

let exposeData: {
  book: ExposeMetadata;
  table_of_contents: ExposeTOC[];
  chapters: ExposeChapter[];
  pages: Record<string, ExposePage>;
} | null = null;

export const loadExposeData = async () => {
  if (exposeData) return exposeData;
  
  try {
    const rawData = await fetchJsonSafe<any>('/expose.json', ['expose.json']);
    
    if (rawData) {
      // 1. Map TOC chapters with clean titles (including Chapter 0 'Introduction')
      const tocMap = new Map<string, { chapter_number: string; title: string; page_start: number }>();
      if (rawData.table_of_contents && Array.isArray(rawData.table_of_contents)) {
        rawData.table_of_contents.forEach((toc: ExposeTOC) => {
          const chNumStr = String(toc.chapter_number);
          tocMap.set(chNumStr, {
            chapter_number: chNumStr,
            title: cleanExposeText(toc.title),
            page_start: toc.page_start
          });
        });
      }

      // 2. Build complete chapters list with reliable page ranges
      const chaptersList: ExposeChapter[] = [];
      const tocEntries = Array.from(tocMap.values());
      for (let i = 0; i < tocEntries.length; i++) {
        const entry = tocEntries[i];
        const nextEntry = tocEntries[i + 1];
        const pageStart = entry.page_start;
        const pageEnd = nextEntry ? nextEntry.page_start - 1 : (rawData.book?.total_pages || 374);
        chaptersList.push({
          chapter_number: entry.chapter_number,
          title: entry.title,
          page_start: pageStart,
          page_end: pageEnd
        });
      }
      rawData.chapters = chaptersList;

      // 3. Sanitize and synchronize all pages with correct chapter number and chapter title
      if (rawData.pages) {
        for (const [pageNumStr, p] of Object.entries(rawData.pages) as [string, ExposePage][]) {
          const pageNum = parseInt(pageNumStr, 10);
          
          let matchingChap = chaptersList.find(c => pageNum >= c.page_start && pageNum <= c.page_end);
          if (!matchingChap && p.chapter_number !== null && p.chapter_number !== undefined) {
            matchingChap = chaptersList.find(c => c.chapter_number === String(p.chapter_number));
          }

          if (matchingChap) {
            p.chapter_number = matchingChap.chapter_number;
            p.chapter_title = matchingChap.title;
          } else if (pageNum <= 10) {
            p.chapter_number = '0';
            p.chapter_title = 'Introduction';
          }

          if (p.chapter_title) p.chapter_title = cleanExposeText(p.chapter_title);
          
          if (p.paragraphs) {
            p.paragraphs.forEach(para => {
              para.chapter_number = p.chapter_number;
              para.chapter_title = p.chapter_title;
              if (para.text) para.text = cleanExposeText(para.text);
              if (para.section_title) para.section_title = cleanExposeText(para.section_title);
            });
          }
        }
      }
      
      exposeData = rawData;
      return exposeData;
    }
  } catch (err) {
    console.warn("Could not load expose data:", err);
  }
  
  return null;
};

export const getExposeChapter = async (chapterNumber: string): Promise<Sermon | null> => {
  const data = await loadExposeData();
  if (!data) return null;
  
  const chapter = data.chapters.find(c => String(c.chapter_number) === String(chapterNumber));
  if (!chapter) return null;

  const pagesInChapter: ExposePage[] = [];
  for (let p = chapter.page_start; p <= chapter.page_end; p++) {
    if (data.pages[p]) {
      pagesInChapter.push(data.pages[p]);
    }
  }

  const textBlocks: string[] = [];
  pagesInChapter.forEach(page => {
    page.paragraphs.forEach(paragraph => {
      textBlocks.push(paragraph.text);
    });
  });

  return {
    id: `expose-ch-${chapterNumber}`,
    title: chapter.chapter_number === '0' ? chapter.title : `Chapitre ${chapter.chapter_number} - ${chapter.title}`,
    date: '1965',
    city: 'W.M. Branham',
    text: textBlocks.join('\n\n'),
    version: 'EXPOSE'
  };
};

export const getExposePage = async (pageNumber: number): Promise<Sermon | null> => {
  const data = await loadExposeData();
  if (!data || !data.pages[pageNumber]) return null;
  
  const page = data.pages[pageNumber];
  const textBlocks: string[] = [];
  
  page.paragraphs.forEach(paragraph => {
    textBlocks.push(paragraph.text);
  });

  const title = page.chapter_title 
    ? `${page.chapter_title} - Page ${pageNumber}`
    : `Exposé des Sept Âges - Page ${pageNumber}`;

  return {
    id: `expose-pg-${pageNumber}`,
    title: title,
    date: '1965',
    city: 'W.M. Branham',
    text: textBlocks.join('\n\n'),
    version: 'EXPOSE'
  };
};

export const searchExpose = async (query: string, mode: SearchMode = SearchMode.EXACT_WORDS) => {
    const data = await loadExposeData();
    if (!data) return [];
    
    const trimmed = (query || "").trim();
    if (!trimmed) return [];

    const results = [];
    const normalizedQuery = normalizeText(trimmed);
    const queryWords = normalizedQuery.split(/\s+/).filter(w => w.length > 0);

    // Classes de surlignage haute visibilité
    const markBase = "font-black px-1 rounded-sm underline decoration-[3.5px] underline-offset-4 shadow-sm";
    const markClass = `${markBase} bg-amber-500 text-white dark:bg-amber-600 decoration-amber-200`;

    const termsForHighlight = mode === SearchMode.EXACT_PHRASE 
      ? [trimmed] 
      : (queryWords.length > 0 ? queryWords : [trimmed]);
    
    const finalRegexSource = termsForHighlight
      .map(t => t.trim())
      .filter(t => t.length > 1)
      .join('|');

    const highlightRegex = finalRegexSource ? getMultiWordHighlightRegex(finalRegexSource) : null;

    for (const pageNumber in data.pages) {
        const page = data.pages[pageNumber];
        for (let i = 0; i < page.paragraphs.length; i++) {
            const p = page.paragraphs[i];
            if (!p.text) continue;
            
            const normalizedText = normalizeText(p.text);
            let matchFound = false;

            if (mode === SearchMode.EXACT_PHRASE) {
              matchFound = normalizedText.includes(normalizedQuery);
            } else if (mode === SearchMode.DIVERSE) {
              matchFound = queryWords.some(w => normalizedText.includes(w));
            } else {
              // ALL_WORDS
              matchFound = queryWords.every(w => normalizedText.includes(w));
            }
            
            if (matchFound) {
                let snippetContent = p.text;
                if (highlightRegex) {
                  highlightRegex.lastIndex = 0;
                  const matchExec = highlightRegex.exec(p.text);

                  if (matchExec) {
                    const matchPos = matchExec.index;
                    const windowStart = Math.max(0, matchPos - 60);
                    const windowEnd = Math.min(p.text.length, matchPos + 380);
                    snippetContent = p.text.substring(windowStart, windowEnd);
                    if (windowStart > 0) snippetContent = '...' + snippetContent;
                    if (windowEnd < p.text.length) snippetContent = snippetContent + '...';
                  }
                }

                let snippetFormatted = snippetContent.replace(/\n+/g, ' • ');
                if (highlightRegex) {
                  highlightRegex.lastIndex = 0;
                  snippetFormatted = snippetFormatted.replace(highlightRegex, (m) => {
                      return `<mark class="${markClass}">${m}</mark>`;
                  });
                }

                results.push({
                    sermonId: `expose-pg-${page.page_number}`,
                    paragraphId: p.paragraph_id,
                    title: `Exposé - Page ${page.page_number}`,
                    date: '1965',
                    city: 'W.M. Branham',
                    paragraphIndex: i + 1, // Store expects 1-based index usually
                    snippet: snippetFormatted
                });
            }
        }
    }
    return results;
}

export interface ExposeMetadataTree {
    chapters: {
        title: string;
        chapter_number: string;
        sections: string[];
    }[];
}

export const getExposeTree = async (): Promise<ExposeMetadataTree> => {
    const data = await loadExposeData();
    if (!data) return { chapters: [] };

    const chaptersMap = new Map<string, { title: string; chapter_number: string; sections: Set<string> }>();
    
    data.chapters.forEach(c => {
        const chKey = String(c.chapter_number);
        chaptersMap.set(chKey, {
            title: c.title,
            chapter_number: chKey,
            sections: new Set()
        });
    });

    for (const p of Object.values(data.pages)) {
        const chapNum = p.chapter_number !== null && p.chapter_number !== undefined ? String(p.chapter_number) : '0';
        const chap = chaptersMap.get(chapNum);
        if (!chap) continue;
        for (const para of p.paragraphs) {
            if (para.section_title && para.section_title.trim()) {
                chap.sections.add(para.section_title.trim());
            }
        }
    }

    return {
        chapters: Array.from(chaptersMap.values()).map(c => ({
            title: c.title,
            chapter_number: c.chapter_number,
            sections: Array.from(c.sections)
        }))
    };
};

export const getExposePagesMeta = async (chapterNumber: string | null, sectionTitle: string | null): Promise<ExposePage[]> => {
    const data = await loadExposeData();
    if (!data) return [];

    const pages: ExposePage[] = [];

    for (const page of Object.values(data.pages)) {
        const pChapNum = page.chapter_number !== null && page.chapter_number !== undefined ? String(page.chapter_number) : '0';
        if (chapterNumber && pChapNum !== String(chapterNumber)) continue;
        
        if (sectionTitle) {
            const hasSection = page.paragraphs.some(p => p.section_title === sectionTitle);
            if (!hasSection) continue;
        }

        pages.push(page);
    }

    // Sort by page number
    return pages.sort((a, b) => a.page_number - b.page_number);
};
