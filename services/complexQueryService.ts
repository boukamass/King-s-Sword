/**
 * King's Sword — Décomposition locale des questions complexes (0 token)
 *
 * Une question longue ou à plusieurs volets dilue la recherche : son vecteur sémantique moyenne tous les sujets
 * et les formules de politesse ou de cadrage (« pourriez-vous m'expliquer en détail selon frère Branham… »)
 * pèsent autant que les termes doctrinaux. La question est donc :
 * 1. dépouillée de ses formules de cadrage (requête « cœur ») ;
 * 2. découpée en facettes (sous-questions, volets coordonnés), chacune recherchée séparément puis fusionnée.
 */

export interface ComplexQueryDecomposition {
  /** Question sans formules de cadrage ni de politesse */
  coreQuery: string;
  /** Volets distincts de la question (2 à 3), vides si la question est simple */
  facets: string[];
  /** Question longue ou à plusieurs volets : recherche élargie */
  isComplex: boolean;
}

// Formules de cadrage sans valeur de recherche (l'ordre importe : les plus longues d'abord)
const SCAFFOLDING_PATTERNS: RegExp[] = [
  /\b(?:est[- ]ce que\s+)?(?:tu\s+peux|vous\s+pouvez|pourriez[- ]vous|pourrais[- ]tu|peux[- ]tu|pouvez[- ]vous)\s+(?:me\s+|m['’]\s*)?(?:expliquer|dire|montrer|d[ée]tailler|pr[ée]ciser|r[ée]sumer|d[ée]velopper)\b/gi,
  /\b(?:j['’]\s*aimerais|je\s+voudrais|je\s+veux|je\s+souhaite|merci\s+de)\s+(?:bien\s+)?(?:comprendre|savoir|conna[iî]tre|que\s+tu\s+m['’]\s*expliques|que\s+vous\s+m['’]\s*expliquiez)?\b/gi,
  /\b(?:explique|expliquez|explique[- ]moi|expliquez[- ]moi|dis[- ]moi|dites[- ]moi|montre[- ]moi|montrez[- ]moi)\b/gi,
  /\b(?:s['’]\s*il\s+(?:te|vous)\s+pla[iî]t|svp|stp)\b/gi,
  /\b(?:en\s+d[ée]tail|de\s+mani[èe]re\s+(?:d[ée]taill[ée]e|approfondie|pr[ée]cise)|de\s+fa[cç]on\s+(?:d[ée]taill[ée]e|approfondie|pr[ée]cise)|clairement|pr[ée]cis[ée]ment)\b/gi,
  /\b(?:selon|d['’]\s*apr[èe]s|pour)\s+(?:le\s+)?(?:fr[èe]re\s+)?(?:william\s+)?(?:marrion\s+)?branham\b/gi,
  /(?:\bdans|(?<![\p{L}\p{N}])à\s+travers)\s+(?:les|ses)\s+(?:sermons|messages|pr[ée]dications|enseignements)(?:\s+de\s+(?:fr[èe]re\s+)?branham)?\b/giu,
  /\b(?:que|qu['’])\s*(?:dit|enseigne|r[ée]v[èe]le|explique|pense)(?:[- ]t[- ]il)?\s+(?:le\s+)?(?:fr[èe]re\s+)?(?:william\s+)?(?:branham|le\s+proph[èe]te|le\s+message)?\s*(?:sur|de|du|des|à\s+propos\s+d[eu]s?|au\s+sujet\s+d[eu]s?|concernant)?\b/gi,
  /\b(?:qu['’]\s*est[- ]ce\s+que|qu['’]\s*est[- ]ce\s+qu['’]|est[- ]ce\s+que|est[- ]ce\s+qu['’])/gi
];

// Coordinations qui séparent des volets distincts d'une même question
const FACET_SPLIT_REGEX = /\s*[?;]\s*|\s+(?:ainsi\s+que|mais\s+aussi|et\s+aussi|et\s+en\s+quoi|et\s+comment|et\s+pourquoi|et\s+quel(?:le)?s?|et\s+que|puis|ensuite|de\s+plus|en\s+outre|tandis\s+que|alors\s+que|par\s+rapport\s+[àa]|compar[ée]e?s?\s+[àa]|et)\s+/i;

/**
 * Retire les formules de cadrage d'une question, sans jamais la vider.
 */
export function stripQuestionScaffolding(query: string): string {
  let core = query || '';
  for (const pattern of SCAFFOLDING_PATTERNS) core = core.replace(pattern, ' ');
  core = core.replace(/\s+/g, ' ').replace(/^[\s,.:;!?-]+|[\s,.:;-]+$/g, '').trim();
  return core.length >= 3 ? core : (query || '').trim();
}

/**
 * Décompose une question en requête cœur et facettes. `extractTerms` renvoie les termes de recherche significatifs.
 */
export function decomposeComplexQuery(query: string, extractTerms: (text: string) => string[]): ComplexQueryDecomposition {
  const original = (query || '').trim();
  const coreQuery = stripQuestionScaffolding(original);
  const coreTerms = extractTerms(coreQuery);

  const facets: string[] = [];
  const seen = new Set<string>();
  for (const raw of coreQuery.split(FACET_SPLIT_REGEX)) {
    const part = (raw || '').replace(/^[\s,.:-]+|[\s,.:-]+$/g, '').trim();
    if (!part) continue;
    const terms = extractTerms(part);
    // Un volet doit porter au moins deux termes significatifs (« le Père et le Fils » reste une seule facette)
    if (terms.length < 2) continue;
    const key = terms.slice().sort().join(' ');
    if (seen.has(key)) continue;
    seen.add(key);
    facets.push(part);
  }

  const multiFacet = facets.length >= 2;
  return {
    coreQuery,
    facets: multiFacet ? facets.slice(0, 3) : [],
    isComplex: multiFacet || coreTerms.length >= 7 || original.split(/\s+/).length >= 25
  };
}

/**
 * Fusion RRF de plusieurs listes classées de résultats vectoriels (même chunk : meilleur score cosinus conservé).
 */
export function fuseRankedLists<T extends { chunk: { chunkId: string }; score: number }>(
  lists: T[][],
  limit: number,
  k = 60
): Array<T & { rank: number }> {
  const fused = new Map<string, { item: T; rrf: number; best: number }>();
  for (const list of lists) {
    list.forEach((item, idx) => {
      const id = item.chunk.chunkId;
      const entry = fused.get(id);
      const contribution = 1 / (k + idx + 1);
      if (entry) {
        entry.rrf += contribution;
        if (item.score > entry.best) {
          entry.best = item.score;
          entry.item = item;
        }
      } else {
        fused.set(id, { item, rrf: contribution, best: item.score });
      }
    });
  }
  return Array.from(fused.values())
    .sort((a, b) => b.rrf - a.rrf || b.best - a.best)
    .slice(0, limit)
    .map((e, idx) => ({ ...e.item, score: e.best, rank: idx + 1 }));
}
