/**
 * Utilitaire de conversion des couleurs modernes (OKLCH, OKLAB, LAB, LCH, color(), color-mix(), etc.) vers sRGB (RGB/RGBA/HEX).
 * Permet à html2canvas et aux générateurs PDF de parser les feuilles de style Tailwind v4 et modernes sans erreur.
 */

const colorCache = new Map<string, string>();
let colorHelperCtx: CanvasRenderingContext2D | null = null;

/**
 * Détermine si une chaîne contient des fonctions ou espaces de couleurs CSS Color 4
 * non supportés nativement par html2canvas.
 */
export function hasModernColor(input: string): boolean {
  if (!input || typeof input !== 'string') return false;
  const lower = input.toLowerCase();
  return (
    lower.includes('oklch') ||
    lower.includes('oklab') ||
    lower.includes('color(') ||
    lower.includes('color-mix(') ||
    lower.includes('lab(') ||
    lower.includes('lch(') ||
    lower.includes('hwb(')
  );
}

/**
 * Convertit mathématiquement les valeurs OKLAB en sRGB (0-255).
 * Basé sur l'algorithme officiel de la spécification CSS Color Module Level 4.
 */
export function oklabValuesToRgb(l: number, a: number, b: number, alpha: number = 1): string {
  // Clamp de sécurité pour L
  l = Math.max(0, Math.min(1, l));

  // Transformation vers l'espace intermédiaire
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.2914855480 * b;

  const l3 = l_ * l_ * l_;
  const m3 = m_ * m_ * m_;
  const s3 = s_ * s_ * s_;

  // Matrice de transformation vers sRGB linéaire
  let r = +4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
  let g = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
  let bl = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3;

  // Gamma correction vers sRGB standard
  const toSrgb = (x: number): number => {
    x = Math.max(0, Math.min(1, x));
    return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  };

  const R = Math.round(toSrgb(r) * 255);
  const G = Math.round(toSrgb(g) * 255);
  const B = Math.round(toSrgb(bl) * 255);

  if (alpha < 1) {
    return `rgba(${R}, ${G}, ${B}, ${Number(alpha.toFixed(3))})`;
  }
  return `rgb(${R}, ${G}, ${B})`;
}

/**
 * Convertit mathématiquement les valeurs OKLCH en sRGB (0-255).
 */
export function oklchValuesToRgb(l: number, c: number, h: number, alpha: number = 1): string {
  c = Math.max(0, c);
  h = ((h % 360) + 360) % 360;

  const hRad = (h * Math.PI) / 180;
  const a = c * Math.cos(hRad);
  const b = c * Math.sin(hRad);

  return oklabValuesToRgb(l, a, b, alpha);
}

/**
 * Analyse une sous-chaîne OKLAB individuelle et retourne sa représentation RGB/RGBA.
 */
export function parseSingleOklab(raw: string): string {
  if (colorCache.has(raw)) {
    return colorCache.get(raw)!;
  }

  // 1. Tenter avec le moteur natif du navigateur si disponible
  if (typeof document !== 'undefined') {
    if (!colorHelperCtx) {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        colorHelperCtx = canvas.getContext('2d');
      } catch {}
    }

    if (colorHelperCtx) {
      try {
        colorHelperCtx.fillStyle = '#000000';
        colorHelperCtx.fillStyle = raw;
        const computed = colorHelperCtx.fillStyle;
        if (computed && !hasModernColor(computed)) {
          colorCache.set(raw, computed);
          return computed;
        }
      } catch {}
    }
  }

  // 2. Décomposition regex: oklab(0.6 -0.1 0.05) ou oklab(60% -25% 12% / 0.8)
  const match = raw.match(/oklab\(\s*([+-]?[\d.]+%?)\s+([+-]?[\d.]+%?)\s+([+-]?[\d.]+%?)(?:\s*\/\s*([\d.]+%?))?\s*\)/i);
  if (match) {
    const [, lStr, aStr, bStr, alphaStr] = match;
    const l = lStr.endsWith('%') ? parseFloat(lStr) / 100 : parseFloat(lStr);
    const a = aStr.endsWith('%') ? (parseFloat(aStr) * 0.4) / 100 : parseFloat(aStr);
    const b = bStr.endsWith('%') ? (parseFloat(bStr) * 0.4) / 100 : parseFloat(bStr);
    let alpha = 1;
    if (alphaStr) {
      alpha = alphaStr.endsWith('%') ? parseFloat(alphaStr) / 100 : parseFloat(alphaStr);
    }
    const converted = oklabValuesToRgb(l, a, b, alpha);
    colorCache.set(raw, converted);
    return converted;
  }

  return '#0d9488';
}

