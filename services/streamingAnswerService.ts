/**
 * King's Sword — Affichage progressif de la réponse structurée (flux Gemini)
 *
 * Gemini renvoie un objet JSON (synthèse, points argumentés, citations) morceau par morceau. Le JSON incomplet
 * est complété de façon tolérante pour afficher la synthèse dès ses premiers mots, puis chaque point.
 * Les citations ne sont affichées qu'après leur vérification, dans la réponse finale.
 */

/**
 * Ferme un préfixe JSON tronqué (chaîne ouverte, objets et tableaux non refermés).
 */
function completeJsonPrefix(prefix: string): string {
  const stack: string[] = [];
  let inString = false;
  let escape = false;
  for (let i = 0; i < prefix.length; i++) {
    const ch = prefix[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') stack.pop();
  }

  let out = prefix;
  if (inString) {
    if (escape) out = out.slice(0, -1);
    out = out.replace(/\\u[0-9a-fA-F]{0,3}$/, '');
    out += '"';
  }
  out = out.replace(/[\s,:]+$/, '');
  for (let i = stack.length - 1; i >= 0; i--) out += stack[i] === '{' ? '}' : ']';
  return out;
}

/**
 * Analyse un JSON éventuellement incomplet. Retourne null si rien d'exploitable n'est encore disponible.
 */
export function parsePartialJson(text: string): any | null {
  const source = (text || '').trim();
  if (!source.startsWith('{')) return null;
  try {
    return JSON.parse(source);
  } catch {}

  // Points de coupe sûrs : virgules hors chaînes, de la plus récente à la plus ancienne
  const cuts: number[] = [];
  let inString = false;
  let escape = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === ',') cuts.push(i);
  }

  const attempts = [source.length, ...cuts.reverse().slice(0, 6)];
  for (const end of attempts) {
    try {
      return JSON.parse(completeJsonPrefix(source.slice(0, end)));
    } catch {}
  }
  return null;
}

/**
 * Markdown provisoire de la réponse en cours de génération (synthèse puis points, sans les citations).
 * Chaîne vide tant que rien n'est affichable ou si le modèle conclut que les sources ne suffisent pas.
 */
export function renderPartialStructuredAnswer(rawJsonText: string): string {
  const partial = parsePartialJson(rawJsonText);
  if (!partial || typeof partial !== 'object') return '';
  if (partial.answerability === false) return '';

  const summary = typeof partial.summary === 'string' ? partial.summary.trim() : '';
  if (!summary) return '';

  let markdown = `## Synthèse\n${summary}\n\n`;
  const args = Array.isArray(partial.arguments) ? partial.arguments : [];
  const shown = args.filter((a: any) => a && typeof a.pointTitle === 'string' && a.pointTitle.trim());
  if (shown.length > 0) {
    markdown += `## Démonstrations & Arguments Doctrinaux\n\n`;
    shown.forEach((arg: any, idx: number) => {
      const explanation = typeof arg.explanation === 'string' ? arg.explanation.trim() : '';
      markdown += `### ${idx + 1}. ${arg.pointTitle.trim()}\n${explanation}\n\n`;
    });
  }
  return markdown.trim();
}
