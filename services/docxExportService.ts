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
import { Note } from '../types';
import { processNoteData } from '../utils/noteFormatter';

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
            text: "  |  DOCUMENT D'ÉTUDE & NOTES CHRONIQUES",
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

    // Note Title
    childrenElements.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.LEFT,
        spacing: { before: 120, after: 180 },
        children: [
          new TextRun({
            text: processed.title,
            bold: true,
            size: 36, // 18pt
            color: "0F172A",
            font: "Georgia"
          })
        ]
      })
    );

    // Metadata Bar
    const formattedDate = note.date 
      ? new Date(note.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
      : new Date().toLocaleDateString('fr-FR');

    const metaInfoParts = [`Date: ${formattedDate}`];
    if (processed.sources.length > 0) {
      metaInfoParts.push(`Sources référencées: ${processed.sources.length}`);
    }
    if (note.images && note.images.length > 0) {
      metaInfoParts.push(`Images jointes: ${note.images.length}`);
    }

    childrenElements.push(
      new Paragraph({
        children: [
          new TextRun({
            text: metaInfoParts.join("   •   "),
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
        childrenElements.push(
          new Paragraph({
            children: [
              new TextRun({
                text: pText,
                size: 22, // 11pt
                color: "1E293B",
                font: "Calibri"
              })
            ],
            spacing: { after: 160, line: 280 }
          })
        );
      }
    }

    // 2. SECTION CITATIONS BIBLIQUES
    if (processed.scriptureCitations.length > 0) {
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

      for (const sc of processed.scriptureCitations) {
        const quoteTable = new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  children: [
                    new Paragraph({
                      children: [
                        new TextRun({
                          text: `« ${sc.quote} »`,
                          italics: true,
                          size: 21,
                          color: "334155",
                          font: "Georgia"
                        })
                      ],
                      spacing: { before: 120, after: 120, line: 260 }
                    }),
                    new Paragraph({
                      alignment: AlignmentType.RIGHT,
                      children: [
                        new TextRun({
                          text: `${sc.reference}${sc.sourceIndex ? ` [${sc.sourceIndex}]` : ''}`,
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

    // 3. SECTION CITATIONS & ENSEIGNEMENTS
    if (processed.teachingCitations.length > 0) {
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

      for (const tc of processed.teachingCitations) {
        const quoteTable = new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  children: [
                    new Paragraph({
                      children: [
                        new TextRun({
                          text: `« ${tc.quote} »`,
                          italics: true,
                          size: 21,
                          color: "334155",
                          font: "Georgia"
                        })
                      ],
                      spacing: { before: 120, after: 120, line: 260 }
                    }),
                    new Paragraph({
                      alignment: AlignmentType.RIGHT,
                      children: [
                        new TextRun({
                          text: `${tc.sourceTitle}${tc.sourceMeta ? ` — ${tc.sourceMeta}` : ''}${tc.sourceIndex ? ` [${tc.sourceIndex}]` : ''}`,
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
              text: "SOURCES & RÉFÉRENCES",
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
                      text: "King's Sword — Document d'Étude",
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
