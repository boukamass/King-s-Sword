import { ProjectionSyncPayload, STORAGE_KEY, requestProjectionCapture } from './projectionService';
import { ProjectedImageMedia } from '../types';
import { useAppStore } from '../store';
import { detectImageMeta } from './imageMediaService';

/**
 * Safely loads an image URL into an HTMLImageElement with CORS handling, Blob fallback, and strict timeout.
 */
export const loadImageForCanvas = (
  url: string,
  timeoutMs: number = 2000
): Promise<HTMLImageElement | null> => {
  return new Promise((resolve) => {
    if (!url) return resolve(null);

    let isDone = false;
    const finish = (result: HTMLImageElement | null) => {
      if (!isDone) {
        isDone = true;
        resolve(result);
      }
    };

    const timer = setTimeout(() => finish(null), timeoutMs);

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      clearTimeout(timer);
      finish(img);
    };
    img.onerror = () => {
      // Fallback: Fetch as Blob to bypass canvas cross-origin taint
      fetch(url)
        .then((res) => {
          if (!res.ok) throw new Error('Fetch failed');
          return res.blob();
        })
        .then((blob) => {
          const objectUrl = URL.createObjectURL(blob);
          const img2 = new Image();
          img2.onload = () => {
            clearTimeout(timer);
            finish(img2);
          };
          img2.onerror = () => {
            clearTimeout(timer);
            finish(null);
          };
          img2.src = objectUrl;
        })
        .catch(() => {
          clearTimeout(timer);
          finish(null);
        });
    };
    img.src = url;
  });
};

let cachedLogoImg: HTMLImageElement | null = null;

const getLogoImage = async (): Promise<HTMLImageElement | null> => {
  if (cachedLogoImg) return cachedLogoImg;
  const baseUrl = import.meta.env.BASE_URL || '/';
  const logoPath = `${baseUrl.endsWith('/') ? baseUrl : baseUrl + '/'}logo.png`;

  const img = (await loadImageForCanvas(logoPath, 800)) || (await loadImageForCanvas('logo.png', 500));
  if (img) cachedLogoImg = img;
  return img;
};

/**
 * Draws an image on a 2D Canvas context using object-cover behavior (fills 100% of canvas with no black bands).
 */
export const drawImageCover = (
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  cw: number,
  ch: number
): void => {
  if (!img || !img.width || !img.height) return;

  const imgRatio = img.width / img.height;
  const canvasRatio = cw / ch;
  let renderW = cw;
  let renderH = ch;
  let offsetX = 0;
  let offsetY = 0;

  if (imgRatio > canvasRatio) {
    renderH = ch;
    renderW = ch * imgRatio;
    offsetX = (cw - renderW) / 2;
  } else {
    renderW = cw;
    renderH = cw / imgRatio;
    offsetY = (ch - renderH) / 2;
  }

  ctx.drawImage(img, offsetX, offsetY, renderW, renderH);
};

/**
 * Draws an image on a 2D Canvas context using object-contain behavior (fits 100% of image inside canvas without cropping).
 */
export const drawImageContain = (
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  cw: number,
  ch: number
): void => {
  if (!img || !img.width || !img.height) return;

  const imgRatio = img.width / img.height;
  const canvasRatio = cw / ch;
  let renderW = cw;
  let renderH = ch;
  let offsetX = 0;
  let offsetY = 0;

  if (imgRatio > canvasRatio) {
    renderW = cw;
    renderH = cw / imgRatio;
    offsetY = (ch - renderH) / 2;
  } else {
    renderH = ch;
    renderW = ch * imgRatio;
    offsetX = (cw - renderW) / 2;
  }

  ctx.drawImage(img, offsetX, offsetY, renderW, renderH);
};

/**
 * Retrieves the current active projection payload from localStorage or state.
 */
