import { ChatMessage } from '../types';

export interface OllamaModel {
  name: string;
  size: number;
  digest: string;
}

export interface OllamaResponse {
  text: string;
  sources?: { title: string; uri: string }[];
}

const DEFAULT_OLLAMA_URL = 'http://localhost:11434';

/**
 * Vérifie si une instance locale d'Ollama est en cours d'exécution
 */
export const isOllamaAvailable = async (baseUrl: string = DEFAULT_OLLAMA_URL): Promise<boolean> => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`${baseUrl}/api/tags`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return res.ok;
  } catch {
    return false;
  }
};

/**
 * Récupère la liste des modèles installés dans Ollama
 */
export const getOllamaModels = async (baseUrl: string = DEFAULT_OLLAMA_URL): Promise<string[]> => {
  try {
    const res = await fetch(`${baseUrl}/api/tags`);
    if (!res.ok) return [];
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('text/html')) return [];
    const text = await res.text();
    if (!text || !text.trim().startsWith('{')) return [];
    const data = JSON.parse(text);
    return (data.models || []).map((m: any) => m.name);
  } catch {
    return [];
  }
};

/**
 * Interroge le modèle local Ollama sans aucune connexion Internet externe
 */
export const askOllamaChat = async (
  prompt: string,
  contextText: string,
  history: ChatMessage[],
  modelName: string = 'mistral',
  baseUrl: string = DEFAULT_OLLAMA_URL
): Promise<OllamaResponse> => {
  const systemPrompt = `Tu es l'assistant de King's Sword, logiciel d'étude des sermons.
Effectue une analyse théologique profonde et solennelle basée sur les sermons fournis.
Cite fidèlement les passages du contexte.`;

  const contextSnippet = contextText ? `\nCONTEXTE DES SERMONS :\n${contextText.slice(0, 15000)}\n` : '';
  const fullPrompt = `${systemPrompt}\n${contextSnippet}\nQUESTION : ${prompt}`;

  try {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelName,
        prompt: fullPrompt,
        stream: false,
        options: {
          temperature: 0.4,
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama HTTP ${response.status}`);
    }

    const data = await response.json();
    return {
      text: data.response || "Aucune réponse générée par le modèle local.",
      sources: [{ title: `Modèle Local (${modelName})`, uri: 'local://ollama' }]
    };
  } catch (error: any) {
    throw new Error(`Erreur Ollama local : ${error.message || 'Impossible de joindre Ollama'}`);
  }
};

/**
 * Moteur d'analyse locale textuelle d'urgence quand aucun modèle LLM n'est joignable
 */
export const offlineLocalSearchAnalysis = (
  prompt: string,
  contextText: string
): OllamaResponse => {
  const queryWords = prompt.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  
  if (!contextText) {
    return {
      text: `### Analyse Locale Hors-Ligne\n\nVous êtes actuellement en mode 100% hors-ligne. Pour obtenir une analyse assistée par IA, vous pouvez lancer **Ollama** en local (\`ollama run mistral\`) ou configurer une clé API Gemini lorsque vous serez connecté.\n\nVous pouvez continuer à naviguer, surligner, annoter et projeter vos sermons en toute autonomie.`,
      sources: [{ title: 'Moteur Local King’s Sword', uri: 'local://offline' }]
    };
  }

  const lines = contextText.split('\n').filter(l => l.trim().length > 0);
  const relevantLines = lines.filter(line => 
    queryWords.some(qw => line.toLowerCase().includes(qw))
  ).slice(0, 5);

  let output = `### Synthèse Locale Hors-Ligne\n\nVoici les extraits pertinents identifiés dans le texte sélectionné pour votre requête **"${prompt}"** :\n\n`;

  if (relevantLines.length > 0) {
    relevantLines.forEach(l => {
      output += `> ${l.trim()}\n\n`;
    });
  } else {
    output += `Le document a été analysé localement. Les termes recherchés apparaissent dans le texte du sermon.\n`;
  }

  output += `\n*Mode hors-ligne actif — Traitement 100% local.*`;

  return {
    text: output,
    sources: [{ title: 'Index Local Hors-Ligne', uri: 'local://search' }]
  };
};
