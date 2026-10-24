import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  ShadingType,
  ImageRun,
  Footer,
  PageNumber,
  Header,
  TableLayoutType,
  VerticalAlign
} from 'docx';
import saveAs from 'file-saver';
import { Note, CitationHighlight, Sermon } from '../types';
import { processNoteData, stripMarkdown, cleanTextArtifacts } from '../utils/noteFormatter';
import { splitQuoteIntoHighlightedSegments, HIGHLIGHT_HEX_MAP } from '../utils/highlightUtils';
import iconPngMap from './iconPngBase64.json';

/**
 * Dimensions A4 explicites en DXA (1 inch = 1440 DXA, 1 mm ≈ 56.6929 DXA)
 * Largeur A4 = 210mm = 11906 DXA | Hauteur A4 = 297mm = 16838 DXA
 * Marges gauche/droite = 1440 DXA (25.4mm) -> Zone imprimable exacte = 11906 - 2880 = 9026 DXA
 */
export const PAGE_WIDTH_DXA = 11906;
export const PAGE_HEIGHT_DXA = 16838;
export const PAGE_MARGIN_X_DXA = 1440;
export const PAGE_MARGIN_Y_DXA = 1134;
export const CARD_WIDTH_DXA = 9026;

const iconBytesCache = new Map<string, Uint8Array>();

export function getIconBytes(key: string): Uint8Array | null {
  if (iconBytesCache.has(key)) return iconBytesCache.get(key)!;
  const b64 = (iconPngMap as Record<string, string>)[key];
  if (!b64) return null;
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    iconBytesCache.set(key, bytes);
    return bytes;
  } catch {
    return null;
  }
}

export function createIconRun(bytes: Uint8Array | null, size = 15): ImageRun | null {
  if (!bytes || bytes.length === 0) return null;
  return new ImageRun({
    data: bytes,
    transformation: { width: size, height: size },
    type: 'png'
  });
}

/**
 * Définition vectorielle des icônes du Journal d'Étude (Lucide icons)
 * pour un rendu haute définition (64x64 PNG) avec badges colorés identiques au Journal.
 */
interface CustomBadgeSpec {
  paths: string;
  stroke: string;
  bgFill?: string;
  bgStroke?: string;
  fallbackKey: string;
}

const JOURNAL_ICON_SPECS: Record<string, CustomBadgeSpec> = {
  note_badge: {
    paths: `<path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4"/><path d="M2 6h4"/><path d="M2 10h4"/><path d="M2 14h4"/><path d="M2 18h4"/><path d="M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"/>`,
    stroke: '#ffffff',
    bgFill: '#0d9488',
    fallbackKey: 'note'
  },
  ai_badge: {
    paths: `<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>`,
    stroke: '#ffffff',
    bgFill: '#0d9488',
    fallbackKey: 'ai'
  },
  strong_badge: {
    paths: `<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>`,
    stroke: '#ffffff',
    bgFill: '#0f766e',
    fallbackKey: 'strong'
  },
  def_badge: {
    paths: `<path d="M12 7v14"/><path d="M16 12h2"/><path d="M16 8h2"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/><path d="M6 12h2"/><path d="M6 8h2"/>`,
    stroke: '#0d9488',
    bgFill: '#f0fdfa',
    bgStroke: '#99f6e4',
    fallbackKey: 'definition'
  },
  quote_teal: {
    paths: `<path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/><path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/>`,
    stroke: '#0d9488',
    fallbackKey: 'teaching'
  },
  scroll_amber: {
    paths: `<path d="M15 12h-5"/><path d="M15 8h-5"/><path d="M19 17V5a2 2 0 0 0-2-2H4"/><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"/>`,
    stroke: '#d97706',
    fallbackKey: 'church_age'
  },
  type_teal: {
    paths: `<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" x2="15" y1="20" y2="20"/><line x1="12" x2="12" y1="4" y2="20"/>`,
    stroke: '#0d9488',
    fallbackKey: 'scripture'
  },
  type_amber: {
    paths: `<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" x2="15" y1="20" y2="20"/><line x1="12" x2="12" y1="4" y2="20"/>`,
    stroke: '#d97706',
    fallbackKey: 'church_age'
  },
  comment_teal: {
    paths: `<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>`,
    stroke: '#0d9488',
    bgFill: '#f0fdfa',
    bgStroke: '#99f6e4',
    fallbackKey: 'note'
  },
  comment_amber: {
    paths: `<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>`,
    stroke: '#d97706',
    bgFill: '#fffbeb',
    bgStroke: '#fde68a',
    fallbackKey: 'church_age'
  },
  info_teal: {
    paths: `<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>`,
    stroke: '#0d9488',
    fallbackKey: 'strong'
  },
  flame_teal: {
    paths: `<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>`,
    stroke: '#0d9488',
    fallbackKey: 'ai'
  },
  history_teal: {
    paths: `<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>`,
    stroke: '#0d9488',
    fallbackKey: 'definition'
  },
  book_open_teal: {
    paths: `<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>`,
    stroke: '#0d9488',
    fallbackKey: 'scripture'
  },
  link_teal: {
    paths: `<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>`,
    stroke: '#0d9488',
    fallbackKey: 'sources'
  },
  tag_teal: {
    paths: `<path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/><path d="M7 7h.01"/>`,
    stroke: '#0d9488',
    fallbackKey: 'tag'
  },
  image_teal: {
    paths: `<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>`,
    stroke: '#0d9488',
    fallbackKey: 'note'
  }
};

async function getJournalIconBytes(specKey: string): Promise<Uint8Array | null> {
  const cacheKey = `journal_${specKey}`;
  if (iconBytesCache.has(cacheKey)) return iconBytesCache.get(cacheKey)!;

  const spec = JOURNAL_ICON_SPECS[specKey];
  if (!spec) return getIconBytes(specKey);

  if (typeof document === 'undefined') {
    return getIconBytes(spec.fallbackKey);
  }

  try {
    const size = 64;
    let svgMarkup: string;
    if (spec.bgFill) {
      const strokeAttr = spec.bgStroke ? `stroke="${spec.bgStroke}" stroke-width="2"` : '';
      svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
        <rect x="2" y="2" width="60" height="60" rx="14" ry="14" fill="${spec.bgFill}" ${strokeAttr}/>
        <g transform="translate(14, 14) scale(1.5)" fill="none" stroke="${spec.stroke}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          ${spec.paths}
        </g>
      </svg>`;
    } else {
      svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${spec.stroke}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        ${spec.paths}
      </svg>`;
    }

    const encoded = btoa(unescape(encodeURIComponent(svgMarkup)));
    const dataUrl = `data:image/svg+xml;base64,${encoded}`;

    const pngBytes = await new Promise<Uint8Array | null>((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0, size, size);
        const pngUrl = canvas.toDataURL('image/png');
        const b64 = pngUrl.split(',')[1];
        if (!b64) {
          resolve(null);
          return;
        }
        const bin = atob(b64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        resolve(arr);
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });

    if (pngBytes && pngBytes.length > 0) {
      iconBytesCache.set(cacheKey, pngBytes);
      return pngBytes;
    }
  } catch {
    // Fallback below
  }

  return getIconBytes(spec.fallbackKey);
}

/**
 * Analyse une ligne de texte pour produire des TextRuns Word propres,
 * en traduisant les balises markdown de gras (**mot**) et d'italique (*mot*),
 * tout en éradiquant les artefacts parasites (#, @).
 */
