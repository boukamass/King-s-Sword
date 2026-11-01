/**
 * Configuration centralisée de l'IA pour King's Sword
 * Gestion des feature flags, des rôles de modèles et des cascades de failover
 */

export interface AiFeatureFlags {
  // Conserver l'ancien moteur de recherche actif (valeur par défaut prudente)
  useLegacyRetrieval: boolean;
  // Préparation des futures phases (désactivées en Phase 0)
  useHybridRetrieval: boolean;
  useUnifiedRag: boolean;
  useEmbeddings: boolean;
  useQueryRewrite: boolean;
  useReranker: boolean;
  useCitationValidation: boolean;
  useQueryCache: boolean;
  useResponseCache: boolean;
  // Mode Étudiant Profond (désactivé par défaut en production)
  useDeepStudentMode: boolean;
}

export interface DeepStudentConfig {
  /** Étape 1 : Query expansion par LLM (5 à 8 sous-requêtes) + BM25+Vectoriel + RRF */
  enableLlmExpansion: boolean;
  subQueriesCount: number;
  /** Étape 2 : Récupération large (60 à 100 passages) puis reranking par Gemini (score 0-3, garder >= 2) */
  candidatePoolSize: number;
  enableGeminiRerank: boolean;
  minRelevanceScore: number;
  rerankBatchSize: number;
  /** Étape 3 : Seuil de suffisance (< N passages pertinents -> mention explicite dans la réponse) */
  enableThresholdGuard: boolean;
  minRelevantPassagesN: number;
  /** Étape 4 : Génération en deux temps (4a: extraction idée établie, 4b: rédaction ancrée sans doctrine extérieure) */
  enableTwoStageGeneration: boolean;
  /** Étape 5 : Taille de contexte configurable (jusqu'à 60 extraits avec voisins ±1) */
  maxContextExcerpts: number;
  includeNeighbors: boolean;
  maxCharsPerSource: number;
  /** Tarification officielle Gemini Flash par 1M tokens pour calcul exact du coût à partir de usageMetadata */
  inputCostPerMillionUsd: number;
  outputCostPerMillionUsd: number;
}

export const defaultFeatureFlags: AiFeatureFlags = {
  useLegacyRetrieval: true,
  useHybridRetrieval: false,
  useUnifiedRag: true,
  useEmbeddings: false,
  useQueryRewrite: false,
  useReranker: false,
  useCitationValidation: false,
  useQueryCache: false,
  useResponseCache: false,
  useDeepStudentMode: false,
};

export const defaultDeepStudentConfig: DeepStudentConfig = {
  enableLlmExpansion: true,
  subQueriesCount: 6,
  candidatePoolSize: 80,
  enableGeminiRerank: true,
  minRelevanceScore: 2,
  rerankBatchSize: 30,
  enableThresholdGuard: true,
  minRelevantPassagesN: 3,
  enableTwoStageGeneration: true,
  maxContextExcerpts: 60,
  includeNeighbors: true,
  maxCharsPerSource: 1500,
  inputCostPerMillionUsd: 0.15,
  outputCostPerMillionUsd: 0.60,
};

const DEEP_STUDENT_STORAGE_KEY = 'kings_sword_deep_student_mode';

export function isDeepStudentModeEnabled(): boolean {
  if (aiConfig.featureFlags.useDeepStudentMode) return true;
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    try {
      return window.localStorage.getItem(DEEP_STUDENT_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  }
  return false;
}

export function setDeepStudentModeEnabled(enabled: boolean): void {
  aiConfig.featureFlags.useDeepStudentMode = enabled;
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    try {
      if (enabled) {
        window.localStorage.setItem(DEEP_STUDENT_STORAGE_KEY, 'true');
      } else {
        window.localStorage.removeItem(DEEP_STUDENT_STORAGE_KEY);
      }
    } catch {}
  }
}

export interface AiModelConfig {
  // Modèle principal rapide pour l'Auto-RAG et les réponses directes
  primaryFastModel: string;
  // Cascade de failover technique pour 429 / 503 / indisponibilité temporaire (modèles rapides de même classe)
  fastFailoverCascade: string[];
  // Modèle de raisonnement avancé pour les tâches complexes (Dock IA)
  reasoningModel: string;
  // Température déterministe pour Auto-RAG
  autoRagTemperature: number;
  // Température pour le Dock IA
  dockTemperature: number;
  // Limite maximale de caractères du contexte Dock IA (300 000 caractères)
  dockMaxChars: number;
  // Recherche Web Google STRICTEMENT désactivée
  googleSearchEnabled: boolean;
}

export const aiConfig: {
  featureFlags: AiFeatureFlags;
  deepStudentConfig: DeepStudentConfig;
  models: AiModelConfig;
} = {
  featureFlags: { ...defaultFeatureFlags },
  deepStudentConfig: { ...defaultDeepStudentConfig },
  models: {
    // Modèle vérifié disponible et rapide
    primaryFastModel: "gemini-3.8-flash",
    // Failover technique uniquement entre modèles modernes éprouvés
    fastFailoverCascade: [
      "gemini-3.8-flash",
      "gemini-flash-latest",
      "gemini-3.1-pro-preview"
    ],
    // Modèle de raisonnement avancé pour les analyses complexes (non utilisé en failover aveugle)
    reasoningModel: "gemini-3.1-pro-preview",
    autoRagTemperature: 0.2,
    dockTemperature: 0.4,
    dockMaxChars: 300000,
    googleSearchEnabled: false
  }
};

