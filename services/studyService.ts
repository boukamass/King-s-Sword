import { GoogleGenAI } from "@google/genai";
import { Sermon } from '../types';
import { isOllamaAvailable, askOllamaChat } from './ollamaService';
import { getGeminiApiKey } from '../utils/apiKeyHelper';
import { classifyGeminiError } from './geminiChatService';

const callWithRetry = async (fn: () => Promise<any>, maxRetries = 1, delay = 1500) => {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      const classified = classifyGeminiError(error);
      if (classified.type === 'API_KEY_INVALID' || classified.type === 'PERMISSION_DENIED' || classified.type === 'MODEL_UNAVAILABLE') {
        throw error;
      }
      if (i < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2;
        continue;
      }
      throw error;
    }
  }
};

export const analyzeSelectionContext = async (
  selection: string,
  currentSermon: Sermon,
  allContextSermons: Sermon[]
): Promise<string> => {
  const apiKey = getGeminiApiKey();
  const currentText = currentSermon?.text || '';

  const otherSermonsContext = allContextSermons
    .filter(s => s.id !== currentSermon?.id)
    .map(s => `=== DOCUMENT SOURCE : ${s.title} (${s.date || 'Non daté'}, ${s.city || ''}) [ID: ${s.id}] ===\nCONTENU :\n${(s.text || '').substring(0, 10000)}`)
    .join("\n\n---\n\n");

  const prompt = `
Tu es un moteur d'analyse et de recherche théologique d'excellence.

DIRECTIVE STRICTE :
Tes analyses doivent être fondées EXCLUSIVEMENT sur les documents sources fournis dans cette application (le document principal et les sources du contexte). N'utilise aucune source web externe.

EXTRAIT SÉLECTIONNÉ À ÉTUDIER :
> "${selection}"

DOCUMENT PRINCIPAL :
Titre : ${currentSermon?.title || 'Document'}
Date / Lieu : ${currentSermon?.date || ''} - ${currentSermon?.city || ''}
ID : ${currentSermon?.id || ''}
TEXTE DU DOCUMENT :
${currentText.substring(0, 15000)}

SOURCES ET RÉFÉRENCES CROISÉES DU CONTEXTE :
${otherSermonsContext || "Aucune source secondaire ajoutée au Dock IA."}

STRUCTURE OBLIGATOIRE DE LA RÉPONSE :
1. 📖 **Exégèse & Contexte Immédiat** : Analyse détaillée du sens textuel, des mots-clés, de la portée originelle et du moment où cette vérité a été proclamée.
2. 🏛️ **Fondements & Portée Doctrinale** : Développement théologique approfondi des doctrines et principes bibliques/prophétiques sous-jacents (citations explicites à l'appui).
3. 🔗 **Harmonie & Références Croisées** : Rapprochements précis avec les autres sermons du contexte ou passages des Écritures, mettant en lumière la cohérence et l'enchaînement de la révélation.
4. 💡 **Synthèse & Application Spirituelle** : Synthèse percutante des leçons concrètes, avertissements et exhortations pour la foi pratique.

RÈGLE DE CITATION STRICTE :
Chaque citation ou argument textuel DOIT obligatoirement être référencé sous le format exact :
> "Citation exacte du texte..." [Réf: ID_SERMON, Para. N]
(Si le paragraphe exact est inconnu, utiliser [Réf: ID_SERMON]).
`;

  // 1. Tenter Gemini Cloud si disponible
  if (apiKey && navigator.onLine) {
    try {
      const ai = new GoogleGenAI({ apiKey });
      const response = await callWithRetry(() => ai.models.generateContent({
        model: "gemini-3.8-flash",
        contents: prompt,
        config: { 
          temperature: 0.2,
        }
      }));

      return response.text || "Analyse indisponible.";
    } catch (error: any) {
      const classified = classifyGeminiError(error);
      
      if (classified.type === 'API_KEY_INVALID' || classified.type === 'PERMISSION_DENIED' || classified.type === 'QUOTA_EXHAUSTED') {
        throw new Error(`Erreur d'analyse IA : ${classified.userMessage}`);
      }

      console.warn("Échec temporaire Gemini, basculement vers analyse locale:", classified.type);
    }
  }

  // 2. Tenter Ollama Local
  try {
    const ollamaActive = await isOllamaAvailable();
    if (ollamaActive) {
      const res = await askOllamaChat(
        `Analyse la citation suivante dans le contexte du sermon "${currentSermon.title}" :\n"${selection}"`,
        currentSermon.text.substring(0, 10000),
        []
      );
      return `> ℹ️ **Mode Local (Ollama)** : *Analyse contextuelle générée par Ollama.*\n\n${res.text}`;
    }
  } catch (ollamaErr) {
    console.warn("Ollama non joignable pour l'analyse:", ollamaErr);
  }

  // 3. Synthèse locale offline de la sélection
  return `### Analyse Thématique (Mode Hors-Ligne)

> ℹ️ **Mode Secours Local** : *Gemini indisponible ou hors-ligne. Analyse générée à partir du sermon local.*

**Extrait ciblé :**
> "${selection}"

**Document de référence :**
*${currentSermon?.title || 'Sermon'}* (${currentSermon?.date || 'Date non renseignée'})

**Points clés repérés dans le texte :**
- L'extrait se situe dans le contexte immédiat de l'enseignement sur *${currentSermon?.title}*.
- Pour une analyse exégétique complète assistée par IA, activez votre clé d'accès en haut de l'écran.`;
};
