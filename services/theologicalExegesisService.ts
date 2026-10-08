/**
 * King's Sword — Moteur d'Étude Thématique Approfondie & Exégèse (Deep Dive)
 * 
 * Fournit les capacités de structuration avancée :
 * 1. Détection des demandes de plans d'étude thématiques ("plan d'étude", "deep dive", etc.)
 * 2. Modèles de structuration exégétique (chronologique, schématique en Markdown/tableaux)
 * 3. Vérification croisée des citations bibliques avec la version choisie (LSG, Darby, KJV)
 */

import { BibleVersion } from '../types/bible';
import { normalizeText } from '../utils/textUtils';
import { computeLevenshteinDistance, computeTrigramSimilarity } from './corpusVocabularyService';

/**
 * Détecte si un token correspond approximativement à une cible d'intention.
 * Robuste aux fautes de frappe sans nécessiter de liste fermée de graphies erronées.
 */
function fuzzyTokenMatch(token: string, targets: string[]): boolean {
  const norm = normalizeText(token).toLowerCase().trim();
  if (!norm) return false;

  for (const target of targets) {
    if (norm === target) return true;
    if (Math.abs(norm.length - target.length) > 3) continue;

    const dist = computeLevenshteinDistance(norm, target);
    const tri = computeTrigramSimilarity(norm, target);
    const samePrefix4 = norm.length >= 4 && target.length >= 4 && norm.slice(0, 4) === target.slice(0, 4);

    if (dist <= 2 && (tri >= 0.40 || samePrefix4)) {
      return true;
    }
    if (norm.length >= 4 && dist <= 1) {
      return true;
    }
  }
  return false;
}

/**
 * Détection d'intention pour "Tous les passages" / "Toutes les citations".
 */
export function isAllPassagesRequest(query: string): boolean {
  if (!query || typeof query !== 'string') return false;
  const norm = normalizeText(query).toLowerCase();

  const patterns = [
    /\btous les passages\b/,
    /\btoutes les citations\b/,
    /\btous les extraits\b/,
    /\btoutes les mentions\b/,
    /\btous les versets\b/,
    /\bchaque passage\b/,
    /\btoutes les occurrences\b/,
    /\btous les sermons qui\b/,
    /\btout ce qui est mentionne\b/
  ];

  if (patterns.some(p => p.test(norm))) return true;

  const tokens = norm.split(/\s+/).filter(w => w.length > 2);
  const hasTous = tokens.some(t => fuzzyTokenMatch(t, ['tous', 'toutes', 'chaque']));
  const hasPassages = tokens.some(t => fuzzyTokenMatch(t, ['passages', 'citations', 'extraits', 'mentions', 'occurrences']));

  return hasTous && hasPassages;
}

/**
 * Détection d'intention d'étude exhaustive / Deep Dive.
 * Insensible à l'orthographe, avec rapprochement approximatif déterministe (sans liste fermée de fautes).
 */
export function isDeepDiveStudyRequest(query: string): boolean {
  if (!query || typeof query !== 'string') return false;
  const norm = normalizeText(query).toLowerCase();

  // 1. Vérification regex canonique
  const patterns = [
    /\b(plan d'etude|plan de sermon|etude thematique|deep dive|analyse approfondie)\b/,
    /\b(structure de l'enseignement|developpement thematique|tableau comparatif)\b/,
    /\b(schema doctrinal|explication complete|synthese complete|synthese doctrinale)\b/,
    /\b(etude exhaustive|etude detaillee|etude tres detaillee|etude complete)\b/,
    /\b(tout ce que dit le predicateur|tout ce que frere branham dit|tout ce que dit branham)\b/,
    /\b(tout ce qui est dit sur|panorama complet|dossier complet)\b/,
    /\b(stature de l'homme parfait|sept ages|sept sceaux|sept trompettes)\b/
  ];

  if (patterns.some(p => p.test(norm))) return true;

  // 2. Rapprochement approximatif déterministe sur les concepts d'intention
  // Appariement algorithmique général (ex: "exaustive" -> "exhaustive", "detailé" -> "detaillee")
  const tokens = norm.split(/\s+/).filter(w => w.length > 2);

  const hasStudyNoun = tokens.some(t => fuzzyTokenMatch(t, ['etude', 'analyse', 'synthese', 'plan', 'dossier', 'panorama', 'recherche']));
  const hasExhaustive = tokens.some(t => fuzzyTokenMatch(t, ['exhaustive', 'exhaustif', 'exhaustives', 'exhaustifs']));
  const hasDetailed = tokens.some(t => fuzzyTokenMatch(t, ['detaillee', 'detaille', 'detaillees', 'detailles']));
  const hasInDepth = tokens.some(t => fuzzyTokenMatch(t, ['approfondie', 'approfondi', 'approfondies', 'approfondis']));
  const hasComplete = tokens.some(t => fuzzyTokenMatch(t, ['complete', 'complet', 'completes', 'complets']));

  if (hasStudyNoun && (hasExhaustive || hasDetailed || hasInDepth || hasComplete)) {
    return true;
  }

  // Expression typique "monter / faire une etude ... exhaustive / detaillee"
  if (hasExhaustive || (hasDetailed && hasStudyNoun)) {
    return true;
  }

  if (isAllPassagesRequest(query)) {
    return true;
  }

  return false;
}

/**
 * Classification d'intention d'étude exhaustive en ligne (Gemini) avec repli hors-ligne déterministe.
 */
export async function detectExhaustiveStudyIntent(
  query: string,
  options?: { apiKey?: string; geminiClient?: any }
): Promise<boolean> {
  const offlineMatch = isDeepDiveStudyRequest(query);
  if (offlineMatch) return true;

  // Si clé API disponible, classification rapide en ligne
  if (options?.apiKey) {
    try {
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey: options.apiKey });
      const resp = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: `Tu es un classificateur d'intention pour une application d'étude théologique.
Question : "${query}"
Est-ce que cette requête demande une étude exhaustive, détaillée, approfondie ou tous les passages (Deep Dive) ?
Réponds strictement par OUI ou NON.`,
        config: {
          temperature: 0,
          maxOutputTokens: 6
        }
      });
      const txt = (resp.text || '').trim().toUpperCase();
      if (txt.includes('OUI') || txt.includes('YES')) {
        return true;
      }
    } catch (err) {
      console.warn('[ExegesisIntent] Erreur classification Gemini en ligne, repli local:', err);
    }
  }

  return offlineMatch;
}

