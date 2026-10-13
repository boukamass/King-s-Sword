import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
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
  Header
} from 'docx';
import saveAs from 'file-saver';
import { Note, CitationHighlight } from '../types';
import { processNoteData, stripMarkdown } from '../utils/noteFormatter';
import { splitQuoteIntoHighlightedSegments, HIGHLIGHT_HEX_MAP } from '../utils/highlightUtils';

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
  // Éradication complète des symboles @ et # résiduels
  const cleaned = text.replace(/@\w+/g, '').replace(/@/g, '').replace(/#+/g, '');

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
          color: baseStyle?.color || "1E293B",
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
          color: baseStyle?.color || "334155",
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
          color: baseStyle?.color || "1E293B",
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
 * en paragraphes Word (.docx) structurés et esthétiques, sans aucun caractère brut # ou @.
 */
function renderMarkdownBlockToDocx(markdownText: string, primaryColor: string = "0F766E"): Paragraph[] {
  if (!markdownText) return [];
  const lines = markdownText.split('\n');
  const paragraphs: Paragraph[] = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine) continue;

    // Titre 1 (# Titre)
    if (/^#\s+/.test(rawLine)) {
      paragraphs.push(
        new Paragraph({
          children: parseInlineRuns(rawLine.replace(/^#\s+/, ''), {
            bold: true,
            size: 24,
            color: primaryColor,
            font: "Arial"
          }),
          spacing: { before: 200, after: 80 }
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
          spacing: { before: 180, after: 60 }
        })
      );
    }
    // Titre 3 ou sous-section (### Titre)
    else if (/^#{3,6}\s+/.test(rawLine)) {
      paragraphs.push(
        new Paragraph({
          children: parseInlineRuns(rawLine.replace(/^#{3,6}\s+/, ''), {
            bold: true,
            size: 20,
            color: "334155",
            font: "Arial"
          }),
          spacing: { before: 140, after: 40 }
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
            color: "475569",
            font: "Georgia"
          }),
          indent: { left: 360 },
          spacing: { before: 60, after: 60, line: 240 }
        })
      );
    }
    // Puce de liste (- item ou * item)
    else if (/^[-*]\s+/.test(rawLine)) {
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
            ...parseInlineRuns(rawLine.replace(/^[-*]\s+/, ''), {
              size: 20,
              color: "1E293B",
              font: "Calibri"
            })
          ],
          indent: { left: 280 },
          spacing: { after: 60, line: 240 }
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
                font: "Calibri"
              }),
              ...parseInlineRuns(numMatch[2], {
                size: 20,
                color: "1E293B",
                font: "Calibri"
              })
            ],
            indent: { left: 280 },
            spacing: { after: 60, line: 240 }
          })
        );
      } else {
        paragraphs.push(
          new Paragraph({
            children: parseInlineRuns(rawLine, { size: 21, color: "1E293B", font: "Calibri" }),
            spacing: { after: 120, line: 260 }
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
            color: "1E293B",
            font: "Calibri"
          }),
          spacing: { after: 120, line: 260 }
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
  const cleanQuote = (quote || '').replace(/@\w+/g, '').replace(/@/g, '').replace(/#+/g, '');

  if (!highlights || highlights.length === 0) {
    return [
      new TextRun({
        text: `« ${cleanQuote} »`,
        italics: true,
        size: 21,
        color: "334155",
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
      color: "334155",
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
          color: "1E293B",
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
          color: "334155",
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
      color: "334155",
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
 * Generates and downloads a beautifully formatted Microsoft Word (.docx) document from a Note
 * strictly adhering to professional typography, citation separation and source guidelines.
 */
export async function exportNoteToDocx(note: Note): Promise<boolean> {
  try {
    const primaryColor = "0F766E"; // Deep Teal
    const secondaryColor = "334155"; // Slate Charcoal
    const mutedColor = "64748B"; // Muted Gray
    const lightBg = "F8FAFC"; // Very light neutral

    const processed = processNoteData(note);
    const childrenElements: (Paragraph | Table)[] = [];

    // Header Title Banner
    childrenElements.push(
      new Paragraph({
        children: [
          new TextRun({
            text: "KING'S SWORD",
            bold: true,
            size: 18,
            color: primaryColor,
            font: "Arial",
          }),
          new TextRun({
            text: `  |  ${processed.title}`,
            size: 16,
            color: mutedColor,
            font: "Arial",
          })
        ],
        alignment: AlignmentType.LEFT,
        spacing: { after: 120 }
      })
    );

    // Decorative Horizontal Line / Divider
    childrenElements.push(
      new Paragraph({
        border: {
          bottom: {
            color: primaryColor,
            space: 1,
            style: BorderStyle.SINGLE,
            size: 12,
          }
        },
        spacing: { after: 240 }
      })
    );

    // Metadata Bar (Date uniquement)
    const formattedDate = note.date 
      ? new Date(note.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
      : new Date().toLocaleDateString('fr-FR');

    childrenElements.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `Date : ${formattedDate}`,
            size: 18, // 9pt
            italics: true,
            color: mutedColor,
            font: "Calibri"
          })
        ],
        spacing: { after: 360 }
      })
    );

    // 1. SECTION CONTENU PRINCIPAL
    if (processed.contentParagraphs.length > 0) {
      childrenElements.push(
        new Paragraph({
          children: [
            new TextRun({
              text: "CONTENU PRINCIPAL",
              bold: true,
              size: 20, // 10pt
              color: primaryColor,
              font: "Arial"
            })
          ],
          spacing: { before: 200, after: 120 }
        })
      );

      for (const pText of processed.contentParagraphs) {
        const pElements = renderMarkdownBlockToDocx(pText, primaryColor);
        childrenElements.push(...pElements);
      }
    }

    // 2. SECTION CITATIONS BIBLIQUES
    if (processed.scriptureItems && processed.scriptureItems.length > 0) {
      childrenElements.push(
        new Paragraph({
          children: [
            new TextRun({
              text: "CITATIONS BIBLIQUES",
              bold: true,
              size: 20,
              color: primaryColor,
              font: "Arial"
            })
          ],
          spacing: { before: 360, after: 180 }
        })
      );

      for (const item of processed.scriptureItems) {
        if (item.kind === 'separator') {
          if (item.separatorType === 'subtitle') {
            const subtitleTable = new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: [
                new TableRow({
                  children: [
                    new TableCell({
                      children: [
                        new Paragraph({
                          alignment: AlignmentType.CENTER,
                          children: [
                            new TextRun({
                              text: stripMarkdown(item.text),
                              bold: true,
                              size: 20,
                              color: primaryColor,
                              font: "Arial"
                            })
                          ],
                          spacing: { before: 60, after: 60 }
                        })
                      ],
                      shading: {
                        type: ShadingType.CLEAR,
                        fill: "F0FDFA", // Light Teal tint
                        color: "auto"
                      },
                      borders: {
                        top: { style: BorderStyle.SINGLE, size: 6, color: "99F6E4" },
                        bottom: { style: BorderStyle.SINGLE, size: 6, color: "99F6E4" },
                        left: { style: BorderStyle.NONE },
                        right: { style: BorderStyle.NONE }
                      },
                      margins: { top: 60, bottom: 60, left: 120, right: 120 }
                    })
                  ]
                })
              ]
            });
            childrenElements.push(new Paragraph({ spacing: { before: 180 } }));
            childrenElements.push(subtitleTable);
            childrenElements.push(new Paragraph({ spacing: { after: 140 } }));
          } else {
            // Commentaire / Réflexion séparateur autonome
            const commentTable = new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: [
                new TableRow({
                  children: [
                    new TableCell({
                      children: [
                        new Paragraph({
                          children: [
                            new TextRun({
                              text: "Remarque / Commentaire : ",
                              bold: true,
                              size: 19,
                              color: primaryColor,
                              font: "Calibri"
                            }),
                            new TextRun({
                              text: item.text,
                              italics: true,
                              size: 19,
                              color: "334155",
                              font: "Calibri"
                            })
                          ],
                          spacing: { before: 80, after: 80, line: 260 }
                        })
                      ],
                      shading: {
                        type: ShadingType.CLEAR,
                        fill: "F8FAFC",
                        color: "auto"
                      },
                      borders: {
                        left: {
                          style: BorderStyle.SINGLE,
                          size: 20,
                          color: primaryColor
                        },
                        top: { style: BorderStyle.NONE },
                        right: { style: BorderStyle.NONE },
                        bottom: { style: BorderStyle.NONE }
                      },
                      margins: { top: 100, bottom: 100, left: 160, right: 160 }
                    })
                  ]
                })
              ]
            });
            childrenElements.push(commentTable);
            childrenElements.push(new Paragraph({ spacing: { after: 140 } }));
          }
        } else {
          const quoteTable = new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    children: [
                      new Paragraph({
                        children: createDocxQuoteRuns(item.quote, item.highlights),
                        spacing: { before: 120, after: 120, line: 260 }
                      }),
                      new Paragraph({
                        alignment: AlignmentType.RIGHT,
                        children: [
                          new TextRun({
                            text: `${item.reference || 'Bible'}${item.sourceIndex ? ` [${item.sourceIndex}]` : ''}`,
                            bold: true,
                            size: 19,
                            color: primaryColor,
                            font: "Calibri"
                          })
                        ],
                        spacing: { after: 100 }
                      })
                    ],
                    shading: {
                      type: ShadingType.CLEAR,
                      fill: lightBg,
                      color: "auto"
                    },
                    borders: {
                      left: {
                        style: BorderStyle.SINGLE,
                        size: 24,
                        color: primaryColor
                      },
                      top: { style: BorderStyle.NONE },
                      right: { style: BorderStyle.NONE },
                      bottom: { style: BorderStyle.NONE }
                    },
                    margins: { top: 140, bottom: 140, left: 200, right: 200 }
                  })
                ]
              })
            ]
          });

          childrenElements.push(quoteTable);
          childrenElements.push(new Paragraph({ spacing: { after: 180 } }));
        }
      }
    }

    // 3. SECTION CITATIONS DE L'EXPOSÉ DES SEPT ÂGES
    if (processed.churchAgeItems && processed.churchAgeItems.length > 0) {
      childrenElements.push(
        new Paragraph({
          children: [
            new TextRun({
              text: "CITATIONS DE L'EXPOSÉ DES SEPT ÂGES",
              bold: true,
              size: 20,
              color: primaryColor,
              font: "Arial"
            })
          ],
          spacing: { before: 360, after: 180 }
        })
      );

      for (const item of processed.churchAgeItems) {
        if (item.kind === 'separator') {
          if (item.separatorType === 'subtitle') {
            const subtitleTable = new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: [
                new TableRow({
                  children: [
                    new TableCell({
                      children: [
                        new Paragraph({
                          alignment: AlignmentType.CENTER,
                          children: [
                            new TextRun({
                              text: stripMarkdown(item.text),
                              bold: true,
                              size: 20,
                              color: "B45309", // Warm Amber Dark
                              font: "Arial"
                            })
                          ],
                          spacing: { before: 60, after: 60 }
                        })
                      ],
                      shading: {
                        type: ShadingType.CLEAR,
                        fill: "FFFBEB", // Light Amber tint
                        color: "auto"
                      },
                      borders: {
                        top: { style: BorderStyle.SINGLE, size: 6, color: "FDE68A" },
                        bottom: { style: BorderStyle.SINGLE, size: 6, color: "FDE68A" },
                        left: { style: BorderStyle.NONE },
                        right: { style: BorderStyle.NONE }
                      },
                      margins: { top: 60, bottom: 60, left: 120, right: 120 }
                    })
                  ]
                })
              ]
            });
            childrenElements.push(new Paragraph({ spacing: { before: 180 } }));
            childrenElements.push(subtitleTable);
            childrenElements.push(new Paragraph({ spacing: { after: 140 } }));
          } else {
            const commentTable = new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: [
                new TableRow({
                  children: [
                    new TableCell({
                      children: [
                        new Paragraph({
                          children: [
                            new TextRun({
                              text: "Remarque / Commentaire : ",
                              bold: true,
                              size: 19,
                              color: "B45309",
                              font: "Calibri"
                            }),
                            new TextRun({
                              text: stripMarkdown(item.text),
                              italics: true,
                              size: 19,
                              color: "334155",
                              font: "Calibri"
                            })
                          ],
                          spacing: { before: 80, after: 80, line: 260 }
                        })
                      ],
                      shading: {
                        type: ShadingType.CLEAR,
                        fill: "FEF3C7", // Amber light
                        color: "auto"
                      },
                      borders: {
                        left: {
                          style: BorderStyle.SINGLE,
                          size: 20,
                          color: "D97706"
                        },
                        top: { style: BorderStyle.NONE },
                        right: { style: BorderStyle.NONE },
                        bottom: { style: BorderStyle.NONE }
                      },
                      margins: { top: 100, bottom: 100, left: 160, right: 160 }
                    })
                  ]
                })
              ]
            });
            childrenElements.push(commentTable);
            childrenElements.push(new Paragraph({ spacing: { after: 140 } }));
          }
        } else {
          const quoteTable = new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    children: [
                      new Paragraph({
                        children: createDocxQuoteRuns(item.quote, item.highlights),
                        spacing: { before: 120, after: 120, line: 260 }
                      }),
                      new Paragraph({
                        alignment: AlignmentType.RIGHT,
                        children: [
                          new TextRun({
                            text: `${item.sourceTitle || "Exposé des Sept Âges"}${item.sourceMeta ? ` — ${item.sourceMeta}` : ''}${item.sourceIndex ? ` [${item.sourceIndex}]` : ''}`,
                            bold: true,
                            size: 19,
                            color: primaryColor,
                            font: "Calibri"
                          })
                        ],
                        spacing: { after: 100 }
                      })
                    ],
                    shading: {
                      type: ShadingType.CLEAR,
                      fill: lightBg,
                      color: "auto"
                    },
                    borders: {
                      left: {
                        style: BorderStyle.SINGLE,
                        size: 24,
                        color: primaryColor
                      },
                      top: { style: BorderStyle.NONE },
                      right: { style: BorderStyle.NONE },
                      bottom: { style: BorderStyle.NONE }
                    },
                    margins: { top: 140, bottom: 140, left: 200, right: 200 }
                  })
                ]
              })
            ]
          });

          childrenElements.push(quoteTable);
          childrenElements.push(new Paragraph({ spacing: { after: 180 } }));
        }
      }
    }

    // 4. SECTION CITATIONS & ENSEIGNEMENTS
    if (processed.teachingItems && processed.teachingItems.length > 0) {
      childrenElements.push(
        new Paragraph({
          children: [
            new TextRun({
              text: "CITATIONS & ENSEIGNEMENTS",
              bold: true,
              size: 20,
              color: primaryColor,
              font: "Arial"
            })
          ],
          spacing: { before: 360, after: 180 }
        })
      );

      for (const item of processed.teachingItems) {
        if (item.kind === 'separator') {
          if (item.separatorType === 'subtitle') {
            const subtitleTable = new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: [
                new TableRow({
                  children: [
                    new TableCell({
                      children: [
                        new Paragraph({
                          alignment: AlignmentType.CENTER,
                          children: [
                            new TextRun({
                              text: stripMarkdown(item.text),
                              bold: true,
                              size: 20,
                              color: secondaryColor,
                              font: "Arial"
                            })
                          ],
                          spacing: { before: 60, after: 60 }
                        })
                      ],
                      shading: {
                        type: ShadingType.CLEAR,
                        fill: "F1F5F9", // Slate tint
                        color: "auto"
                      },
                      borders: {
                        top: { style: BorderStyle.SINGLE, size: 6, color: "CBD5E1" },
                        bottom: { style: BorderStyle.SINGLE, size: 6, color: "CBD5E1" },
                        left: { style: BorderStyle.NONE },
                        right: { style: BorderStyle.NONE }
                      },
                      margins: { top: 60, bottom: 60, left: 120, right: 120 }
                    })
                  ]
                })
              ]
            });
            childrenElements.push(new Paragraph({ spacing: { before: 180 } }));
            childrenElements.push(subtitleTable);
            childrenElements.push(new Paragraph({ spacing: { after: 140 } }));
          } else {
            const commentTable = new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: [
                new TableRow({
                  children: [
                    new TableCell({
                      children: [
                        new Paragraph({
                          children: [
                            new TextRun({
                              text: "Remarque / Commentaire : ",
                              bold: true,
                              size: 19,
                              color: primaryColor,
                              font: "Calibri"
                            }),
                            new TextRun({
                              text: stripMarkdown(item.text),
                              italics: true,
                              size: 19,
                              color: "334155",
                              font: "Calibri"
                            })
                          ],
                          spacing: { before: 80, after: 80, line: 260 }
                        })
                      ],
                      shading: {
                        type: ShadingType.CLEAR,
                        fill: "F8FAFC",
                        color: "auto"
                      },
                      borders: {
                        left: {
                          style: BorderStyle.SINGLE,
                          size: 20,
                          color: "94A3B8"
                        },
                        top: { style: BorderStyle.NONE },
                        right: { style: BorderStyle.NONE },
                        bottom: { style: BorderStyle.NONE }
                      },
                      margins: { top: 100, bottom: 100, left: 160, right: 160 }
                    })
                  ]
                })
              ]
            });
            childrenElements.push(commentTable);
            childrenElements.push(new Paragraph({ spacing: { after: 140 } }));
          }
        } else {
          const quoteTable = new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    children: [
                      new Paragraph({
                        children: createDocxQuoteRuns(item.quote, item.highlights),
                        spacing: { before: 120, after: 120, line: 260 }
                      }),
                      new Paragraph({
                        alignment: AlignmentType.RIGHT,
                        children: [
                          new TextRun({
                            text: `${item.sourceTitle || 'Exposé / Enseignement'}${item.sourceMeta ? ` — ${item.sourceMeta}` : ''}${item.sourceIndex ? ` [${item.sourceIndex}]` : ''}`,
                            bold: true,
                            size: 19,
                            color: primaryColor,
                            font: "Calibri"
                          })
                        ],
                        spacing: { after: 100 }
                      })
                    ],
                    shading: {
                      type: ShadingType.CLEAR,
                      fill: lightBg,
                      color: "auto"
                    },
                    borders: {
                      left: {
                        style: BorderStyle.SINGLE,
                        size: 24,
                        color: primaryColor
                      },
                      top: { style: BorderStyle.NONE },
                      right: { style: BorderStyle.NONE },
                      bottom: { style: BorderStyle.NONE }
                    },
                    margins: { top: 140, bottom: 140, left: 200, right: 200 }
                  })
                ]
              })
            ]
          });

          childrenElements.push(quoteTable);
          childrenElements.push(new Paragraph({ spacing: { after: 180 } }));
        }
      }
    }

    // 4. SECTION ÉTUDES & RÉPONSES DU DOCK IA
    if (processed.aiItems && processed.aiItems.length > 0) {
      childrenElements.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `ÉTUDES & RÉPONSES DU DOCK IA (${processed.aiItems.length})`,
              bold: true,
              size: 20,
              color: primaryColor,
              font: "Arial"
            })
          ],
          spacing: { before: 360, after: 180 }
        })
      );

      for (const item of processed.aiItems) {
        const bodyParagraphs = renderMarkdownBlockToDocx(item.content, primaryColor);

        const aiTable = new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  children: [
                    new Paragraph({
                      children: [
                        new TextRun({
                          text: `Assistant IA — ${stripMarkdown(item.title)}${item.date ? ` (${item.date})` : ''}`,
                          bold: true,
                          size: 21,
                          color: primaryColor,
                          font: "Arial"
                        })
                      ],
                      spacing: { before: 80, after: 120 }
                    }),
                    ...bodyParagraphs,
                    new Paragraph({
                      alignment: AlignmentType.RIGHT,
                      children: [
                        new TextRun({
                          text: `Assistant IA King's Sword${item.sourceIndex ? ` [${item.sourceIndex}]` : ''}`,
                          bold: true,
                          size: 18,
                          color: primaryColor,
                          font: "Arial"
                        })
                      ],
                      spacing: { before: 80, after: 60 }
                    })
                  ],
                  shading: {
                    type: ShadingType.CLEAR,
                    fill: "F0FDFA", // Subtle Teal tint
                    color: "auto"
                  },
                  borders: {
                    left: {
                      style: BorderStyle.SINGLE,
                      size: 24,
                      color: primaryColor
                    },
                    top: { style: BorderStyle.NONE },
                    right: { style: BorderStyle.NONE },
                    bottom: { style: BorderStyle.NONE }
                  },
                  margins: { top: 140, bottom: 140, left: 200, right: 200 }
                })
              ]
            })
          ]
        });

        childrenElements.push(aiTable);
        childrenElements.push(new Paragraph({ spacing: { after: 180 } }));
      }
    }

    // 5. SECTION CONCORDANCE & EXÉGÈSE STRONG
    if (processed.strongItems && processed.strongItems.length > 0) {
      childrenElements.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `CONCORDANCE & EXÉGÈSE STRONG (${processed.strongItems.length})`,
              bold: true,
              size: 20,
              color: primaryColor,
              font: "Arial"
            })
          ],
          spacing: { before: 360, after: 180 }
        })
      );

      for (const item of processed.strongItems) {
        const strongChildren: Paragraph[] = [];

        // En-tête de la carte Strong
        strongChildren.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `Strong ${item.strongNumber} : ${stripMarkdown(item.word)} `,
                bold: true,
                size: 21,
                color: "0F172A",
                font: "Arial"
              }),
              ...(item.original ? [
                new TextRun({
                  text: `(${stripMarkdown(item.original)}) `,
                  size: 20,
                  color: primaryColor,
                  font: "Calibri"
                })
              ] : []),
              new TextRun({
                text: `— [${stripMarkdown(item.pronunciation)}] (${item.type === 'hebrew' ? 'Hébreu' : 'Grec'})`,
                size: 19,
                color: mutedColor,
                font: "Calibri"
              })
            ],
            spacing: { before: 60, after: 60 }
          })
        );

        // Métadonnées d'exégèse (Nature, Racine, Traductions LSG, Fréquence)
        const metaRuns: TextRun[] = [];
        if (item.partOfSpeech) {
          metaRuns.push(new TextRun({ text: "Nature : ", bold: true, size: 18, color: primaryColor, font: "Calibri" }));
          metaRuns.push(new TextRun({ text: `${stripMarkdown(item.partOfSpeech)}   `, size: 18, color: "334155", font: "Calibri" }));
        }
        if (item.etymology) {
          metaRuns.push(new TextRun({ text: "Racine : ", bold: true, size: 18, color: primaryColor, font: "Calibri" }));
          metaRuns.push(new TextRun({ text: `${stripMarkdown(item.etymology)}   `, size: 18, color: "334155", font: "Calibri" }));
        }
        if (item.translationsLSG) {
          metaRuns.push(new TextRun({ text: "Traductions LSG : ", bold: true, size: 18, color: primaryColor, font: "Calibri" }));
          metaRuns.push(new TextRun({ text: `${stripMarkdown(item.translationsLSG)}   `, size: 18, color: "334155", font: "Calibri" }));
        }
        if (item.occurrencesCountStr) {
          metaRuns.push(new TextRun({ text: "Fréquence : ", bold: true, size: 18, color: primaryColor, font: "Calibri" }));
          metaRuns.push(new TextRun({ text: `${stripMarkdown(item.occurrencesCountStr)}`, size: 18, color: "334155", font: "Calibri" }));
        }

        if (metaRuns.length > 0) {
          strongChildren.push(
            new Paragraph({
              children: metaRuns,
              spacing: { before: 40, after: 60 }
            })
          );
        }

        // Définition Littérale (paragraphes découpés sans fusion anarchique)
        strongChildren.push(
          new Paragraph({
            children: [
              new TextRun({
                text: "Définition Littérale :",
                bold: true,
                size: 19,
                color: primaryColor,
                font: "Calibri"
              })
            ],
            spacing: { before: 40, after: 20 }
          })
        );
        const defParagraphs = item.definition.split('\n').filter(Boolean);
        for (const dLine of defParagraphs) {
          strongChildren.push(
            new Paragraph({
              children: parseInlineRuns(dLine, { size: 20, color: "334155", font: "Georgia" }),
              spacing: { after: 40, line: 260 }
            })
          );
        }

        // Éclairage dans le Message (paragraphes découpés avec italique propre)
        if (item.messageContext) {
          strongChildren.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: "Éclairage dans le Message du Temps de la Fin :",
                  bold: true,
                  size: 19,
                  color: primaryColor,
                  font: "Calibri"
                })
              ],
              spacing: { before: 50, after: 20 }
            })
          );
          const msgParagraphs = item.messageContext.split('\n').filter(Boolean);
          for (const mLine of msgParagraphs) {
            strongChildren.push(
              new Paragraph({
                children: parseInlineRuns(mLine, { size: 20, color: "1E293B", font: "Georgia", italics: true }),
                spacing: { after: 40, line: 260 }
              })
            );
          }
        }

        // Verset d'origine
        if (item.originVerseRef && item.originVerseText) {
          strongChildren.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: `Verset d'origine (${item.originVerseRef}) : `,
                  bold: true,
                  size: 19,
                  color: primaryColor,
                  font: "Calibri"
                }),
                new TextRun({
                  text: `« ${stripMarkdown(item.originVerseText)} »`,
                  italics: true,
                  size: 19,
                  color: "475569",
                  font: "Georgia"
                })
              ],
              spacing: { before: 50, after: 40, line: 240 }
            })
          );
        }

        // Autres occurrences
        if (item.allOccurrences && item.allOccurrences.length > 1) {
          strongChildren.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: `(+ ${item.allOccurrences.length - 1} autre${item.allOccurrences.length - 1 > 1 ? 's' : ''} occurrence${item.allOccurrences.length - 1 > 1 ? 's' : ''} répertoriée${item.allOccurrences.length - 1 > 1 ? 's' : ''} dans les Écritures)`,
                  italics: true,
                  size: 17,
                  color: mutedColor,
                  font: "Calibri"
                })
              ],
              spacing: { before: 20, after: 40 }
            })
          );
        }

        // Signature / Source
        strongChildren.push(
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({
                text: `Concordance Strong${item.sourceIndex ? ` [${item.sourceIndex}]` : ''}`,
                bold: true,
                size: 18,
                color: primaryColor,
                font: "Arial"
              })
            ],
            spacing: { before: 60, after: 60 }
          })
        );

        const strongTable = new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  children: strongChildren,
                  shading: {
                    type: ShadingType.CLEAR,
                    fill: "F8FAFC",
                    color: "auto"
                  },
                  borders: {
                    left: {
                      style: BorderStyle.SINGLE,
                      size: 24,
                      color: primaryColor
                    },
                    top: { style: BorderStyle.NONE },
                    right: { style: BorderStyle.NONE },
                    bottom: { style: BorderStyle.NONE }
                  },
                  margins: { top: 140, bottom: 140, left: 200, right: 200 }
                })
              ]
            })
          ]
        });

        childrenElements.push(strongTable);
        childrenElements.push(new Paragraph({ spacing: { after: 180 } }));
      }
    }

    // 6. SECTION DICTIONNAIRE & LEXIQUE BIBLIQUE
    if (processed.definitionItems && processed.definitionItems.length > 0) {
      childrenElements.push(
        new Paragraph({
          children: [
            new TextRun({
              text: "DICTIONNAIRE & LEXIQUE BIBLIQUE",
              bold: true,
              size: 20,
              color: primaryColor,
              font: "Arial"
            })
          ],
          spacing: { before: 360, after: 180 }
        })
      );

      for (const item of processed.definitionItems) {
        const defChildren: Paragraph[] = [];

        // Mot vedette
        defChildren.push(
          new Paragraph({
            children: [
              new TextRun({
                text: stripMarkdown(item.word).toUpperCase(),
                bold: true,
                size: 22,
                color: "0F172A",
                font: "Arial"
              })
            ],
            spacing: { before: 60, after: 60 }
          })
        );

        // Définition multi-lignes
        const defLines = item.definition.split('\n').filter(Boolean);
        for (const dLine of defLines) {
          defChildren.push(
            new Paragraph({
              children: parseInlineRuns(dLine, { size: 21, color: "334155", font: "Georgia" }),
              spacing: { before: 30, after: 40, line: 260 }
            })
          );
        }

        // Étymologie
        if (item.etymology) {
          defChildren.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: "Étymologie : ",
                  bold: true,
                  size: 19,
                  color: primaryColor,
                  font: "Calibri"
                }),
                new TextRun({
                  text: stripMarkdown(item.etymology),
                  italics: true,
                  size: 19,
                  color: "64748B",
                  font: "Georgia"
                })
              ],
              spacing: { before: 40, after: 30 }
            })
          );
        }

        // Synonymes
        if (item.synonyms && item.synonyms.length > 0) {
          defChildren.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: "Synonymes : ",
                  bold: true,
                  size: 19,
                  color: primaryColor,
                  font: "Arial"
                }),
                new TextRun({
                  text: item.synonyms.map(s => stripMarkdown(s)).join(', '),
                  size: 19,
                  color: "1E293B",
                  font: "Calibri"
                })
              ],
              spacing: { before: 30, after: 30 }
            })
          );
        }

        // Signature / Source
        defChildren.push(
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({
                text: `Dictionnaire Biblique${item.sourceIndex ? ` [${item.sourceIndex}]` : ''}`,
                bold: true,
                size: 18,
                color: primaryColor,
                font: "Arial"
              })
            ],
            spacing: { before: 60, after: 60 }
          })
        );

        const defTable = new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  children: defChildren,
                  shading: {
                    type: ShadingType.CLEAR,
                    fill: "F8FAFC",
                    color: "auto"
                  },
                  borders: {
                    left: {
                      style: BorderStyle.SINGLE,
                      size: 24,
                      color: primaryColor
                    },
                    top: { style: BorderStyle.NONE },
                    right: { style: BorderStyle.NONE },
                    bottom: { style: BorderStyle.NONE }
                  },
                  margins: { top: 140, bottom: 140, left: 200, right: 200 }
                })
              ]
            })
          ]
        });

        childrenElements.push(defTable);
        childrenElements.push(new Paragraph({ spacing: { after: 180 } }));
      }
    }

    // 4. SECTION IMAGES
    if (note.images && note.images.length > 0) {
      childrenElements.push(
        new Paragraph({
          children: [
            new TextRun({
              text: "ILLUSTRATIONS & IMAGES ATTACHÉES",
              bold: true,
              size: 20,
              color: primaryColor,
              font: "Arial"
            })
          ],
          spacing: { before: 360, after: 200 }
        })
      );

      for (let idx = 0; idx < note.images.length; idx++) {
        const img = note.images[idx];
        const imgData = await fetchImageForDocx(img.url);

        if (imgData) {
          const maxW = 480;
          let targetW = imgData.width;
          let targetH = imgData.height;

          if (targetW > maxW || targetW === 0) {
            const ratio = maxW / (targetW || 600);
            targetW = maxW;
            targetH = Math.round((targetH || 400) * ratio);
          }

          childrenElements.push(
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
              spacing: { before: 180, after: 80 }
            })
          );

          if (img.caption || img.name) {
            childrenElements.push(
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: `Figure ${idx + 1} : ${img.caption || img.name}`,
                    italics: true,
                    size: 18,
                    color: mutedColor,
                    font: "Calibri"
                  })
                ],
                spacing: { after: 240 }
              })
            );
          } else {
            childrenElements.push(new Paragraph({ spacing: { after: 200 } }));
          }
        }
      }
    }

    // 5. SECTION SOURCES & RÉFÉRENCES (BIBLIOGRAPHIE)
    if (processed.sources.length > 0) {
      childrenElements.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `SOURCES & RÉFÉRENCES (${processed.sources.length})`,
              bold: true,
              size: 20,
              color: primaryColor,
              font: "Arial"
            })
          ],
          spacing: { before: 400, after: 180 }
        })
      );

      for (const src of processed.sources) {
        childrenElements.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `[${src.index}] `,
                bold: true,
                size: 20,
                color: primaryColor,
                font: "Calibri"
              }),
              new TextRun({
                text: src.formattedLine,
                size: 20,
                color: "334155",
                font: "Calibri"
              })
            ],
            spacing: { after: 120, line: 240 }
          })
        );
      }
    }

    // Build complete docx document with header & footer
    const doc = new Document({
      sections: [
        {
          properties: {
            page: {
              margin: {
                top: 1440,
                bottom: 1440,
                left: 1440,
                right: 1440
              }
            }
          },
          headers: {
            default: new Header({
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: `King's Sword — ${processed.title}`,
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
