/**
 * King's Sword — Service d'Intégration Auto-RAG Pipeline (Phase 2F.2)
 * 
 * Orchestre le flux complet du nouveau moteur RAG modulaire :
 * 
 * Question
 *   ↓
 * Hybrid Retrieval (Lexical + Vectoriel RRF k=60)
 *   ↓
 * Reranking Local Multi-signaux
 *   ↓
 * Answerability / Abstention
 *   ↓
 * Retrieval Evidence Service (Validation & Citations déterministes)
 *   ↓
 * RetrievalEvidencePackage
 * 
 * RÈGLES IMPORTANTES :
 * 1. Ce service ne génère PAS la réponse textuelle finale (rôle dévolu à Gemini).
 * 2. Les citations générées n'utilisent JAMAIS chunkId, mais [Réf: SERMON_ID, §N].
 * 3. Si answerable === false, aucune Evidence fictive n'est renvoyée.
 * 4. Les erreurs du nouveau pipeline sont capturées et propagées de manière contrôlée.
 */

import { Sermon, SermonChunk, RetrievalEvidencePackage, RetrievalEvidence } from '../types';
import { retrieveRelevantSermonPassages } from './sermonRagService';
import { searchByText } from './vectorSearchService';
import { mapParagraphsToChunkHits, fuseRankings } from './hybridRetrievalService';
import { rerankHybridResults, assessAnswerability } from './rerankingService';
import { buildRetrievalEvidencePackage } from './retrievalEvidenceService';
import { getAllChunks } from './chunkStorageService';
import { createSermonChunks } from './chunkingService';
import { getGeminiApiKey } from '../utils/apiKeyHelper';
import { useAppStore } from '../store';

export interface AutoRagPipelineOptions {
  apiKey?: string;
  originalSermons?: Sermon[];
  allChunks?: SermonChunk[];
  maxEvidenceCount?: number;
  topK?: number;
  corpusTextIndex?: string;
}

export class AutoRagPipelineError extends Error {
  public readonly code: string;
  public readonly originalError?: any;

  constructor(message: string, code: string = 'PIPELINE_ERROR', originalError?: any) {
    super(message);
    this.name = 'AutoRagPipelineError';
    this.code = code;
    this.originalError = originalError;
  }
}

/**
 * Exécute le pipeline complet Retrieval → Reranking → Answerability → Evidence
 */
export async function executeAutoRagPipeline(
  query: string,
  options: AutoRagPipelineOptions = {}
): Promise<RetrievalEvidencePackage> {
  const cleanQuery = (query || '').trim();
  if (!cleanQuery) {
    return {
      answerable: false,
      confidenceScore: 0,
      reason: 'Requête vide.',
      evidence: [],
      query: cleanQuery,
      totalCandidates: 0,
      rejectedCount: 0
    };
  }

  try {
    // 1. Récupération des sermons originaux
    let originalSermons: Sermon[] = options.originalSermons || [];
    if (originalSermons.length === 0) {
      try {
        const storeSermons = useAppStore.getState().sermonsMap;
        if (storeSermons && storeSermons.size > 0) {
          originalSermons = Array.from(storeSermons.values()).filter((s): s is Sermon => 'text' in s && typeof (s as any).text === 'string' && (s as any).text.length > 0);
        }
      } catch (storeErr) {
        // Fallback context
      }
    }
    
    // 2. Récupération ou génération des chunks
    let chunks: SermonChunk[] = options.allChunks || [];
    if (chunks.length === 0) {
      try {
        chunks = await getAllChunks();
      } catch (err) {
        console.warn('[AutoRagPipeline] Récupération getAllChunks échouée, découpage en direct:', err);
      }
      if (chunks.length === 0 && originalSermons.length > 0) {
        chunks = originalSermons.flatMap(s => createSermonChunks(s));
      }
    }

    if (chunks.length === 0) {
      throw new AutoRagPipelineError(
        'Aucun chunk documentaire disponible pour la recherche.',
        'NO_CHUNKS_AVAILABLE'
      );
    }

    // 3. Récupération lexicale (utilise le retriever lexical legacy existant)
    let lexicalRetrieved: { sermonId: string; paragraphIndex: number; score?: number }[] = [];
    try {
      const legacyRes = await retrieveRelevantSermonPassages(cleanQuery, {
        maxParagraphs: 20,
        minScoreThreshold: 10
      });
      if (legacyRes && Array.isArray(legacyRes.paragraphs)) {
        lexicalRetrieved = legacyRes.paragraphs.map(p => ({
          sermonId: p.sermonId,
          paragraphIndex: p.paragraphIndex,
          score: p.score
        }));
      }
    } catch (lexErr) {
      console.warn('[AutoRagPipeline] Erreur lors de la passe lexicale:', lexErr);
      // Poursuivre avec recherche vectorielle si disponible
    }

    const lexicalHits = mapParagraphsToChunkHits(lexicalRetrieved, chunks);

    // 4. Récupération vectorielle (avec clé API Gemini)
    const apiKey = options.apiKey || getGeminiApiKey();
    let vectorHits: any[] = [];
    if (apiKey) {
      try {
        const searchRes = await searchByText(cleanQuery, chunks, apiKey, {
          topK: options.topK || 20,
          minScoreThreshold: 0.1
        });
        vectorHits = searchRes?.results || [];
      } catch (vecErr: any) {
        console.warn('[AutoRagPipeline] Erreur lors de la passe vectorielle:', vecErr);
        // Si la passe vectorielle échoue mais qu'on a du lexical, continuer en mode dégradé contrôlé
        if (lexicalHits.length === 0) {
          throw new AutoRagPipelineError(
            `Échec de la recherche vectorielle et aucun résultat lexical : ${vecErr?.message || vecErr}`,
            'VECTOR_SEARCH_FAILED',
            vecErr
          );
        }
      }
    }

    // 5. Fusion RRF (Reciprocal Rank Fusion k=60)
    const hybridResults = fuseRankings({
      lexicalHits,
      vectorHits,
      allChunks: chunks,
      options: {
        k: 60,
        topK: options.topK || 15
      }
    });

    if (hybridResults.length === 0) {
      return {
        answerable: false,
        confidenceScore: 0,
        reason: 'Aucun document pertinent retrouvé par la recherche hybride.',
        evidence: [],
        query: cleanQuery,
        totalCandidates: 0,
        rejectedCount: 0
      };
    }

    // 6. Reranking local multi-signaux
    const rerankedResults = rerankHybridResults({
      query: cleanQuery,
      hybridResults,
      options: {
        topK: options.maxEvidenceCount ? options.maxEvidenceCount * 2 : 10
      }
    });

    // 7. Évaluation d'Answerability & Abstention
    const corpusIndex = options.corpusTextIndex || originalSermons.map(s => s.text || '').join(' ');
    const assessment = assessAnswerability({
      query: cleanQuery,
      candidates: rerankedResults,
      corpusTextIndex: corpusIndex
    });

    // 8. Transformation en RetrievalEvidencePackage
    const evidencePackage = buildRetrievalEvidencePackage({
      query: cleanQuery,
      candidates: rerankedResults,
      assessment,
      originalSermons,
      maxEvidenceCount: options.maxEvidenceCount || 5
    });

    return evidencePackage;

  } catch (error: any) {
    if (error instanceof AutoRagPipelineError) {
      throw error;
    }
    throw new AutoRagPipelineError(
      `Erreur inattendue dans le pipeline Auto-RAG : ${error?.message || error}`,
      'UNEXPECTED_PIPELINE_ERROR',
      error
    );
  }
}