/**
 * Nettoie toute balise [Réf: ...] présente dans la section des pistes d'approfondissement.
 */
export function cleanPistesDapprofondissement(text: string): string {
  if (!text || typeof text !== 'string') return text;

  const pistesHeaderRegex = /(#{1,4}\s*(?:💡\s*)?(?:Pistes d'approfondissement|Pistes d'etude|Questions de reflexion|Pistes d'exploration)[\s\S]*)/i;
  const match = text.match(pistesHeaderRegex);
  if (!match || match.index === undefined) return text;

  const sectionText = match[1];
  const cleanedSection = sectionText
    .replace(/\[Réf:\s*[^\]]+\]/gi, '')
    .replace(/\[Ref:\s*[^\]]+\]/gi, '');

  return text.slice(0, match.index) + cleanedSection;
}

/**
 * Formate le résumé de couverture documentaire en adaptant les termes aux types de documents consultés.
 * Ne parle JAMAIS de "sermon(s)" quand la source est un chapitre de l'Exposé ou la Bible.
 * Signale clairement quand la liste est partielle (passages retenus vs trouvés).
 */
export function formatCoverageSummary(params: {
  uniqueDocsCount: number;
  passagesCount: number;
  docIds?: string[];
  totalFoundCount?: number;
}): string {
  const { uniqueDocsCount, passagesCount, docIds = [], totalFoundCount } = params;

  // Détection du type dominant de documents
  let docType = 'sermon(s)';
  if (docIds.length > 0) {
    const allExpose = docIds.every(id => id.startsWith('expose-'));
    const allBible = docIds.every(id => id.startsWith('bible-'));
    const allSong = docIds.every(id => id.startsWith('song-'));

    if (allExpose) {
      docType = "chapitre(s) de l'Exposé";
    } else if (allBible) {
      docType = "livre(s) / chapitre(s) biblique(s)";
    } else if (allSong) {
      docType = "cantique(s)";
    } else if (docIds.some(id => id.startsWith('expose-') || id.startsWith('bible-') || id.startsWith('song-'))) {
      docType = "document(s) / ressource(s)";
    }
  }

  // Si une liste partielle de passages a été extraite
  let countInfo = `${passagesCount} extrait(s)`;
  let partialNotice = '';
  if (typeof totalFoundCount === 'number' && totalFoundCount > passagesCount) {
    countInfo = `${passagesCount} extraits retenus sur ${totalFoundCount} trouvés au total`;
    partialNotice = `\n> ⚠️ *Note : Cette sélection regroupe les ${passagesCount} passages les plus probants parmi les ${totalFoundCount} occurrences répertoriées.*`;
  }

  return `📊 **Couverture documentaire** : ${uniqueDocsCount} ${docType} et ${countInfo} analysés pour cette étude exhaustive.${partialNotice}`;
}

export function getDeepDiveSystemInstruction(): string {
  return `
DIRECTIVES SUPPLÉMENTAIRES POUR ÉTUDE EXHAUSTIVE ET PLAN THÉMATIQUE APPROFONDI (MODE ÉTUDE EXHAUSTIVE) :
1. SECTIONS ANALYTIQUES OBLIGATOIRES AVEC CITATIONS VALIDÉES POUR CHAQUE SECTION :
   - ## 📖 Titre & Thème de l'Étude
   - ### I. Fondement Scripturaire & Définitions Clés (citations exactes [Réf: ID, §N])
   - ### II. Développement Doctrinal & Chronologique (citations exactes [Réf: ID, §N])
   - ### III. Concordance & Harmonie avec les Écritures et l'Exposé (citations exactes [Réf: ID, §N])
   - ### IV. Tableaux / Synthèse Comparative en Markdown (Points doctrinaux, Dates, Périodes)
   - ### V. Conclusion & Portée Spirituelle pour l'Épouse
2. COUVERTURE DOCUMENTAIRE :
   - Mentionne dès l'introduction le nombre de sermons et documents mobilisés.
   - Assure une diversité maximale d'extraits couvrant l'ensemble des angles abordés par le prédicateur.
3. CITATIONS TEXTUELLES PAR SECTION :
   - Chaque section doit comporter au moins 1 à 2 citations textuelles directes authentifiées :
     > « ... » [Réf: ID_SERMON, §N]
4. TABLEAUX & SCHÉMAS : Utilise des tableaux Markdown clairs pour synthétiser les distinctions ou la chronologie.
5. SOURCES & PISTES : Inclus impérativement les sections finales "### Sources consultées" et "### Pistes d'approfondissement".`;
}