function parseInlineRuns(
  text: string,
  baseStyle?: { color?: string; size?: number; font?: string; italics?: boolean; bold?: boolean }
): TextRun[] {
  if (!text) return [];
  const cleaned = cleanTextArtifacts(text).replace(/@\w+/g, '').replace(/@/g, '').replace(/#+/g, '');

  const runs: TextRun[] = [];
  const parts = cleaned.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);

  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      runs.push(
        new TextRun({
          text: part.slice(2, -2),
          bold: true,
          italics: baseStyle?.italics,
          color: baseStyle?.color || "18181B",
          size: baseStyle?.size || 21,
          font: baseStyle?.font || "Calibri"
        })
      );
    } else if (part.startsWith('*') && part.endsWith('*') && part.length >= 2) {
      runs.push(
        new TextRun({
          text: part.slice(1, -1),
          bold: baseStyle?.bold,
          italics: true,
          color: baseStyle?.color || "3F3F46",
          size: baseStyle?.size || 21,
          font: baseStyle?.font || "Calibri"
        })
      );
    } else {
      runs.push(
        new TextRun({
          text: part,
          bold: baseStyle?.bold,
          italics: baseStyle?.italics,
          color: baseStyle?.color || "27272A",
          size: baseStyle?.size || 21,
          font: baseStyle?.font || "Calibri"
        })
      );
    }
  }

  return runs.length > 0 ? runs : [new TextRun({ text: cleaned, ...baseStyle })];
}

/**
 * Convertit un bloc markdown (titres, listes à puces, numéros, citations, paragraphes)
 * en paragraphes Word (.docx) structurés et esthétiques, contenus strictement dans leur cellule.
 */
function renderMarkdownBlockToDocx(markdownText: string, primaryColor: string = "0D9488", useSerif = false): Paragraph[] {
  if (!markdownText) return [];
  const lines = markdownText.split('\n');
  const paragraphs: Paragraph[] = [];
  const bodyFont = useSerif ? "Georgia" : "Calibri";

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine) continue;

    // Titre 1 (# Titre)
    if (/^#\s+/.test(rawLine)) {
      paragraphs.push(
        new Paragraph({
          children: parseInlineRuns(rawLine.replace(/^#\s+/, ''), {
            bold: true,
            size: 25,
            color: "18181B",
            font: "Arial"
          }),
          spacing: { before: 180, after: 80 }
        })
      );
    }
    // Titre 2 (## Titre)
    else if (/^##\s+/.test(rawLine)) {
      paragraphs.push(
        new Paragraph({
          children: parseInlineRuns(rawLine.replace(/^##\s+/, ''), {
            bold: true,
            size: 22,
            color: primaryColor,
            font: "Arial"
          }),
          spacing: { before: 150, after: 70 }
        })
      );
    }
    // Titre 3 (### Titre)
    else if (/^#{3,6}\s+/.test(rawLine)) {
      paragraphs.push(
        new Paragraph({
          children: parseInlineRuns(rawLine.replace(/^#{3,6}\s+/, ''), {
            bold: true,
            size: 20,
            color: primaryColor,
            font: "Arial"
          }),
          spacing: { before: 120, after: 60 }
        })
      );
    }
    // Sous-titre ou intitulé gras en ligne isolée
    else if (/^\*\*[^*]+\*\*\s*$/.test(rawLine)) {
      paragraphs.push(
        new Paragraph({
          children: parseInlineRuns(rawLine, {
            bold: true,
            size: 21,
            color: "18181B",
            font: "Arial"
          }),
          spacing: { before: 120, after: 50 }
        })
      );
    }
    // Citation blockquote (> Citation)
    else if (/^>\s*/.test(rawLine)) {
      paragraphs.push(
        new Paragraph({
          children: parseInlineRuns(rawLine.replace(/^>\s*/, ''), {
            italics: true,
            size: 20,
            color: "3F3F46",
            font: "Georgia"
          }),
          border: {
            left: { style: BorderStyle.SINGLE, size: 16, color: primaryColor, space: 8 }
          },
          indent: { left: 200 },
          spacing: { before: 70, after: 70, line: 260 }
        })
      );
    }
    // Puce de liste (- item ou * item)
    else if (/^[-*•]\s+/.test(rawLine)) {
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: "•  ",
              bold: true,
              color: primaryColor,
              size: 20,
              font: "Arial"
            }),
            ...parseInlineRuns(rawLine.replace(/^[-*•]\s+/, ''), {
              size: 20,
              color: "27272A",
              font: bodyFont
            })
          ],
          indent: { left: 220 },
          spacing: { after: 60, line: 260 }
        })
      );
    }
    // Sous-puce indentée
    else if (/^\s+[-*•]\s+/.test(lines[i])) {
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: "–  ",
              bold: true,
              color: "71717A",
              size: 19,
              font: "Arial"
            }),
            ...parseInlineRuns(rawLine.replace(/^[-*•]\s+/, ''), {
              size: 19,
              color: "3F3F46",
              font: bodyFont
            })
          ],
          indent: { left: 400 },
          spacing: { after: 50, line: 250 }
        })
      );
    }
    // Liste numérotée (1. item)
    else if (/^\d+\.\s+/.test(rawLine)) {
      const numMatch = rawLine.match(/^(\d+\.)\s+(.+)$/);
      if (numMatch) {
        paragraphs.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `${numMatch[1]}  `,
                bold: true,
                color: primaryColor,
                size: 20,
                font: bodyFont
              }),
              ...parseInlineRuns(numMatch[2], {
                size: 20,
                color: "27272A",
                font: bodyFont
              })
            ],
            indent: { left: 220 },
            spacing: { after: 60, line: 260 }
          })
        );
      } else {
        paragraphs.push(
          new Paragraph({
            children: parseInlineRuns(rawLine, { size: 20, color: "27272A", font: bodyFont }),
            spacing: { after: 100, line: 270 }
          })
        );
      }
    }
    // Paragraphe standard
    else {
      paragraphs.push(
        new Paragraph({
          children: parseInlineRuns(rawLine, {
            size: 21,
            color: "27272A",
            font: bodyFont
          }),
          spacing: { after: 100, line: 276 }
        })
      );
    }
  }

  return paragraphs;
}

/**
 * Génère les TextRuns pour une citation Word en reflétant les surlignages éventuels,
 * sans aucun symbole parasite @ ou #.
 */