/**
 * Analyse une sous-chaîne OKLCH individuelle et retourne sa représentation RGB/RGBA.
 */
export function parseSingleOklch(raw: string): string {
  if (colorCache.has(raw)) {
    return colorCache.get(raw)!;
  }

  // 1. Tenter d'abord avec le canvas 2D natif si disponible
  if (typeof document !== 'undefined') {
    if (!colorHelperCtx) {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        colorHelperCtx = canvas.getContext('2d');
      } catch {}
    }

    if (colorHelperCtx) {
      try {
        colorHelperCtx.fillStyle = '#000000';
        colorHelperCtx.fillStyle = raw;
        const computed = colorHelperCtx.fillStyle;
        if (computed && !hasModernColor(computed)) {
          colorCache.set(raw, computed);
          return computed;
        }
      } catch {}
    }
  }

  // 2. Décomposition regex robuste (supporte pourcentages, angles deg/rad/turn et alpha)
  const match = raw.match(/oklch\(\s*([+-]?[\d.]+%?)\s+([\d.]+%?)\s+([+-]?[\d.]+)(deg|rad|grad|turn)?(?:\s*\/\s*([\d.]+%?))?\s*\)/i);
  if (match) {
    const [, lStr, cStr, hStr, unit, aStr] = match;
    const l = lStr.endsWith('%') ? parseFloat(lStr) / 100 : parseFloat(lStr);
    const c = cStr.endsWith('%') ? (parseFloat(cStr) * 0.4) / 100 : parseFloat(cStr);
    let h = parseFloat(hStr);
    if (unit === 'rad') h = (h * 180) / Math.PI;
    else if (unit === 'turn') h = h * 360;
    else if (unit === 'grad') h = (h * 360) / 400;

    let alpha = 1;
    if (aStr) {
      alpha = aStr.endsWith('%') ? parseFloat(aStr) / 100 : parseFloat(aStr);
    }
    const converted = oklchValuesToRgb(l, c, h, alpha);
    colorCache.set(raw, converted);
    return converted;
  }

  return '#0d9488';
}

/**
 * Analyse une fonction color(srgb ...) et retourne sa représentation RGB/RGBA.
 */
export function parseSingleColorFunction(raw: string): string {
  const match = raw.match(/color\(\s*srgb\s+([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+%?)(?:\s*\/\s*([\d.]+%?))?\s*\)/i);
  if (match) {
    const [, rStr, gStr, bStr, aStr] = match;
    const r = Math.round((rStr.endsWith('%') ? parseFloat(rStr) / 100 : parseFloat(rStr)) * 255);
    const g = Math.round((gStr.endsWith('%') ? parseFloat(gStr) / 100 : parseFloat(gStr)) * 255);
    const b = Math.round((bStr.endsWith('%') ? parseFloat(bStr) / 100 : parseFloat(bStr)) * 255);
    const a = aStr ? (aStr.endsWith('%') ? parseFloat(aStr) / 100 : parseFloat(aStr)) : 1;
    return a < 1 ? `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(3))})` : `rgb(${r}, ${g}, ${b})`;
  }
  return '#0d9488';
}

/**
 * Tente de résoudre toute fonction de couleur moderne via le contexte canvas natif avec un repli sûr.
 */
export function parseWithCanvasOrFallback(raw: string, fallbackColor = '#0d9488'): string {
  if (colorCache.has(raw)) {
    return colorCache.get(raw)!;
  }
  if (typeof document !== 'undefined') {
    if (!colorHelperCtx) {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        colorHelperCtx = canvas.getContext('2d');
      } catch {}
    }
    if (colorHelperCtx) {
      try {
        colorHelperCtx.fillStyle = '#000000';
        colorHelperCtx.fillStyle = raw;
        const computed = colorHelperCtx.fillStyle;
        if (computed && !hasModernColor(computed)) {
          colorCache.set(raw, computed);
          return computed;
        }
      } catch {}
    }
  }
  return fallbackColor;
}

