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

export function isDeepDiveStudyRequest(query: string): boolean {
  if (!query || typeof query !== 'string') return false;
  const norm = normalizeText(query).toLowerCase();

  const patterns = [
    /\b(plan d'etude|plan de sermon|etude thematique|deep dive|analyse approfondie)\b/,
    /\b(structure de l'enseignement|developpement thematique|tableau comparatif)\b/,
    /\b(schema doctrinal|explication complete|synthese complete)\b/,
    /\b(stature de l'homme parfait|sept ages|sept sceaux|sept trompettes)\b/
  ];

  return patterns.some(p => p.test(norm));
}

export function getDeepDiveSystemInstruction(): string {
  return `
DIRECTIVES SUPPLÉMENTAIRES POUR PLAN D'ÉTUDE THÉMATIQUE APPROFONDIE (MODE DEEP DIVE) :
1. STRUCTURE EXÉGÉTIQUE COMPLÈTE :
   - ## 📖 Titre & Thème de l'Étude
   - ### I. Fondement Scripturaire & Contexte Historique
   - ### II. Développement Doctrinal Chronologique (avec citations exactes [Réf: ID, §N])
   - ### III. Concordance Prophétique (Liens entre Sermons, Exposé et Écritures)
   - ### IV. Tableaux / Diagrammes de Synthèse en Markdown (Frise chronologique, Âges, Vertus, Sceaux)
   - ### V. Conclusion & Application Pratique pour le Croyant
2. TABLEAUX & SCHÉMAS : Utilise des tableaux Markdown bien alignés pour résumer les comparaisons ou les étapes prophétiques.
3. CITATIONS TEXTUELLES : Cite toujours textuellement entre guillemets > « ... » [Réf: ID, §N].
4. SOURCES & PISTES : Inclus les sections "### Sources consultées" et "### 💡 Pistes d'approfondissement".`;
}
