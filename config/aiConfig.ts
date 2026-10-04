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
};

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
  models: AiModelConfig;
} = {
  featureFlags: { ...defaultFeatureFlags },
  models: {
    // Modèle vérifié disponible et rapide
    primaryFastModel: "gemini-3.8-flash",
    // Failover technique uniquement entre modèles rapides éprouvés
    fastFailoverCascade: [
      "gemini-3.8-flash",
      "gemini-3.5-flash",
      "gemini-1.5-flash",
      "gemini-1.5-pro"
    ],
    // Modèle de raisonnement avancé pour les analyses complexes (non utilisé en failover aveugle)
    reasoningModel: "gemini-3.1-pro-preview",
    autoRagTemperature: 0.2,
    dockTemperature: 0.4,
    dockMaxChars: 300000,
    googleSearchEnabled: false
  }
};
