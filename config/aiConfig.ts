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
  // Mode Contexte Long (style NotebookLM) : transmet l'intégralité des sources sélectionnées à Gemini
  useLongContextGrounding: boolean;
  // Reformulation des questions de relance en requête autonome par Gemini
  useConversationalRewrite: boolean;
  // Retrieval piloté par Gemini (compréhension + multi-requêtes + reranking) pour les grandes sélections
  useSmartRetrieval: boolean;
}

export interface SmartRetrievalConfig {
  /** Taille du bassin de candidats issu du retrieval hybride multi-requêtes (60 à 100) */
  candidatePoolSize: number;
  /** Nombre maximal de passages transmis à la génération */
  maxEvidence: number;
  /** Plafond de passages par document (diversité des sources) */
  maxPerDoc: number;
  /** Taille des lots de reranking évalués en parallèle */
  rerankBatchSize: number;
  /** Longueur maximale de chaque extrait soumis au reranking */
  rerankSnippetChars: number;
  understandingTimeoutMs: number;
  rerankTimeoutMs: number;
}

export interface TokenBudgetConfig {
  /** Plafond du prompt pour une question ciblée (profil « standard »), ≈ 4 caractères par token */
  standardPromptChars: number;
  /** Plafond des sources intégrales en contexte long pour une question ciblée */
  standardLongContextChars: number;
  /** Plafond du prompt pour une synthèse, un résumé ou une étude (profil « approfondi ») */
  maxPromptChars: number;
  /** Plafond de caractères de l'historique de conversation transmis */
  maxHistoryChars: number;
}

export interface LongContextConfig {
  /** Budget maximal de caractères de sources transmis intégralement (~4 caractères par token) */
  maxChars: number;
  /** Nombre maximal de documents sélectionnés éligibles au mode contexte long */
  maxSources: number;
  /** Délai maximal de la reformulation conversationnelle avant repli heuristique */
  rewriteTimeoutMs: number;
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
  useLongContextGrounding: true,
  // Stratégie « local d'abord » : retrieval, reranking et reformulation 100 % locaux, puis UN SEUL appel Gemini
  // au contexte plafonné. Les appels Gemini supplémentaires consommeraient le quota de la clé de l'utilisateur.
  useConversationalRewrite: false,
  useSmartRetrieval: false,
};

export const defaultSmartRetrievalConfig: SmartRetrievalConfig = {
  candidatePoolSize: 80,
  maxEvidence: 30,
  maxPerDoc: 5,
  rerankBatchSize: 40,
  rerankSnippetChars: 600,
  understandingTimeoutMs: 8000,
  rerankTimeoutMs: 20000,
};

// Budget adaptatif décidé localement : ≈ 12 000 tokens pour une question ciblée, ≈ 30 000 pour une synthèse
// ou une étude. Confortable pour le quota gratuit Gemini (plusieurs questions par minute).
export const defaultTokenBudgetConfig: TokenBudgetConfig = {
  standardPromptChars: 48000,
  standardLongContextChars: 44000,
  maxPromptChars: 120000,
  maxHistoryChars: 12000,
};

export const defaultLongContextConfig: LongContextConfig = {
  maxChars: 100000,
  maxSources: 40,
  rewriteTimeoutMs: 6000,
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
  longContextConfig: LongContextConfig;
  smartRetrievalConfig: SmartRetrievalConfig;
  tokenBudgetConfig: TokenBudgetConfig;
  models: AiModelConfig;
} = {
  featureFlags: { ...defaultFeatureFlags },
  deepStudentConfig: { ...defaultDeepStudentConfig },
  longContextConfig: { ...defaultLongContextConfig },
  smartRetrievalConfig: { ...defaultSmartRetrievalConfig },
  tokenBudgetConfig: { ...defaultTokenBudgetConfig },
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