function createDocxQuoteRuns(quote: string, highlights?: CitationHighlight[]): TextRun[] {
  const cleanQuote = cleanTextArtifacts(quote || '').replace(/@\w+/g, '').replace(/@/g, '').replace(/#+/g, '');

  if (!highlights || highlights.length === 0) {
    return [
      new TextRun({
        text: `« ${cleanQuote} »`,
        italics: true,
        size: 21,
        color: "27272A",
        font: "Georgia"
      })
    ];
  }

  const segments = splitQuoteIntoHighlightedSegments(cleanQuote, highlights);
  const runs: TextRun[] = [];

  runs.push(
    new TextRun({
      text: '« ',
      italics: true,
      size: 21,
      color: "27272A",
      font: "Georgia"
    })
  );

  segments.forEach(seg => {
    if (seg.isHighlighted) {
      const hex = HIGHLIGHT_HEX_MAP[seg.color || 'amber']?.hex || 'FEF08A';
      runs.push(
        new TextRun({
          text: seg.text,
          italics: true,
          size: 21,
          color: "18181B",
          font: "Georgia",
          shading: {
            type: ShadingType.CLEAR,
            fill: hex,
            color: "auto"
          }
        })
      );
    } else {
      runs.push(
        new TextRun({
          text: seg.text,
          italics: true,
          size: 21,
          color: "27272A",
          font: "Georgia"
        })
      );
    }
  });

  runs.push(
    new TextRun({
      text: ' »',
      italics: true,
      size: 21,
      color: "27272A",
      font: "Georgia"
    })
  );

  return runs;
}

/**
 * Safely fetches an image (Data URL, blob or web URL) and converts it to ArrayBuffer + dimensions
 */
async function fetchImageForDocx(url: string): Promise<{ buffer: ArrayBuffer; width: number; height: number } | null> {
  try {
    if (!url) return null;

    if (url.startsWith('data:')) {
      const parts = url.split(',');
      if (parts.length < 2) return null;
      const base64 = parts[1];
      const binaryStr = atob(base64);
      const len = binaryStr.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      const dimensions = await new Promise<{ width: number; height: number }>((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth || 600, height: img.naturalHeight || 400 });
        img.onerror = () => resolve({ width: 600, height: 400 });
        img.src = url;
      });

      return { buffer: bytes.buffer, width: dimensions.width, height: dimensions.height };
    } else {
      const response = await fetch(url, { mode: 'cors' });
      if (!response.ok) return null;
      const blob = await response.blob();
      const buffer = await blob.arrayBuffer();

      const blobUrl = URL.createObjectURL(blob);
      const dimensions = await new Promise<{ width: number; height: number }>((resolve) => {
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(blobUrl);
          resolve({ width: img.naturalWidth || 600, height: img.naturalHeight || 400 });
        };
        img.onerror = () => {
          URL.revokeObjectURL(blobUrl);
          resolve({ width: 600, height: 400 });
        };
        img.src = blobUrl;
      });

      return { buffer, width: dimensions.width, height: dimensions.height };
    }
  } catch (err) {
    console.warn("Failed to process image for Word export:", err);
    return null;
  }
}

/**
 * Helper pour construire une carte Word (Table 100% contenue dans CARD_WIDTH_DXA avec TableLayoutType.FIXED)
 * reproduisant fidèlement les cartes du Journal d'Étude sans aucun débordement de marge.
 */
function createJournalCardTable(options: {
  children: (Paragraph | Table)[];
  borderColor?: string;
  leftAccentColor?: string;
  fillColor?: string;
  padding?: { top?: number; bottom?: number; left?: number; right?: number };
}): Table {
  const bColor = options.borderColor || "E4E4E7";
  const lColor = options.leftAccentColor || bColor;
  const lSize = options.leftAccentColor ? 20 : 8;
  const fill = options.fillColor || "FFFFFF";
  const pad = options.padding || { top: 180, bottom: 180, left: 220, right: 220 };

  return new Table({
    layout: TableLayoutType.FIXED,
    width: { size: CARD_WIDTH_DXA, type: WidthType.DXA },
    columnWidths: [CARD_WIDTH_DXA],
    rows: [
      new TableRow({
        cantSplit: false,
        children: [
          new TableCell({
            width: { size: CARD_WIDTH_DXA, type: WidthType.DXA },
            children: options.children,
            shading: {
              type: ShadingType.CLEAR,
              fill,
              color: "auto"
            },
            borders: {
              top: { style: BorderStyle.SINGLE, size: 8, color: bColor },
              right: { style: BorderStyle.SINGLE, size: 8, color: bColor },
              bottom: { style: BorderStyle.SINGLE, size: 8, color: bColor },
              left: { style: BorderStyle.SINGLE, size: lSize, color: lColor }
            },
            margins: {
              top: pad.top ?? 180,
              bottom: pad.bottom ?? 180,
              left: pad.left ?? 220,
              right: pad.right ?? 220
            }
          })
        ]
      })
    ]
  });
}

/**
 * Helper pour construire un séparateur (Sous-titre centré avec icône ou Commentaire autonome avec icône)
 * identique au Journal d'Étude.
 */
function createSeparatorBlocks(
  separatorType: 'subtitle' | 'comment' | undefined,
  text: string,
  variant: 'teal' | 'amber',
  typeIconBytes: Uint8Array | null,
  commentIconBytes: Uint8Array | null
): (Paragraph | Table)[] {
  const isAmber = variant === 'amber';
  const accentColor = isAmber ? "B45309" : "0F766E";
  const borderColor = isAmber ? "FDE68A" : "99F6E4";
  const bgColor = isAmber ? "FFFBEB" : "F0FDFA";

  if (separatorType === 'subtitle') {
    const iconRun = createIconRun(typeIconBytes, 14);
    const subtitleTable = new Table({
      layout: TableLayoutType.FIXED,
      width: { size: CARD_WIDTH_DXA, type: WidthType.DXA },
      columnWidths: [CARD_WIDTH_DXA],
      rows: [
        new TableRow({
          cantSplit: true,
          children: [
            new TableCell({
              width: { size: CARD_WIDTH_DXA, type: WidthType.DXA },
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    ...(iconRun ? [iconRun, new TextRun({ text: "  " })] : []),
                    new TextRun({
                      text: stripMarkdown(text).toUpperCase(),
                      bold: true,
                      size: 19,
                      color: accentColor,
                      font: "Arial"
                    })
                  ],
                  spacing: { before: 40, after: 40 }
                })
              ],
              shading: {
                type: ShadingType.CLEAR,
                fill: bgColor,
                color: "auto"
              },
              borders: {
                top: { style: BorderStyle.SINGLE, size: 8, color: borderColor },
                bottom: { style: BorderStyle.SINGLE, size: 8, color: borderColor },
                left: { style: BorderStyle.SINGLE, size: 8, color: borderColor },
                right: { style: BorderStyle.SINGLE, size: 8, color: borderColor }
              },
              margins: { top: 80, bottom: 80, left: 180, right: 180 }
            })
          ]
        })
      ]
    });

    return [
      new Paragraph({ spacing: { before: 120 } }),
      subtitleTable,
      new Paragraph({ spacing: { after: 120 } })
    ];
  }

  // Commentaire / Réflexion autonome avec icône MessageSquare
  const cIcon = createIconRun(commentIconBytes, 18);
  const commentCard = createJournalCardTable({
    borderColor,
    leftAccentColor: isAmber ? "D97706" : "0D9488",
    fillColor: bgColor,
    padding: { top: 140, bottom: 140, left: 200, right: 200 },
    children: [
      new Paragraph({
        children: [
          ...(cIcon ? [cIcon, new TextRun({ text: "  " })] : []),
          new TextRun({
            text: stripMarkdown(text),
            italics: true,
            size: 20,
            color: "3F3F46",
            font: "Calibri"
          })
        ],
        spacing: { before: 40, after: 40, line: 260 }
      })
    ]
  });

  return [
    commentCard,
    new Paragraph({ spacing: { after: 140 } })
  ];
}

/**
 * Generates and downloads a beautifully formatted Microsoft Word (.docx) document from a Note
 * matching the Study Journal (Journal d'Étude) layout, icons, and strict A4 margins.
 */