export const getActiveProjectionPayload = (): ProjectionSyncPayload => {
  const state = useAppStore.getState();

  try {
    const raw = localStorage.getItem(STORAGE_KEY) || sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ProjectionSyncPayload;
      return {
        ...parsed,
        blackout: state.projectionBlackout,
        projectedImage: state.projectedImage ?? parsed.projectedImage,
        projectionBgImage: state.projectionBgImage ?? parsed.projectionBgImage
      };
    }
  } catch (e) {}

  const activeSermon = state.activeSermon;
  return {
    title: activeSermon?.title || "KING'S SWORD",
    date: activeSermon?.date || '',
    time: activeSermon?.time || '',
    city: activeSermon?.city || '',
    text: '',
    fontSize: 42,
    blackout: state.projectionBlackout,
    theme: state.theme || 'dark',
    highlights: [],
    selectionIndices: [],
    searchResults: [],
    currentResultIndex: -1,
    activeDefinition: null,
    isBible: false,
    projectedImage: state.projectedImage,
    projectionBgImage: state.projectionBgImage
  };
};

/**
 * Helper to wrap text into multiple lines for Canvas context.
 */
const wrapTextLines = (
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] => {
  if (!text) return [];
  const lines: string[] = [];
  const rawParagraphs = text.split(/\r?\n/);

  for (const para of rawParagraphs) {
    const trimmed = para.trim();
    if (!trimmed) {
      lines.push('');
      continue;
    }

    const words = trimmed.split(/\s+/);
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const metrics = ctx.measureText(testLine);

      if (metrics.width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }
  }

  return lines;
};

/**
 * Generates a high-definition 1920x1080 PNG data URL representation of the projected frame.
 */