/**
 * Remplace toutes les occurrences d'expressions de couleurs modernes (OKLCH, OKLAB, etc.)
 * dans une chaîne (CSS, style inline, attribut, etc.) par des couleurs compatibles html2canvas.
 */
export function convertModernColorToRgb(input: string): string {
  if (!input || typeof input !== 'string' || !hasModernColor(input)) {
    return input;
  }
  if (colorCache.has(input)) {
    return colorCache.get(input)!;
  }

  let result = input;

  if (result.includes('oklch')) {
    result = result.replace(/oklch\([^)]+\)/gi, (m) => parseSingleOklch(m));
  }
  if (result.includes('oklab')) {
    result = result.replace(/oklab\([^)]+\)/gi, (m) => parseSingleOklab(m));
  }
  if (result.includes('color(srgb')) {
    result = result.replace(/color\(\s*srgb\s+[^)]+\)/gi, (m) => parseSingleColorFunction(m));
  }
  if (result.includes('color(')) {
    result = result.replace(/color\([^)]+\)/gi, (m) => parseWithCanvasOrFallback(m));
  }
  if (result.includes('color-mix(')) {
    result = result.replace(/color-mix\([^)]+\)/gi, (m) => parseWithCanvasOrFallback(m));
  }
  if (result.includes('lab(')) {
    result = result.replace(/lab\([^)]+\)/gi, (m) => parseWithCanvasOrFallback(m));
  }
  if (result.includes('lch(')) {
    result = result.replace(/lch\([^)]+\)/gi, (m) => parseWithCanvasOrFallback(m));
  }
  if (result.includes('hwb(')) {
    result = result.replace(/hwb\([^)]+\)/gi, (m) => parseWithCanvasOrFallback(m));
  }

  colorCache.set(input, result);
  return result;
}

/**
 * Alias de compatibilité pour le code existant
 */
export const convertOklchToRgb = convertModernColorToRgb;

/**
 * Crée un proxy transparent autour d'un objet CSSStyleDeclaration pour intercepter
 * toutes les lectures de propriétés couleur et convertir OKLCH/OKLAB en RGB/RGBA.
 */
export function wrapComputedStyleDeclaration(realStyle: CSSStyleDeclaration): CSSStyleDeclaration {
  return new Proxy(realStyle, {
    get(target, prop) {
      // 1. Intercepter getPropertyValue pour assainir toutes les propriétés inspectées par html2canvas
      if (prop === 'getPropertyValue') {
        return (propertyName: string): string => {
          try {
            const val = target.getPropertyValue(propertyName);
            if (typeof val === 'string' && hasModernColor(val)) {
              return convertModernColorToRgb(val);
            }
            return val;
          } catch {
            return '';
          }
        };
      }

      // 2. Intercepter item() pour copyCSSStyles de html2canvas
      if (prop === 'item') {
        return (index: number): string => {
          try {
            return target.item(index);
          } catch {
            return '';
          }
        };
      }

      // 3. Évaluer la propriété avec target comme 'this' pour éviter tout 'TypeError: Illegal invocation'
      let val: any;
      try {
        val = (target as any)[prop];
      } catch {
        return undefined;
      }

      // 4. Lier les fonctions natives directement à target
      if (typeof val === 'function') {
        return val.bind(target);
      }

      // 5. Convertir toute couleur moderne retournée sous forme de chaîne
      if (typeof val === 'string' && hasModernColor(val)) {
        return convertModernColorToRgb(val);
      }

      return val;
    }
  });
}

/**
 * Applique temporairement un patch sur window.getComputedStyle pour neutraliser les erreurs de couleurs de html2canvas
 */
export function patchWindowGetComputedStyle(targetWin: Window): () => void {
  const originalGCS = targetWin.getComputedStyle;
  targetWin.getComputedStyle = function (elt: Element, pseudoElt?: string | null) {
    try {
      const realStyle = originalGCS.call(targetWin, elt, pseudoElt);
      if (!realStyle) return realStyle;
      return wrapComputedStyleDeclaration(realStyle);
    } catch {
      return originalGCS.call(targetWin, elt, pseudoElt);
    }
  };

  return () => {
    try {
      targetWin.getComputedStyle = originalGCS;
    } catch {}
  };
}
