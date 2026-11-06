/**
 * King's Sword — Fournisseurs d'IA pour la rédaction des réponses
 *
 * Gemini reste le fournisseur par défaut (comportement inchangé). Mistral, Groq et OpenRouter exposent la même
 * API « compatible OpenAI » : un seul connecteur suffit pour les trois. Il implémente l'interface GeminiCaller
 * du Generation Adapter (mêmes paramètres, même forme de réponse), de sorte que le pipeline RAG, le flux
 * progressif, la validation des citations et le repli local restent strictement identiques.
 */

import type { GeminiCaller } from './generationAdapter';
import { AiProviderId, extractAllApiKeys, getActiveAiProvider, getProviderApiKey } from '../utils/apiKeyHelper';

export interface AiProviderInfo {
  id: AiProviderId;
  label: string;
  /** Phrase courte affichée sous le nom dans la fenêtre de configuration */
  tagline: string;
  /** Page où l'utilisateur crée sa clé gratuite */
  keyUrl: string;
  keyPlaceholder: string;
  /** Étapes de création de la clé, en langage non technique */
  keySteps: string[];
  /** URL de base de l'API compatible OpenAI (absente pour Gemini) */
  baseUrl?: string;
  /** Modèles préférés, du meilleur au moins bon (expressions régulières sur l'identifiant du modèle) */
  preferredModels: RegExp[];
  /** Modèle utilisé si la liste des modèles ne peut pas être lue */
  fallbackModel: string;
  /** Plafond du prompt propre au fournisseur (quota de tokens par minute de l'offre gratuite) */
  maxPromptChars?: number;
  /** Plafond de tokens de la réponse */
  maxOutputTokens?: number;
  /** Ne retenir que les modèles gratuits (OpenRouter : identifiants en « :free ») */
  freeModelsOnly?: boolean;
}

export const AI_PROVIDERS: Record<AiProviderId, AiProviderInfo> = {
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    tagline: 'Recommandé — gratuit, réponses les plus complètes',
    keyUrl: 'https://aistudio.google.com/app/apikey',
    keyPlaceholder: 'AIzaSy... (Collez une ou plusieurs clés séparées par un retour à la ligne)',
    keySteps: [
      'Cliquez sur le lien ci-dessus pour générer une clé d\'accès.',
      'Collez la clé obtenue dans la zone ci-dessous.',
      'Vous pouvez coller plusieurs clés (une par ligne) pour une bascule automatique.'
    ],
    preferredModels: [],
    fallbackModel: 'gemini-3.8-flash'
  },
  mistral: {
    id: 'mistral',
    label: 'Mistral AI',
    tagline: 'Français, serveurs en Europe — offre gratuite « Experiment »',
    keyUrl: 'https://console.mistral.ai/api-keys',
    keyPlaceholder: 'Collez votre clé Mistral (une ou plusieurs, une par ligne)',
    keySteps: [
      'Cliquez sur le lien ci-dessus et créez un compte Mistral (gratuit).',
      'Choisissez l\'offre gratuite « Experiment » (une vérification par téléphone est demandée).',
      'Cliquez sur « Create new key », copiez la clé et collez-la ci-dessous.'
    ],
    baseUrl: 'https://api.mistral.ai/v1',
    preferredModels: [/^mistral-large/, /^mistral-medium/, /^mistral-small/],
    fallbackModel: 'mistral-large-latest',
    maxOutputTokens: 8192
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    tagline: 'Très rapide — gratuit sans carte bancaire, réponses plus courtes',
    keyUrl: 'https://console.groq.com/keys',
    keyPlaceholder: 'gsk_... (Collez une ou plusieurs clés, une par ligne)',
    keySteps: [
      'Cliquez sur le lien ci-dessus et créez un compte Groq (gratuit, sans carte bancaire).',
      'Cliquez sur « Create API Key », donnez-lui un nom puis copiez la clé.',
      'Collez la clé ci-dessous.'
    ],
    baseUrl: 'https://api.groq.com/openai/v1',
    preferredModels: [/^openai\/gpt-oss-120b$/, /llama-3\.3-70b/, /llama-4-maverick/, /qwen.*32b/, /kimi-k2/, /^openai\/gpt-oss-20b$/],
    fallbackModel: 'openai/gpt-oss-120b',
    // L'offre gratuite limite les tokens par minute : un contexte plus court évite les refus « requête trop volumineuse »
    maxPromptChars: 18000,
    maxOutputTokens: 4096
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    tagline: 'Accès à de nombreux modèles gratuits — quota quotidien limité',
    keyUrl: 'https://openrouter.ai/settings/keys',
    keyPlaceholder: 'sk-or-... (Collez votre clé OpenRouter)',
    keySteps: [
      'Cliquez sur le lien ci-dessus et créez un compte OpenRouter (gratuit).',
      'Cliquez sur « Create Key », copiez la clé.',
      'Collez la clé ci-dessous : seuls les modèles gratuits seront utilisés.'
    ],
    baseUrl: 'https://openrouter.ai/api/v1',
    // La liste des modèles gratuits change souvent : grands modèles généralistes d'abord, puis repli sur le premier gratuit utilisable
    preferredModels: [/nemotron-3-ultra/, /gemma-4-31b/, /nemotron-3\.5-super/, /gemma-4-26b/, /deepseek.*(chat|v3)/, /llama-3\.3-70b/, /qwen.*(235b|72b)/, /mistral-small/, /gemma-3-27b/],
    fallbackModel: 'google/gemma-4-31b-it:free',
    freeModelsOnly: true,
    maxPromptChars: 40000,
    maxOutputTokens: 8192
  }
};