export const generateProjectionSnapshot = async (
  payload: ProjectionSyncPayload
): Promise<string> => {
  const width = 1920;
  const height = 1080;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Cannot get 2D context for canvas snapshot');

  // 1. Blackout check
  if (payload.blackout) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);
    return canvas.toDataURL('image/png');
  }

  // 2. Fullscreen Projected Image
  if (payload.projectedImage && payload.projectedImage.url) {
    const bgImg = await loadImageForCanvas(payload.projectedImage.url);
    if (bgImg) {
      drawImageCover(ctx, bgImg, width, height);
    } else {
      ctx.fillStyle = '#09090b';
      ctx.fillRect(0, 0, width, height);
    }

    return canvas.toDataURL('image/png');
  }

  // 3. Background Image or Dark Gradient
  if (payload.projectionBgImage && payload.projectionBgImage.url) {
    const bgImg = await loadImageForCanvas(payload.projectionBgImage.url);
    if (bgImg) {
      drawImageCover(ctx, bgImg, width, height);
      // Dark overlay for legibility (matches ProjectionView bg-black/45)
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.fillRect(0, 0, width, height);
    } else {
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, width, height);
    }
  } else {
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, '#09090b');
    grad.addColorStop(0.5, '#18181b');
    grad.addColorStop(1, '#09090b');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  }

  // Load logo image
  const logoImg = await getLogoImage();

  const isSong =
    payload.date === 'Cantique' ||
    payload.time === 'Chant' ||
    Boolean(payload.title && /^\d+\.\s*/.test(payload.title) && payload.date === 'Cantique');

  const rawText = payload.text || '';

  // 4. Header Bar & Text Content OR Idle Screen
  if (rawText.trim().length > 0) {
    const headerHeight = 90;

    // Header gradient background
    const headerGrad = ctx.createLinearGradient(0, 0, 0, headerHeight);
    headerGrad.addColorStop(0, 'rgba(0, 0, 0, 0.9)');
    headerGrad.addColorStop(1, 'rgba(0, 0, 0, 0.65)');
    ctx.fillStyle = headerGrad;
    ctx.fillRect(0, 0, width, headerHeight);

    // Header bottom border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, headerHeight);
    ctx.lineTo(width, headerHeight);
    ctx.stroke();

    // Logo emblem in header
    let titleX = 60;
    if (logoImg) {
      const logoSize = 46;
      const logoX = 50;
      const logoY = (headerHeight - logoSize) / 2;

      ctx.save();
      ctx.beginPath();
      ctx.arc(logoX + logoSize / 2, logoY + logoSize / 2, logoSize / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(logoImg, logoX, logoY, logoSize, logoSize);
      ctx.restore();

      ctx.strokeStyle = 'rgba(45, 212, 191, 0.4)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(logoX + logoSize / 2, logoY + logoSize / 2, logoSize / 2, 0, Math.PI * 2);
      ctx.stroke();

      titleX = logoX + logoSize + 18;
    }

    // Title on left
    const titleText = payload.title || "KING'S SWORD";
    ctx.fillStyle = '#2dd4bf'; // Teal-400
    ctx.font = 'bold 34px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(titleText, titleX, headerHeight / 2);

    // Metadata on right
    const metaParts: string[] = [];
    if (payload.date) metaParts.push(payload.date);
    if (payload.time) metaParts.push(payload.time);
    if (payload.city) metaParts.push(payload.city);

    if (metaParts.length > 0) {
      ctx.fillStyle = '#e4e4e7';
      ctx.font = 'bold 26px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(metaParts.join('  •  '), width - 50, headerHeight / 2);
    }

    // Prepare Text Rendering
    const bottomReserved = payload.activeDefinition ? 160 : 60;
    const availableHeight = height - headerHeight - bottomReserved;

    const sidePadding = isSong ? 100 : 120;
    const maxTextWidth = width - sidePadding * 2;

    // Temporary measure font size
    ctx.font = 'bold 52px sans-serif';
    const wrappedLines = wrapTextLines(ctx, rawText, maxTextWidth);
    const lineCount = Math.max(wrappedLines.length, 1);

    // Dynamic Font Scaling
    let fontSize = Math.min(60, Math.max(34, Math.floor(availableHeight / (lineCount * 1.5))));
    const lineHeight = fontSize * 1.45;
    ctx.font = `bold ${fontSize}px sans-serif`;

    // Re-wrap if font size adjusted
    const finalWrappedLines = wrapTextLines(ctx, rawText, maxTextWidth);
    const finalLineCount = Math.max(finalWrappedLines.length, 1);
    const totalTextHeight = finalLineCount * lineHeight;

    const startY = headerHeight + (availableHeight - totalTextHeight) / 2 + fontSize / 2;

    // Drawing options according to alignment
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
    ctx.shadowBlur = 18;

    if (isSong) {
      // Centered alignment for songs
      ctx.textAlign = 'center';
      finalWrappedLines.forEach((line, index) => {
        const y = startY + index * lineHeight;
        ctx.fillText(line, width / 2, y);
      });
    } else {
      // Left alignment for Sermons & Bible
      ctx.textAlign = 'left';
      finalWrappedLines.forEach((line, index) => {
        const y = startY + index * lineHeight;
        ctx.fillText(line, sidePadding, y);
      });
    }

    // Reset shadow
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;

    // 5. Active Definition Card Overlay (if present)
    if (payload.activeDefinition) {
      const defCardW = width * 0.75;
      const defCardH = 120;
      const defCardX = (width - defCardW) / 2;
      const defCardY = height - defCardH - 30;

      ctx.fillStyle = 'rgba(24, 24, 27, 0.92)';
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(defCardX, defCardY, defCardW, defCardH, 20);
        ctx.fill();
        ctx.strokeStyle = 'rgba(45, 212, 191, 0.5)';
        ctx.lineWidth = 2;
        ctx.stroke();
      } else {
        ctx.fillRect(defCardX, defCardY, defCardW, defCardH);
      }

      ctx.fillStyle = '#2dd4bf';
      ctx.font = 'bold 26px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(`📖 ${payload.activeDefinition.word}`, defCardX + 30, defCardY + 20);

      ctx.fillStyle = '#f4f4f5';
      ctx.font = '20px sans-serif';
      const defLines = wrapTextLines(ctx, payload.activeDefinition.definition, defCardW - 60);
      defLines.slice(0, 2).forEach((dLine, dIdx) => {
        ctx.fillText(dLine, defCardX + 30, defCardY + 58 + dIdx * 26);
      });
    }

  } else {
    // Idle Screen Representation when no text is projected (Centered Aesthetic Card)
    const cardWidth = width * 0.7;
    const cardHeight = height * 0.58;
    const cardX = (width - cardWidth) / 2;
    const cardY = (height - cardHeight) / 2;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(cardX, cardY, cardWidth, cardHeight, 30);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      ctx.fillRect(cardX, cardY, cardWidth, cardHeight);
    }

    const titleText = payload.title || "KING'S SWORD";

    // Logo Emblem on Centered Card
    if (logoImg) {
      const logoSize = 90;
      const logoX = (width - logoSize) / 2;
      const logoY = cardY + 50;

      // Glow circle background
      ctx.fillStyle = 'rgba(45, 212, 191, 0.15)';
      ctx.beginPath();
      ctx.arc(logoX + logoSize / 2, logoY + logoSize / 2, logoSize / 2 + 10, 0, Math.PI * 2);
      ctx.fill();

      // Clip circular logo
      ctx.save();
      ctx.beginPath();
      ctx.arc(logoX + logoSize / 2, logoY + logoSize / 2, logoSize / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(logoImg, logoX, logoY, logoSize, logoSize);
      ctx.restore();

      // Border ring
      ctx.strokeStyle = 'rgba(45, 212, 191, 0.5)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(logoX + logoSize / 2, logoY + logoSize / 2, logoSize / 2, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Centered Title
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 56px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
    ctx.shadowBlur = 20;
    ctx.fillText(titleText.toUpperCase(), width / 2, height / 2 + 20);

    // Centered Metadata
    const metaParts: string[] = [];
    if (payload.date) metaParts.push(payload.date);
    if (payload.time) metaParts.push(payload.time);
    if (payload.city) metaParts.push(payload.city);

    if (metaParts.length > 0) {
      ctx.fillStyle = '#2dd4bf';
      ctx.font = 'bold 26px sans-serif';
      ctx.fillText(metaParts.join('  •  '), width / 2, height / 2 + 80);
    }

    // Status Pill / Notice
    ctx.fillStyle = '#a1a1aa';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText("SÉLECTIONNEZ UN PARAGRAPHE POUR PROJETER", width / 2, height / 2 + 135);

    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
  }

  return canvas.toDataURL('image/png');
};