export async function exportNoteToDocx(note: Note, sermons?: Array<Partial<Sermon>>): Promise<boolean> {
  try {
    const primaryColor = "0F766E"; // Deep Teal
    const tealAccent = "0D9488";   // Teal-600
    const amberColor = "B45309";   // Amber-700
    const amberAccent = "D97706";  // Amber-600
    const mutedColor = "71717A";   // Zinc-500

    // Chargement des icônes de base + badges haute fidélité du Journal d'Étude
    const [
      aiIconBytes,
      scriptureIconBytes,
      churchAgeIconBytes,
      teachingIconBytes,
      strongIconBytes,
      defIconBytes,
      noteIconBytes,
      tagIconBytes,
      sourcesIconBytes,
      noteBadgeBytes,
      aiBadgeBytes,
      strongBadgeBytes,
      defBadgeBytes,
      quoteTealBytes,
      scrollAmberBytes,
      typeTealBytes,
      typeAmberBytes,
      commentTealBytes,
      commentAmberBytes,
      infoTealBytes,
      flameTealBytes,
      historyTealBytes,
      imageTealBytes,
      bookOpenTealBytes,
      linkTealBytes
    ] = await Promise.all([
      Promise.resolve(getIconBytes('ai')),
      Promise.resolve(getIconBytes('scripture')),
      Promise.resolve(getIconBytes('church_age')),
      Promise.resolve(getIconBytes('teaching')),
      Promise.resolve(getIconBytes('strong')),
      Promise.resolve(getIconBytes('definition')),
      Promise.resolve(getIconBytes('note')),
      Promise.resolve(getIconBytes('tag')),
      Promise.resolve(getIconBytes('sources')),
      getJournalIconBytes('note_badge'),
      getJournalIconBytes('ai_badge'),
      getJournalIconBytes('strong_badge'),
      getJournalIconBytes('def_badge'),
      getJournalIconBytes('quote_teal'),
      getJournalIconBytes('scroll_amber'),
      getJournalIconBytes('type_teal'),
      getJournalIconBytes('type_amber'),
      getJournalIconBytes('comment_teal'),
      getJournalIconBytes('comment_amber'),
      getJournalIconBytes('info_teal'),
      getJournalIconBytes('flame_teal'),
      getJournalIconBytes('history_teal'),
      getJournalIconBytes('image_teal'),
      getJournalIconBytes('book_open_teal'),
      getJournalIconBytes('link_teal')
    ]);

    const processed = processNoteData(note, sermons);
    const childrenElements: (Paragraph | Table)[] = [];

    const formattedDate = note.date
      ? new Date(note.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
      : new Date().toLocaleDateString('fr-FR');

    // =========================================================================
    // 1. CARTE PRINCIPALE DU JOURNAL (Titre + Badge Thème + Contenu Principal + Images)
    // =========================================================================
    const mainCardChildren: (Paragraph | Table)[] = [];

    const mainNoteBadge = createIconRun(noteBadgeBytes || noteIconBytes, 26);
    const tagIcon = createIconRun(tagIconBytes, 13);

    // En-tête de la carte principale (Icône NotebookPen + Titre + Thème + Date)
    mainCardChildren.push(
      new Paragraph({
        children: [
          ...(mainNoteBadge ? [mainNoteBadge, new TextRun({ text: "   " })] : []),
          new TextRun({
            text: stripMarkdown(processed.title).toUpperCase(),
            bold: true,
            size: 28, // 14pt
            color: "18181B",
            font: "Arial"
          })
        ],
        spacing: { before: 40, after: 80 }
      })
    );

    // Barre de métadonnées (Thème + Date) avec bordure inférieure de séparation
    mainCardChildren.push(
      new Paragraph({
        children: [
          ...(tagIcon ? [tagIcon, new TextRun({ text: " " })] : []),
          new TextRun({
            text: `${note.theme || 'Général'}`,
            bold: true,
            size: 18,
            color: primaryColor,
            font: "Arial"
          }),
          new TextRun({
            text: `   •   Journal d'Étude King's Sword   •   ${formattedDate}`,
            size: 18,
            color: mutedColor,
            font: "Calibri"
          })
        ],
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 6, color: "E4E4E7", space: 8 }
        },
        spacing: { after: 180 }
      })
    );

    // Contenu principal avec barre latérale gauche Teal comme dans le Journal
    if (processed.contentParagraphs.length > 0) {
      const contentParas: Paragraph[] = [];
      for (const pText of processed.contentParagraphs) {
        const pElements = renderMarkdownBlockToDocx(pText, tealAccent, true);
        contentParas.push(...pElements);
      }

      if (contentParas.length > 0) {
        const innerContentWidth = CARD_WIDTH_DXA - 480;
        const contentQuoteBlock = new Table({
          layout: TableLayoutType.FIXED,
          width: { size: innerContentWidth, type: WidthType.DXA },
          columnWidths: [innerContentWidth],
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  width: { size: innerContentWidth, type: WidthType.DXA },
                  children: contentParas,
                  borders: {
                    left: { style: BorderStyle.SINGLE, size: 16, color: "99F6E4" },
                    top: { style: BorderStyle.NONE },
                    right: { style: BorderStyle.NONE },
                    bottom: { style: BorderStyle.NONE }
                  },
                  margins: { top: 40, bottom: 40, left: 200, right: 40 }
                })
              ]
            })
          ]
        });
        mainCardChildren.push(contentQuoteBlock);
      }
    }

    // Images & Illustrations rattachées (intégrées au bas de la carte principale comme dans le Journal)
    if (note.images && note.images.length > 0) {
      const imgHeaderIcon = createIconRun(imageTealBytes || noteIconBytes, 15);
      mainCardChildren.push(
        new Paragraph({
          children: [
            ...(imgHeaderIcon ? [imgHeaderIcon, new TextRun({ text: "  " })] : []),
            new TextRun({
              text: `IMAGES & ILLUSTRATIONS JOINTES (${note.images.length})`,
              bold: true,
              size: 19,
              color: "3F3F46",
              font: "Arial"
            })
          ],
          border: {
            top: { style: BorderStyle.SINGLE, size: 6, color: "F4F4F5", space: 10 }
          },
          spacing: { before: 220, after: 140 }
        })
      );

      for (let idx = 0; idx < note.images.length; idx++) {
        const img = note.images[idx];
        const imgData = await fetchImageForDocx(img.url);

        if (imgData) {
          const maxW = 420;
          let targetW = imgData.width;
          let targetH = imgData.height;

          if (targetW > maxW || targetW <= 0) {
            const ratio = maxW / (targetW || 600);
            targetW = maxW;
            targetH = Math.round((targetH || 400) * ratio);
          }
          if (targetH > 320) {
            const ratio = 320 / targetH;
            targetH = 320;
            targetW = Math.round(targetW * ratio);
          }

          mainCardChildren.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new ImageRun({
                  data: imgData.buffer,
                  transformation: {
                    width: targetW,
                    height: targetH
                  },
                  type: 'png'
                })
              ],
              spacing: { before: 100, after: 60 }
            })
          );

          mainCardChildren.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({
                  text: img.caption || img.name || `Illustration ${idx + 1}`,
                  bold: true,
                  size: 18,
                  color: "3F3F46",
                  font: "Calibri"
                })
              ],
              spacing: { after: 160 }
            })
          );
        }
      }
    }

    childrenElements.push(
      createJournalCardTable({
        borderColor: "E4E4E7",
        fillColor: "FFFFFF",
        padding: { top: 220, bottom: 220, left: 240, right: 240 },
        children: mainCardChildren
      })
    );
    childrenElements.push(new Paragraph({ spacing: { after: 200 } }));

    // =========================================================================
    // DIVIDER : ENCYCLOPÉDIE & RÉFÉRENCES
    // =========================================================================
    const hasEncyclopediaSections =
      (processed.scriptureItems && processed.scriptureItems.length > 0) ||
      (processed.churchAgeItems && processed.churchAgeItems.length > 0) ||
      (processed.teachingItems && processed.teachingItems.length > 0) ||
      (processed.aiItems && processed.aiItems.length > 0) ||
      (processed.strongItems && processed.strongItems.length > 0) ||
      (processed.definitionItems && processed.definitionItems.length > 0) ||
      processed.sources.length > 0;

    if (hasEncyclopediaSections) {
      childrenElements.push(
        new Paragraph({
          children: [
            new TextRun({
              text: "ENCYCLOPÉDIE & RÉFÉRENCES",
              bold: true,
              size: 17,
              color: "A1A1AA",
              font: "Arial"
            })
          ],
          border: {
            bottom: { style: BorderStyle.SINGLE, size: 6, color: "E4E4E7", space: 4 }
          },
          spacing: { before: 120, after: 220 }
        })
      );
    }

    // =========================================================================
    // 2. SECTION CITATIONS BIBLIQUES
    // =========================================================================
    if (processed.scriptureItems && processed.scriptureItems.length > 0) {
      const scriptureIcon = createIconRun(scriptureIconBytes, 16);
      childrenElements.push(
        new Paragraph({
          children: [
            ...(scriptureIcon ? [scriptureIcon, new TextRun({ text: "  " })] : []),
            new TextRun({
              text: "CITATIONS BIBLIQUES",
              bold: true,
              size: 20,
              color: tealAccent,
              font: "Arial"
            })
          ],
          spacing: { before: 240, after: 140 }
        })
      );

      for (const item of processed.scriptureItems) {
        if (item.kind === 'separator') {
          childrenElements.push(
            ...createSeparatorBlocks(
              item.separatorType,
              item.text,
              'teal',
              typeTealBytes || scriptureIconBytes,
              commentTealBytes || noteIconBytes
            )
          );
        } else {
          const cardQuoteIcon = createIconRun(quoteTealBytes || teachingIconBytes, 14);
          const quoteCard = createJournalCardTable({
            borderColor: "CCFBF1",
            leftAccentColor: tealAccent,
            fillColor: "FFFFFF",
            children: [
              // Barre d'en-tête séparée au-dessus du texte (identique au Journal)
              new Paragraph({
                children: [
                  ...(cardQuoteIcon ? [cardQuoteIcon, new TextRun({ text: "  " })] : []),
                  new TextRun({
                    text: stripMarkdown(item.reference || 'Bible'),
                    bold: true,
                    size: 19,
                    color: primaryColor,
                    font: "Arial"
                  }),
                  ...(item.sourceIndex ? [
                    new TextRun({
                      text: `   [${item.sourceIndex}]`,
                      bold: true,
                      size: 18,
                      color: tealAccent,
                      font: "Arial"
                    })
                  ] : [])
                ],
                border: {
                  bottom: { style: BorderStyle.SINGLE, size: 4, color: "F4F4F5", space: 6 }
                },
                spacing: { before: 20, after: 120 }
              }),
              // Texte de la citation
              new Paragraph({
                children: createDocxQuoteRuns(item.quote, item.highlights),
                spacing: { before: 40, after: 40, line: 276 }
              })
            ]
          });

          childrenElements.push(quoteCard);
          childrenElements.push(new Paragraph({ spacing: { after: 140 } }));
        }
      }
    }

    // =========================================================================
    // 3. SECTION CITATIONS DE L'EXPOSÉ DES SEPT ÂGES
    // =========================================================================
    if (processed.churchAgeItems && processed.churchAgeItems.length > 0) {
      const churchAgeIcon = createIconRun(scrollAmberBytes || churchAgeIconBytes, 16);
      childrenElements.push(
        new Paragraph({
          children: [
            ...(churchAgeIcon ? [churchAgeIcon, new TextRun({ text: "  " })] : []),
            new TextRun({
              text: "CITATIONS DE L'EXPOSÉ DES SEPT ÂGES",
              bold: true,
              size: 20,
              color: amberAccent,
              font: "Arial"
            })
          ],
          spacing: { before: 280, after: 140 }
        })
      );

      for (const item of processed.churchAgeItems) {
        if (item.kind === 'separator') {
          childrenElements.push(
            ...createSeparatorBlocks(
              item.separatorType,
              item.text,
              'amber',
              typeAmberBytes || churchAgeIconBytes,
              commentAmberBytes || churchAgeIconBytes
            )
          );
        } else {
          const cardScrollIcon = createIconRun(scrollAmberBytes || churchAgeIconBytes, 14);
          const quoteCard = createJournalCardTable({
            borderColor: "FDE68A",
            leftAccentColor: amberAccent,
            fillColor: "FFFFFF",
            children: [
              // Barre d'en-tête séparée au-dessus du texte
              new Paragraph({
                children: [
                  ...(cardScrollIcon ? [cardScrollIcon, new TextRun({ text: "  " })] : []),
                  new TextRun({
                    text: stripMarkdown(item.sourceTitle || "Exposé des Sept Âges"),
                    bold: true,
                    size: 19,
                    color: amberColor,
                    font: "Arial"
                  }),
                  ...(item.sourceMeta ? [
                    new TextRun({
                      text: ` — ${stripMarkdown(item.sourceMeta)}`,
                      size: 18,
                      color: mutedColor,
                      font: "Calibri"
                    })
                  ] : []),
                  ...(item.sourceIndex ? [
                    new TextRun({
                      text: `   [${item.sourceIndex}]`,
                      bold: true,
                      size: 18,
                      color: amberAccent,
                      font: "Arial"
                    })
                  ] : [])
                ],
                border: {
                  bottom: { style: BorderStyle.SINGLE, size: 4, color: "F4F4F5", space: 6 }
                },
                spacing: { before: 20, after: 120 }
              }),
              // Texte de la citation
              new Paragraph({
                children: createDocxQuoteRuns(item.quote, item.highlights),
                spacing: { before: 40, after: 40, line: 276 }
              })
            ]
          });

          childrenElements.push(quoteCard);
          childrenElements.push(new Paragraph({ spacing: { after: 140 } }));
        }
      }
    }

    // =========================================================================
    // 4. SECTION CITATIONS D'ENSEIGNEMENTS
    // =========================================================================
    if (processed.teachingItems && processed.teachingItems.length > 0) {
      const teachingIcon = createIconRun(quoteTealBytes || teachingIconBytes, 16);
      childrenElements.push(
        new Paragraph({
          children: [
            ...(teachingIcon ? [teachingIcon, new TextRun({ text: "  " })] : []),
            new TextRun({
              text: "CITATIONS D'ENSEIGNEMENTS",
              bold: true,
              size: 20,
              color: tealAccent,
              font: "Arial"
            })
          ],
          spacing: { before: 280, after: 140 }
        })
      );

      for (const item of processed.teachingItems) {
        if (item.kind === 'separator') {
          childrenElements.push(
            ...createSeparatorBlocks(
              item.separatorType,
              item.text,
              'teal',
              typeTealBytes || teachingIconBytes,
              commentTealBytes || teachingIconBytes
            )
          );
        } else {
          const cardTeachIcon = createIconRun(quoteTealBytes || teachingIconBytes, 14);
          const quoteCard = createJournalCardTable({
            borderColor: "E4E4E7",
            leftAccentColor: tealAccent,
            fillColor: "FFFFFF",
            children: [
              // Barre d'en-tête séparée au-dessus du texte
              new Paragraph({
                children: [
                  ...(cardTeachIcon ? [cardTeachIcon, new TextRun({ text: "  " })] : []),
                  new TextRun({
                    text: stripMarkdown(item.sourceTitle || 'Prédication'),
                    bold: true,
                    size: 19,
                    color: primaryColor,
                    font: "Arial"
                  }),
                  ...(item.sourceMeta ? [
                    new TextRun({
                      text: ` — ${stripMarkdown(item.sourceMeta)}`,
                      size: 18,
                      color: mutedColor,
                      font: "Calibri"
                    })
                  ] : []),
                  ...(item.sourceIndex ? [
                    new TextRun({
                      text: `   [${item.sourceIndex}]`,
                      bold: true,
                      size: 18,
                      color: tealAccent,
                      font: "Arial"
                    })
                  ] : [])
                ],
                border: {
                  bottom: { style: BorderStyle.SINGLE, size: 4, color: "F4F4F5", space: 6 }
                },
                spacing: { before: 20, after: 120 }
              }),
              // Texte de la citation
              new Paragraph({
                children: createDocxQuoteRuns(item.quote, item.highlights),
                spacing: { before: 40, after: 40, line: 276 }
              })
            ]
          });

          childrenElements.push(quoteCard);
          childrenElements.push(new Paragraph({ spacing: { after: 140 } }));
        }
      }
    }

    // =========================================================================
    // 5. SECTION ÉTUDES & RÉPONSES DU DOCK IA
    // =========================================================================
    if (processed.aiItems && processed.aiItems.length > 0) {
      const sectionAiIcon = createIconRun(aiIconBytes, 16);
      const aiCount = processed.aiItems.length;
      childrenElements.push(
        new Paragraph({
          children: [
            ...(sectionAiIcon ? [sectionAiIcon, new TextRun({ text: "  " })] : []),
            new TextRun({
              text: `ÉTUDES & RÉPONSES DU DOCK IA (${aiCount})`,
              bold: true,
              size: 20,
              color: tealAccent,
              font: "Arial"
            })
          ],
          spacing: { before: 280, after: 140 }
        })
      );

      for (const item of processed.aiItems) {
        const cardAiBadge = createIconRun(aiBadgeBytes || aiIconBytes, 22);
        const bodyParagraphs = renderMarkdownBlockToDocx(item.content, tealAccent, false);

        const aiCardChildren: Paragraph[] = [
          // Ligne supérieure : Badge IA + Assistant IA + Date + [sourceIndex]
          new Paragraph({
            children: [
              ...(cardAiBadge ? [cardAiBadge, new TextRun({ text: "  " })] : []),
              new TextRun({
                text: "ASSISTANT IA",
                bold: true,
                size: 17,
                color: tealAccent,
                font: "Arial"
              }),
              ...(item.date ? [
                new TextRun({
                  text: `  (${item.date})`,
                  size: 17,
                  color: mutedColor,
                  font: "Consolas"
                })
              ] : []),
              ...(item.sourceIndex ? [
                new TextRun({
                  text: `  [${item.sourceIndex}]`,
                  bold: true,
                  size: 17,
                  color: primaryColor,
                  font: "Arial"
                })
              ] : [])
            ],
            spacing: { before: 20, after: 40 }
          }),
          // Titre complet de l'étude IA
          new Paragraph({
            children: [
              new TextRun({
                text: stripMarkdown(item.title),
                bold: true,
                size: 22,
                color: "18181B",
                font: "Arial"
              })
            ],
            border: {
              bottom: { style: BorderStyle.SINGLE, size: 6, color: "E4E4E7", space: 8 }
            },
            spacing: { after: 140 }
          }),
          // Contenu riche de l'étude IA (strictement contenu dans la carte Table)
          ...bodyParagraphs
        ];

        const aiCard = createJournalCardTable({
          borderColor: "99F6E4",
          leftAccentColor: tealAccent,
          fillColor: "FFFFFF",
          children: aiCardChildren
        });

        childrenElements.push(aiCard);
        childrenElements.push(new Paragraph({ spacing: { after: 160 } }));
      }
    }

    // =========================================================================
    // 6. SECTION CONCORDANCE & EXÉGÈSE STRONG
    // =========================================================================
    if (processed.strongItems && processed.strongItems.length > 0) {
      const strongIcon = createIconRun(strongIconBytes, 16);
      childrenElements.push(
        new Paragraph({
          children: [
            ...(strongIcon ? [strongIcon, new TextRun({ text: "  " })] : []),
            new TextRun({
              text: `CONCORDANCE & EXÉGÈSE STRONG (${processed.strongItems.length})`,
              bold: true,
              size: 20,
              color: tealAccent,
              font: "Arial"
            })
          ],
          spacing: { before: 280, after: 140 }
        })
      );

      for (const item of processed.strongItems) {
        const strongChildren: (Paragraph | Table)[] = [];
        const cardStrongBadge = createIconRun(strongBadgeBytes || strongIconBytes, 22);
        const infoIcon = createIconRun(infoTealBytes || strongIconBytes, 13);
        const flameIcon = createIconRun(flameTealBytes || aiIconBytes, 13);
        const verseIcon = createIconRun(scriptureIconBytes, 13);

        // Ligne supérieure : Badge Strong + Exégèse Strong • Hébreu/Grec + [sourceIndex]
        strongChildren.push(
          new Paragraph({
            children: [
              ...(cardStrongBadge ? [cardStrongBadge, new TextRun({ text: "  " })] : []),
              new TextRun({
                text: `STRONG ${item.strongNumber}`,
                bold: true,
                size: 18,
                color: primaryColor,
                font: "Consolas"
              }),
              new TextRun({
                text: `   •   EXÉGÈSE STRONG   •   ${item.type === 'hebrew' ? 'Hébreu' : 'Grec'}`,
                bold: true,
                size: 17,
                color: tealAccent,
                font: "Arial"
              }),
              ...(item.sourceIndex ? [
                new TextRun({
                  text: `   [${item.sourceIndex}]`,
                  bold: true,
                  size: 17,
                  color: mutedColor,
                  font: "Arial"
                })
              ] : [])
            ],
            spacing: { before: 20, after: 40 }
          })
        );

        // Mot + Original + Prononciation
        strongChildren.push(
          new Paragraph({
            children: [
              new TextRun({
                text: stripMarkdown(item.word),
                bold: true,
                size: 24,
                color: "18181B",
                font: "Arial"
              }),
              ...(item.original ? [
                new TextRun({
                  text: `  (${stripMarkdown(item.original)})`,
                  bold: true,
                  size: 21,
                  color: primaryColor,
                  font: "Calibri"
                })
              ] : []),
              ...(item.pronunciation ? [
                new TextRun({
                  text: `   [${stripMarkdown(item.pronunciation)}]`,
                  size: 19,
                  color: mutedColor,
                  font: "Consolas"
                })
              ] : [])
            ],
            border: {
              bottom: { style: BorderStyle.SINGLE, size: 6, color: "F4F4F5", space: 8 }
            },
            spacing: { after: 120 }
          })
        );

        // Grille des Métadonnées (Nature, Racine / Origine, Traductions LSG, Fréquence)
        if (item.partOfSpeech || item.etymology || item.translationsLSG || item.occurrencesCountStr) {
          const metaParas: Paragraph[] = [];
          if (item.partOfSpeech) {
            metaParas.push(
              new Paragraph({
                children: [
                  new TextRun({ text: "NATURE : ", bold: true, size: 17, color: tealAccent, font: "Arial" }),
                  new TextRun({ text: stripMarkdown(item.partOfSpeech), size: 19, color: "27272A", font: "Calibri" })
                ],
                spacing: { after: 40 }
              })
            );
          }
          if (item.etymology) {
            metaParas.push(
              new Paragraph({
                children: [
                  new TextRun({ text: "RACINE / ORIGINE : ", bold: true, size: 17, color: tealAccent, font: "Arial" }),
                  new TextRun({ text: stripMarkdown(item.etymology), size: 19, color: "27272A", font: "Calibri" })
                ],
                spacing: { after: 40 }
              })
            );
          }
          if (item.translationsLSG) {
            metaParas.push(
              new Paragraph({
                children: [
                  new TextRun({ text: "TRADUCTIONS (LSG) : ", bold: true, size: 17, color: tealAccent, font: "Arial" }),
                  new TextRun({ text: stripMarkdown(item.translationsLSG), size: 19, color: "27272A", font: "Calibri" })
                ],
                spacing: { after: 40 }
              })
            );
          }
          if (item.occurrencesCountStr) {
            metaParas.push(
              new Paragraph({
                children: [
                  new TextRun({ text: "FRÉQUENCE : ", bold: true, size: 17, color: tealAccent, font: "Arial" }),
                  new TextRun({ text: stripMarkdown(item.occurrencesCountStr), size: 19, color: "27272A", font: "Calibri" })
                ],
                spacing: { after: 20 }
              })
            );
          }

          const innerWidth = CARD_WIDTH_DXA - 480;
          strongChildren.push(
            new Table({
              layout: TableLayoutType.FIXED,
              width: { size: innerWidth, type: WidthType.DXA },
              columnWidths: [innerWidth],
              rows: [
                new TableRow({
                  children: [
                    new TableCell({
                      width: { size: innerWidth, type: WidthType.DXA },
                      children: metaParas,
                      shading: { type: ShadingType.CLEAR, fill: "F8FAFC", color: "auto" },
                      borders: {
                        top: { style: BorderStyle.SINGLE, size: 6, color: "E2E8F0" },
                        right: { style: BorderStyle.SINGLE, size: 6, color: "E2E8F0" },
                        bottom: { style: BorderStyle.SINGLE, size: 6, color: "E2E8F0" },
                        left: { style: BorderStyle.SINGLE, size: 6, color: "E2E8F0" }
                      },
                      margins: { top: 100, bottom: 100, left: 150, right: 150 }
                    })
                  ]
                })
              ]
            })
          );
        }

        // Définition Littérale (avec icône Info)
        strongChildren.push(
          new Paragraph({
            children: [
              ...(infoIcon ? [infoIcon, new TextRun({ text: "  " })] : []),
              new TextRun({
                text: "DÉFINITION LITTÉRALE",
                bold: true,
                size: 17,
                color: mutedColor,
                font: "Arial"
              })
            ],
            spacing: { before: 120, after: 60 }
          })
        );

        const defParagraphs = item.definition.split('\n').filter(Boolean);
        for (const dLine of defParagraphs) {
          strongChildren.push(
            new Paragraph({
              children: parseInlineRuns(dLine, { size: 20, color: "27272A", font: "Georgia" }),
              border: {
                left: { style: BorderStyle.SINGLE, size: 18, color: tealAccent, space: 8 }
              },
              shading: { type: ShadingType.CLEAR, fill: "F8FAFC", color: "auto" },
              indent: { left: 160 },
              spacing: { before: 40, after: 60, line: 270 }
            })
          );
        }

        // Éclairage dans le Message du Temps de la Fin (avec icône Flame)
        if (item.messageContext) {
          strongChildren.push(
            new Paragraph({
              children: [
                ...(flameIcon ? [flameIcon, new TextRun({ text: "  " })] : []),
                new TextRun({
                  text: "ÉCLAIRAGE DANS LE MESSAGE DU TEMPS DE LA FIN",
                  bold: true,
                  size: 17,
                  color: tealAccent,
                  font: "Arial"
                })
              ],
              spacing: { before: 120, after: 60 }
            })
          );

          const msgParagraphs = item.messageContext.split('\n').filter(Boolean);
          for (const mLine of msgParagraphs) {
            strongChildren.push(
              new Paragraph({
                children: parseInlineRuns(mLine, { size: 20, color: "18181B", font: "Georgia", italics: true }),
                border: {
                  left: { style: BorderStyle.SINGLE, size: 18, color: "14B8A6", space: 8 }
                },
                shading: { type: ShadingType.CLEAR, fill: "F0FDFA", color: "auto" },
                indent: { left: 160 },
                spacing: { before: 40, after: 60, line: 270 }
              })
            );
          }
        }

        // Verset d'Origine (avec icône BookOpen)
        if (item.originVerseRef && item.originVerseText) {
          strongChildren.push(
            new Paragraph({
              children: [
                ...(verseIcon ? [verseIcon, new TextRun({ text: "  " })] : []),
                new TextRun({
                  text: `VERSET D'ORIGINE — ${item.originVerseRef}`,
                  bold: true,
                  size: 17,
                  color: primaryColor,
                  font: "Arial"
                })
              ],
              spacing: { before: 120, after: 60 }
            })
          );

          strongChildren.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: `« ${stripMarkdown(item.originVerseText)} »`,
                  italics: true,
                  size: 20,
                  color: "27272A",
                  font: "Georgia"
                })
              ],
              shading: { type: ShadingType.CLEAR, fill: "F8FAFC", color: "auto" },
              border: {
                left: { style: BorderStyle.SINGLE, size: 12, color: "CBD5E1", space: 8 }
              },
              indent: { left: 160 },
              spacing: { before: 40, after: 60, line: 270 }
            })
          );
        }

        // Autres occurrences
        if (item.allOccurrences && item.allOccurrences.length > 1) {
          strongChildren.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: `(+ ${item.allOccurrences.length - 1} autre${item.allOccurrences.length - 1 > 1 ? 's' : ''} verset${item.allOccurrences.length - 1 > 1 ? 's' : ''} répertorié${item.allOccurrences.length - 1 > 1 ? 's' : ''} dans les Écritures — ${item.allOccurrences.length} occurrences totales)`,
                  italics: true,
                  size: 18,
                  color: mutedColor,
                  font: "Calibri"
                })
              ],
              spacing: { before: 60, after: 20 }
            })
          );
        }

        const strongCard = createJournalCardTable({
          borderColor: "E4E4E7",
          leftAccentColor: primaryColor,
          fillColor: "FFFFFF",
          children: strongChildren
        });

        childrenElements.push(strongCard);
        childrenElements.push(new Paragraph({ spacing: { after: 160 } }));
      }
    }

    // =========================================================================
    // 7. SECTION DICTIONNAIRE & LEXIQUE BIBLIQUE
    // =========================================================================
    if (processed.definitionItems && processed.definitionItems.length > 0) {
      const defIcon = createIconRun(defIconBytes, 16);
      childrenElements.push(
        new Paragraph({
          children: [
            ...(defIcon ? [defIcon, new TextRun({ text: "  " })] : []),
            new TextRun({
              text: `DICTIONNAIRE & LEXIQUE BIBLIQUE (${processed.definitionItems.length})`,
              bold: true,
              size: 20,
              color: tealAccent,
              font: "Arial"
            })
          ],
          spacing: { before: 280, after: 140 }
        })
      );

      for (const item of processed.definitionItems) {
        const defChildren: Paragraph[] = [];
        const cardDefBadge = createIconRun(defBadgeBytes || defIconBytes, 22);
        const historyIcon = createIconRun(historyTealBytes || defIconBytes, 13);

        // En-tête de la carte Définition (Badge + Label + Mot vedette)
        defChildren.push(
          new Paragraph({
            children: [
              ...(cardDefBadge ? [cardDefBadge, new TextRun({ text: "  " })] : []),
              new TextRun({
                text: "DICTIONNAIRE BIBLIQUE & THÉOLOGIQUE",
                bold: true,
                size: 16,
                color: tealAccent,
                font: "Arial"
              }),
              ...(item.sourceIndex ? [
                new TextRun({
                  text: `   [${item.sourceIndex}]`,
                  bold: true,
                  size: 17,
                  color: primaryColor,
                  font: "Arial"
                })
              ] : [])
            ],
            spacing: { before: 20, after: 40 }
          })
        );

        defChildren.push(
          new Paragraph({
            children: [
              new TextRun({
                text: stripMarkdown(item.word).toUpperCase(),
                bold: true,
                size: 24,
                color: "18181B",
                font: "Arial"
              })
            ],
            border: {
              bottom: { style: BorderStyle.SINGLE, size: 6, color: "F4F4F5", space: 8 }
            },
            spacing: { after: 120 }
          })
        );

        // Corps de la définition
        const defLines = item.definition.split('\n').filter(Boolean);
        for (const dLine of defLines) {
          defChildren.push(
            new Paragraph({
              children: parseInlineRuns(dLine, { size: 21, color: "27272A", font: "Georgia" }),
              spacing: { before: 30, after: 60, line: 276 }
            })
          );
        }

        // Étymologie (avec icône History)
        if (item.etymology) {
          defChildren.push(
            new Paragraph({
              children: [
                ...(historyIcon ? [historyIcon, new TextRun({ text: "  " })] : []),
                new TextRun({
                  text: "Étymologie : ",
                  bold: true,
                  size: 19,
                  color: "3F3F46",
                  font: "Calibri"
                }),
                new TextRun({
                  text: stripMarkdown(item.etymology),
                  size: 19,
                  color: "52525B",
                  font: "Calibri"
                })
              ],
              shading: { type: ShadingType.CLEAR, fill: "FAFAFA", color: "auto" },
              border: {
                left: { style: BorderStyle.SINGLE, size: 12, color: tealAccent, space: 8 }
              },
              indent: { left: 140 },
              spacing: { before: 80, after: 60, line: 250 }
            })
          );
        }

        // Synonymes
        if (item.synonyms && item.synonyms.length > 0) {
          defChildren.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: "SYNONYMES :  ",
                  bold: true,
                  size: 17,
                  color: "A1A1AA",
                  font: "Arial"
                }),
                new TextRun({
                  text: item.synonyms.map(s => stripMarkdown(s)).join('  •  '),
                  bold: true,
                  size: 19,
                  color: primaryColor,
                  font: "Calibri"
                })
              ],
              border: {
                top: { style: BorderStyle.SINGLE, size: 4, color: "F4F4F5", space: 6 }
              },
              spacing: { before: 80, after: 20 }
            })
          );
        }

        const defCard = createJournalCardTable({
          borderColor: "E4E4E7",
          leftAccentColor: tealAccent,
          fillColor: "FFFFFF",
          children: defChildren
        });

        childrenElements.push(defCard);
        childrenElements.push(new Paragraph({ spacing: { after: 160 } }));
      }
    }

    // =========================================================================
    // 8. SECTION SOURCES & RÉFÉRENCES (BIBLIOGRAPHIE)
    // =========================================================================
    if (processed.sources.length > 0) {
      const sourcesIcon = createIconRun(sourcesIconBytes, 16);
      childrenElements.push(
        new Paragraph({
          children: [
            ...(sourcesIcon ? [sourcesIcon, new TextRun({ text: "  " })] : []),
            new TextRun({
              text: `SOURCES & RÉFÉRENCES (${processed.sources.length})`,
              bold: true,
              size: 20,
              color: "27272A",
              font: "Arial"
            })
          ],
          spacing: { before: 300, after: 140 }
        })
      );

      const sourceParagraphs: Paragraph[] = processed.sources.map((src, idx) =>
        new Paragraph({
          children: [
            new TextRun({
              text: `[${src.index}]  `,
              bold: true,
              size: 19,
              color: tealAccent,
              font: "Consolas"
            }),
            new TextRun({
              text: stripMarkdown(src.formattedLine),
              size: 19,
              color: "27272A",
              font: "Calibri"
            })
          ],
          border: idx < processed.sources.length - 1
            ? { bottom: { style: BorderStyle.SINGLE, size: 4, color: "F4F4F5", space: 6 } }
            : undefined,
          spacing: { before: 60, after: 80, line: 250 }
        })
      );

      childrenElements.push(
        createJournalCardTable({
          borderColor: "E4E4E7",
          fillColor: "FFFFFF",
          children: sourceParagraphs
        })
      );
    }

    // Build complete docx document with explicit A4 page dimensions & safe margins
    const doc = new Document({
      sections: [
        {
          properties: {
            page: {
              size: {
                width: PAGE_WIDTH_DXA,
                height: PAGE_HEIGHT_DXA
              },
              margin: {
                top: PAGE_MARGIN_Y_DXA,
                bottom: PAGE_MARGIN_Y_DXA,
                left: PAGE_MARGIN_X_DXA,
                right: PAGE_MARGIN_X_DXA
              }
            }
          },
          headers: {
            default: new Header({
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: `King's Sword — ${stripMarkdown(processed.title)}`,
                      size: 16,
                      color: "94A3B8",
                      font: "Calibri"
                    })
                  ],
                  alignment: AlignmentType.RIGHT
                })
              ]
            })
          },
          footers: {
            default: new Footer({
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({
                      text: "Page ",
                      size: 18,
                      color: "94A3B8",
                      font: "Calibri"
                    }),
                    new TextRun({
                      children: [PageNumber.CURRENT],
                      size: 18,
                      color: "94A3B8",
                      font: "Calibri"
                    }),
                    new TextRun({
                      text: " sur ",
                      size: 18,
                      color: "94A3B8",
                      font: "Calibri"
                    }),
                    new TextRun({
                      children: [PageNumber.TOTAL_PAGES],
                      size: 18,
                      color: "94A3B8",
                      font: "Calibri"
                    })
                  ]
                })
              ]
            })
          },
          children: childrenElements
        }
      ]
    });

    const blob = await Packer.toBlob(doc);
    const safeFilename = `${(processed.title || 'note').toLowerCase().replace(/[^a-z0-9]/gi, '_')}.docx`;
    saveAs(blob, safeFilename);

    return true;
  } catch (error) {
    console.error("Error exporting to docx:", error);
    return false;
  }
}
