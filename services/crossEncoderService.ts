/**
 * King's Sword — Reranking local par cross-encoder (mmarco-mMiniLMv2-L12-H384, multilingue, 0 token)
 *
 * Le cross-encoder lit la question et chaque passage ENSEMBLE et estime leur pertinence, ce qu'un score
 * lexical (BM25) ou une similarité de vecteurs calculés séparément (E5) ne font pas.
 *
 * Exécution :
 * - Electron : dans le processus principal (onnxruntime-node, tous les cœurs) via IPC `ai:crossEncoderScore` ;
 * - Node (scripts, banc d'essai) : directement avec @xenova/transformers ;
 * - Navigateur sans Electron : indisponible (le classement BM25 en tête reste utilisé).
 * Toute indisponibilité, erreur ou dépassement de délai renvoie null : l'appelant garde son ordre initial.
 */

export const CROSS_ENCODER_MODEL_ID = 'cross-encoder/mmarco-mMiniLMv2-L12-H384-v1';

let nodeModelPromise: Promise<{ tok: any; model: any } | null> | null = null;
let unavailableReason: string | null = null;

async function getNodeModel(): Promise<{ tok: any; model: any } | null> {
  if (!nodeModelPromise) {
    nodeModelPromise = (async () => {
      try {
        const path = await import('path');
        const fs = await import('fs');
        const { AutoTokenizer, AutoModelForSequenceClassification, env } = await import('@xenova/transformers');
        const candidates = [
          path.join(process.cwd(), 'models'),
          path.join(process.cwd(), 'public', 'models')
        ];
        const base = candidates.find(dir => fs.existsSync(path.join(dir, CROSS_ENCODER_MODEL_ID, 'onnx', 'model_quantized.onnx')));
        if (!base) {
          unavailableReason = 'modèle cross-encoder absent';
          return null;
        }
        env.allowRemoteModels = false;
        env.allowLocalModels = true;
        env.localModelPath = base + path.sep;
        const tok = await AutoTokenizer.from_pretrained(CROSS_ENCODER_MODEL_ID);
        const model = await AutoModelForSequenceClassification.from_pretrained(CROSS_ENCODER_MODEL_ID, { quantized: true });
        return { tok, model };
      } catch (err: any) {
        unavailableReason = err?.message || String(err);
        return null;
      }
    })();
  }
  return nodeModelPromise;
}

/** Calcul des scores dans Node (scripts et processus principal Electron partagent la même logique) */
export async function scorePairsInNode(query: string, texts: string[], maxLength = 256, batchSize = 16): Promise<number[] | null> {
  const loaded = await getNodeModel();
  if (!loaded) return null;
  const scores: number[] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const part = texts.slice(i, i + batchSize);
    const inputs = loaded.tok(new Array(part.length).fill(query), { text_pair: part, padding: true, truncation: true, max_length: maxLength });
    const { logits } = await loaded.model(inputs);
    const data = logits.data as Float32Array;
    const width = logits.dims[1] || 1;
    for (let j = 0; j < part.length; j++) scores.push(width === 1 ? data[j] : data[j * width + (width - 1)]);
  }
  return scores;
}

function isNodeRuntime(): boolean {
  return typeof process !== 'undefined' && Boolean(process.versions?.node) && typeof window === 'undefined';
}

/**
 * Scores de pertinence (plus grand = plus pertinent) pour chaque texte, ou null si le cross-encoder
 * est indisponible ou n'a pas répondu dans le délai imparti.
 */
export async function scoreWithCrossEncoder(
  query: string,
  texts: string[],
  options: { maxLength?: number; timeoutMs?: number } = {}
): Promise<number[] | null> {
  if (!query || !Array.isArray(texts) || texts.length === 0) return null;
  const maxLength = options.maxLength ?? 256;
  const timeoutMs = options.timeoutMs ?? 20000;

  const run = async (): Promise<number[] | null> => {
    const electronAi = typeof window !== 'undefined' ? (window as any).electronAPI?.ai : undefined;
    if (electronAi?.crossEncoderScore) {
      const res = await electronAi.crossEncoderScore({ query, texts, maxLength });
      if (res && res.success && Array.isArray(res.scores) && res.scores.length === texts.length) return res.scores;
      unavailableReason = res?.error || 'réponse invalide du processus principal';
      return null;
    }
    if (isNodeRuntime()) return scorePairsInNode(query, texts, maxLength);
    unavailableReason = 'environnement sans Electron ni Node';
    return null;
  };

  try {
    let timer: any;
    const timeout = new Promise<null>(resolve => { timer = setTimeout(() => { unavailableReason = 'délai dépassé'; resolve(null); }, timeoutMs); });
    const result = await Promise.race([run(), timeout]);
    clearTimeout(timer);
    return result;
  } catch (err: any) {
    unavailableReason = err?.message || String(err);
    return null;
  }
}

export function getCrossEncoderUnavailableReason(): string | null {
  return unavailableReason;
}