let isCaptureInProgress = false;

/**
 * Triggers a full capture of the current projection state and saves it to the media gallery.
 */
export const executeProjectionCapture = async (): Promise<void> => {
  if (isCaptureInProgress) return;
  isCaptureInProgress = true;

  const state = useAppStore.getState();
  const payload = getActiveProjectionPayload();

  try {
    const dataUrl = await generateProjectionSnapshot(payload);
    const meta = await detectImageMeta(dataUrl);

    const titleSnippet = payload.title || (payload.isBible ? 'Verset Biblique' : 'Projection');
    const textSnippet = payload.text ? payload.text.trim().slice(0, 30).replace(/[\r\n]+/g, ' ') : '';
    const captureName = `Capture - ${titleSnippet}${textSnippet ? ' (' + textSnippet + '...)' : ''}`;

    await state.addMediaImage({
      name: captureName.slice(0, 80),
      url: dataUrl,
      orientation: meta.orientation,
      aspectRatio: meta.aspectRatio,
      width: meta.width,
      height: meta.height,
      folderId: 'folder-captures',
      caption: `Capture de projection enregistrée le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
    });

    state.addNotification('📸 Projection capturée et ajoutée automatiquement à la galerie !', 'success');
  } catch (err) {
    console.error('Erreur lors de la capture:', err);
    state.addNotification('Impossible de capturer la projection', 'error');
  } finally {
    isCaptureInProgress = false;
  }
};