/**
 * Formate le package d'Evidence en un bloc de contexte rigoureux pour le modèle Gemini.
 * 
 * RÈGLE ABSOLUE :
 * Les citations demandées au LLM doivent être basées EXCLUSIVEMENT sur :
 * [Réf: SERMON_ID, §N] (ou [Réf: SERMON_ID, Para. N]).
 * JAMAIS de chunkId transmis comme consigne de citation.
 */
export function formatEvidenceContextForGemini(
  evidencePackage: RetrievalEvidencePackage,
  question: string
): string {
  if (!evidencePackage || !evidencePackage.answerable || !Array.isArray(evidencePackage.evidence) || evidencePackage.evidence.length === 0) {
    return "AUCUNE SOURCE PERTINENTE DISPONIBLE DANS LA BASE DOCUMENTAIRE POUR CETTE QUESTION.";
  }

  const sourcesList = evidencePackage.evidence.map((ev: RetrievalEvidence, idx: number) => {
    const citationsList = ev.citationParagraphs
      .map(cp => `  - Paragraphe §${cp.paragraphIndex} -> Citation obligatoire : ${cp.formattedCitation}`)
      .join('\n');

    return `[SOURCE ${idx + 1}]
Sermon : "${ev.sermonTitle}"
Date : ${ev.date || 'Non daté'} | Lieu : ${ev.city || 'Inconnu'} | Version : ${ev.version || 'Standard'}
Identifiant sermon : ${ev.sermonId}
Paragraphes couverts : §${ev.startParagraph} à §${ev.endParagraph}
Références de citations valides pour cette source :
${citationsList}

TEXTE AUTHENTIQUE DES PARAGRAPHES :
"""
${ev.text}
"""`;
  }).join('\n\n------------------------------------------------------------\n\n');

  return `PREUVES DOCUMENTAIRES SÉLECTIONNÉES DANS LA BIBLIOTHÈQUE POUR CETTE QUESTION :
============================================================
${sourcesList}
============================================================

DIRECTIVES DE RÉPONSE STRICTES POUR L'ASSISTANT THÉOLOGIQUE :
1. Réponds à la question en t'appuyant EXCLUSIVEMENT sur les preuves documentaires ci-dessus.
2. Pour chaque affirmation ou citation, cite la référence du paragraphe correspondant sous la forme exacte :
   > « Extrait textuel... » [Réf: ID_SERMON, Para. N]
3. N'utilise AUCUNE information extérieure et n'extrapole pas au-delà des extraits fournis.
4. Si les extraits ci-dessus ne permettent pas de répondre précisément à la question, déclare :
   « Les documents disponibles dans la base documentaire ne contiennent pas d'informations suffisantes pour répondre à cette question. »`;
}