export const AI_PROVIDER_ORDER: AiProviderId[] = ['gemini', 'mistral', 'groq', 'openrouter'];

export function getAiProviderInfo(id: AiProviderId = getActiveAiProvider()): AiProviderInfo {
  return AI_PROVIDERS[id] || AI_PROVIDERS.gemini;
}

/** Erreur HTTP normalisée : `status` est lu par classifyGeminiError (401/403, 429, 503, 404) */
export class AiProviderHttpError extends Error {
  status: number;
  retryAfterMs: number | null;
  constructor(message: string, status: number, retryAfterMs: number | null = null) {
    super(message);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function buildHeaders(provider: AiProviderInfo, key: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${key}`
  };
  if (provider.id === 'openrouter') {
    headers['HTTP-Referer'] = 'https://github.com/boukamass/King-s-Sword';
    headers['X-Title'] = "King's Sword";
  }
  return headers;
}

async function throwHttpError(provider: AiProviderInfo, res: Response): Promise<never> {
  let body = '';
  try { body = await res.text(); } catch {}
  const retryAfterHeader = res.headers.get('retry-after');
  const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : NaN;
  const retryAfterMs = Number.isFinite(retryAfterSec) ? retryAfterSec * 1000 : null;
  let detail = body.slice(0, 400);
  try {
    const j = JSON.parse(body);
    detail = j?.error?.message || j?.message || j?.detail || detail;
    if (typeof detail !== 'string') detail = JSON.stringify(detail).slice(0, 400);
  } catch {}
  const status = res.status === 413 ? 429 : res.status;
  const prefix = res.status === 413 ? 'Requête trop volumineuse pour le quota par minute' : `HTTP ${res.status}`;
  throw new AiProviderHttpError(`${provider.label} ${prefix} : ${detail}`, status, retryAfterMs);
}

// ---------------------------------------------------------------------------
// Choix du modèle : lecture de la liste des modèles disponibles pour la clé, puis préférence ordonnée
// ---------------------------------------------------------------------------

const modelListCache = new Map<string, string[]>();

export function pickPreferredModels(provider: AiProviderInfo, ids: string[]): string[] {
  const usable = ids.filter(id => {
    if (provider.freeModelsOnly && !id.endsWith(':free')) return false;
    // Modèles non conversationnels (audio, embeddings, modération, OCR, garde-fous)
    return !/(whisper|embed|moderation|ocr|tts|guard|transcri|vision-preview|safety|code|nano|lightning|-\d(\.\d)?b[:-])/i.test(id);
  });
  const ordered: string[] = [];
  for (const pref of provider.preferredModels) {
    const matches = usable.filter(id => pref.test(id) && !ordered.includes(id));
    // Alias « latest » d'abord, puis la version la plus récente (identifiants datés triés à rebours)
    matches.sort((a, b) => {
      const la = a.includes('latest') ? 1 : 0;
      const lb = b.includes('latest') ? 1 : 0;
      if (la !== lb) return lb - la;
      return b.localeCompare(a);
    });
    if (matches.length > 0) ordered.push(matches[0]);
  }
  if (ordered.length === 0 && usable.length > 0) ordered.push(usable[0]);
  return ordered;
}

export async function listProviderModels(provider: AiProviderInfo, key: string): Promise<string[]> {
  const cacheKey = `${provider.id}::${key.slice(-8)}`;
  const cached = modelListCache.get(cacheKey);
  if (cached) return cached;
  const res = await fetch(`${provider.baseUrl}/models`, { headers: buildHeaders(provider, key) });
  if (!res.ok) await throwHttpError(provider, res);
  const json: any = await res.json();
  const ids: string[] = (Array.isArray(json?.data) ? json.data : []).map((m: any) => String(m?.id || '')).filter(Boolean);
  modelListCache.set(cacheKey, ids);
  return ids;
}

/** Modèles à essayer pour cette clé, du préféré au repli */
export async function resolveProviderModels(provider: AiProviderInfo, key: string): Promise<string[]> {
  try {
    const ids = await listProviderModels(provider, key);
    const picked = pickPreferredModels(provider, ids);
    if (picked.length > 0) return picked.slice(0, 3);
  } catch (err) {
    // 401/403 : la clé est refusée, inutile d'essayer un modèle de repli
    if (err instanceof AiProviderHttpError && (err.status === 401 || err.status === 403)) throw err;
  }
  return [provider.fallbackModel];
}

// ---------------------------------------------------------------------------
// Conversion des paramètres Gemini (contents / config) vers le format « chat completions »
// ---------------------------------------------------------------------------

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

function partsToText(parts: any): string {
  if (!Array.isArray(parts)) return typeof parts === 'string' ? parts : '';
  return parts.map(p => (typeof p === 'string' ? p : p?.text || '')).join('');
}

/** Squelette JSON lisible déduit du schéma Gemini (Type.OBJECT, Type.ARRAY, ...) */
export function schemaToJsonSkeleton(schema: any): any {
  if (!schema || typeof schema !== 'object') return 'texte';
  const t = String(schema.type || '').toUpperCase();
  if (t === 'OBJECT') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(schema.properties || {})) out[k] = schemaToJsonSkeleton(v);
    return out;
  }
  if (t === 'ARRAY') return [schemaToJsonSkeleton(schema.items)];
  if (t === 'BOOLEAN') return 'true | false';
  if (t === 'INTEGER' || t === 'NUMBER') return 0;
  return 'texte';
}

export function buildChatMessages(contents: any, config: any): ChatMessage[] {
  const messages: ChatMessage[] = [];
  let system = typeof config?.systemInstruction === 'string'
    ? config.systemInstruction
    : partsToText(config?.systemInstruction?.parts);
  if (config?.responseMimeType === 'application/json') {
    const skeleton = config?.responseSchema ? JSON.stringify(schemaToJsonSkeleton(config.responseSchema), null, 2) : '';
    system += `\n\nFORMAT DE SORTIE : réponds UNIQUEMENT par un objet JSON valide, sans texte avant ou après et sans bloc de code Markdown.${skeleton ? `\nStructure attendue :\n${skeleton}` : ''}`;
  }
  if (system && system.trim()) messages.push({ role: 'system', content: system });

  if (typeof contents === 'string') {
    messages.push({ role: 'user', content: contents });
  } else if (Array.isArray(contents)) {
    for (const c of contents) {
      if (typeof c === 'string') { messages.push({ role: 'user', content: c }); continue; }
      const text = partsToText(c?.parts);
      if (!text) continue;
      messages.push({ role: c?.role === 'model' || c?.role === 'assistant' ? 'assistant' : 'user', content: text });
    }
  } else if (contents && typeof contents === 'object') {
    messages.push({ role: 'user', content: partsToText(contents.parts) });
  }
  return messages;
}

function mapFinishReason(reason: any): string | undefined {
  if (!reason) return undefined;
  const r = String(reason).toLowerCase();
  if (r === 'stop' || r === 'end_turn' || r === 'eos') return 'STOP';
  if (r === 'length' || r === 'max_tokens' || r === 'model_length') return 'MAX_TOKENS';
  return r.toUpperCase();
}

function mapUsage(usage: any): any {
  if (!usage) return undefined;
  const prompt = Number(usage.prompt_tokens ?? 0);
  const cand = Number(usage.completion_tokens ?? 0);
  return { promptTokenCount: prompt, candidatesTokenCount: cand, totalTokenCount: Number(usage.total_tokens ?? prompt + cand) };
}

/** Retire un éventuel raisonnement <think>…</think> placé dans le contenu par certains modèles */
function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>\s*/g, '');
}

function buildBody(provider: AiProviderInfo, model: string, params: { contents: any; config: any }, stream: boolean, withJsonFormat: boolean): any {
  const config = params.config || {};
  const body: any = {
    model,
    messages: buildChatMessages(params.contents, config),
    temperature: typeof config.temperature === 'number' ? config.temperature : 0.2,
    max_tokens: Math.min(Number(config.maxOutputTokens) || 4096, provider.maxOutputTokens || 8192),
    stream
  };
  if (withJsonFormat && config.responseMimeType === 'application/json') {
    body.response_format = { type: 'json_object' };
  }
  return body;
}

async function postChat(provider: AiProviderInfo, key: string, body: any): Promise<Response> {
  const res = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: buildHeaders(provider, key),
    body: JSON.stringify(body)
  });
  if (!res.ok) await throwHttpError(provider, res);
  return res;
}

/** Un modèle refuse le format JSON imposé (400) : on réessaie sans, la consigne JSON reste dans le prompt */
function isJsonFormatRejection(err: any): boolean {
  const msg = String(err?.message || '').toLowerCase();
  return err?.status === 400 && (msg.includes('response_format') || msg.includes('json'));
}

async function completeOnce(provider: AiProviderInfo, key: string, model: string, params: { contents: any; config: any }) {
  let res: Response;
  try {
    res = await postChat(provider, key, buildBody(provider, model, params, false, true));
  } catch (err) {
    if (!isJsonFormatRejection(err)) throw err;
    res = await postChat(provider, key, buildBody(provider, model, params, false, false));
  }
  const json: any = await res.json();
  const choice = json?.choices?.[0];
  const text = stripThinking(String(choice?.message?.content ?? ''));
  return { text, candidates: [{ finishReason: mapFinishReason(choice?.finish_reason) || 'STOP' }], usageMetadata: mapUsage(json?.usage) };
}

async function* readSseStream(res: Response): AsyncGenerator<any> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line || line.startsWith(':') || !line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      try { yield JSON.parse(data); } catch {}
    }
  }
}

async function streamOnce(provider: AiProviderInfo, key: string, model: string, params: { contents: any; config: any }) {
  let res: Response;
  try {
    res = await postChat(provider, key, buildBody(provider, model, params, true, true));
  } catch (err) {
    if (!isJsonFormatRejection(err)) throw err;
    res = await postChat(provider, key, buildBody(provider, model, params, true, false));
  }
  async function* chunks() {
    let inThink = false;
    for await (const evt of readSseStream(res)) {
      if (evt?.error) throw new AiProviderHttpError(`${provider.label} : ${evt.error?.message || 'erreur pendant le flux'}`, Number(evt.error?.code) || 500);
      const choice = evt?.choices?.[0];
      let piece: string = choice?.delta?.content || '';
      // Raisonnement <think> transmis dans le flux : non affiché, non conservé
      if (piece.includes('<think>')) { inThink = true; piece = piece.split('<think>')[0]; }
      if (inThink) {
        const end = piece.indexOf('</think>');
        if (end < 0) piece = '';
        else { inThink = false; piece = piece.slice(end + 8); }
      }
      const finishReason = mapFinishReason(choice?.finish_reason);
      yield {
        text: piece || undefined,
        candidates: finishReason ? [{ finishReason }] : undefined,
        usageMetadata: mapUsage(evt?.usage)
      };
    }
  }
  return chunks();
}

/**
 * Client compatible avec l'interface GeminiCaller du Generation Adapter.
 * Bascule automatique : modèle suivant si indisponible (404), clé suivante si quota épuisé (429) ou clé refusée (401/403),
 * une nouvelle attente courte si le fournisseur indique un délai (Retry-After ≤ 20 s).
 */
export function createOpenAICompatibleCaller(
  providerId: AiProviderId,
  keys: string[],
  hooks: { onModelUsed?: (model: string) => void; onProgress?: (message: string) => void } = {}
): GeminiCaller {
  const provider = getAiProviderInfo(providerId);

  async function run<T>(call: (key: string, model: string) => Promise<T>): Promise<T> {
    let lastErr: any = null;
    for (const key of keys) {
      let models: string[];
      try {
        models = await resolveProviderModels(provider, key);
      } catch (err) {
        lastErr = err;
        continue; // Clé refusée : clé suivante
      }
      let switchKey = false;
      for (const model of models) {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const out = await call(key, model);
            hooks.onModelUsed?.(model);
            return out;
          } catch (err: any) {
            lastErr = err;
            const status = Number(err?.status || 0);
            if (status === 429 && attempt === 0 && err?.retryAfterMs && err.retryAfterMs <= 20000) {
              hooks.onProgress?.(`${provider.label} est très sollicité, nouvelle tentative dans quelques secondes...`);
              await new Promise(r => setTimeout(r, err.retryAfterMs + 250));
              continue;
            }
            if (status === 503 && attempt === 0) {
              hooks.onProgress?.(`${provider.label} est très sollicité, nouvelle tentative dans quelques secondes...`);
              await new Promise(r => setTimeout(r, 3000));
              continue;
            }
            if (status === 404) break; // Modèle suivant
            if (status === 429 || status === 401 || status === 403) { switchKey = true; break; }
            throw err;
          }
        }
        if (switchKey) break;
      }
    }
    throw lastErr || new Error(`Aucune clé ${provider.label} utilisable.`);
  }

  return {
    generateContent: (p) => run((key, model) => completeOnce(provider, key, model, p)),
    generateContentStream: (p) => run((key, model) => streamOnce(provider, key, model, p))
  };
}

/** Client du fournisseur actif (hors Gemini), ou null si Gemini est actif ou si aucune clé n'est configurée */
export function createActiveProviderCaller(
  hooks: { onModelUsed?: (model: string) => void; onProgress?: (message: string) => void } = {}
): { providerId: AiProviderId; caller: GeminiCaller | null; maxPromptChars?: number } {
  const providerId = getActiveAiProvider();
  if (providerId === 'gemini') return { providerId, caller: null };
  const keys = extractAllApiKeys(getProviderApiKey(providerId));
  const info = getAiProviderInfo(providerId);
  return {
    providerId,
    caller: keys.length > 0 ? createOpenAICompatibleCaller(providerId, keys, hooks) : null,
    maxPromptChars: info.maxPromptChars
  };
}

/**
 * Test de la clé (sur clic de l'utilisateur uniquement) : lecture des modèles puis une très courte requête.
 */
export async function testProviderApiKey(providerId: AiProviderId, rawKey: string): Promise<{ success: boolean; message: string; errorType?: string }> {
  const provider = getAiProviderInfo(providerId);
  const keys = extractAllApiKeys(rawKey);
  if (keys.length === 0) {
    return { success: false, message: 'Veuillez coller votre clé avant de lancer le test.', errorType: 'EMPTY' };
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { success: false, message: 'Aucune connexion Internet. Vérifiez votre connexion puis réessayez.', errorType: 'OFFLINE' };
  }
  let okCount = 0;
  let lastMessage = '';
  let lastType = 'UNKNOWN';
  let modelUsed = '';
  for (const key of keys) {
    try {
      const models = await resolveProviderModels(provider, key);
      const out = await completeOnce(provider, key, models[0], {
        contents: 'Réponds simplement : OK',
        config: { temperature: 0, maxOutputTokens: 16 }
      });
      if (out) { okCount++; modelUsed = models[0]; }
    } catch (err: any) {
      const status = Number(err?.status || 0);
      if (status === 401 || status === 403) { lastType = 'INVALID_KEY'; lastMessage = `Clé refusée par ${provider.label}. Vérifiez que vous avez copié la clé en entier.`; }
      else if (status === 429) { lastType = 'QUOTA'; lastMessage = `La clé est valide mais le quota gratuit de ${provider.label} est momentanément atteint. Réessayez dans une minute.`; }
      else if (String(err?.message || '').toLowerCase().includes('fetch')) { lastType = 'NETWORK'; lastMessage = `Impossible de joindre ${provider.label}. Vérifiez votre connexion Internet.`; }
      else { lastType = 'UNKNOWN'; lastMessage = `${provider.label} a renvoyé une erreur : ${String(err?.message || err).slice(0, 200)}`; }
    }
  }
  if (okCount > 0) {
    const multi = keys.length > 1 ? ` (${okCount}/${keys.length} clé(s) valide(s))` : '';
    return { success: true, message: `Connexion réussie avec ${provider.label}${multi}. Modèle utilisé : ${modelUsed}.` };
  }
  return { success: false, message: lastMessage || `Échec du test avec ${provider.label}.`, errorType: lastType };
}
