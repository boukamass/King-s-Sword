/**
 * Test de disponibilité et de format des modèles d'embedding Gemini (@google/genai)
 */

import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
if (!apiKey) {
  console.error("❌ Pas de clé API GEMINI_API_KEY trouvée dans l'environnement");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

// Modèles d'embedding potentiels
const CANDIDATE_MODELS = [
  'text-embedding-004',
  'gemini-embedding-2-preview',
  'embedding-001'
];

console.log("=================================================");
console.log(" 🔍 TEST DES MODÈLES D'EMBEDDING GEMINI");
console.log("=================================================\n");

async function testModel(modelName) {
  try {
    const t0 = performance.now();
    const res = await ai.models.embedContent({
      model: modelName,
      contents: "Le premier sceau a été ouvert et le cavalier sur le cheval blanc est apparu."
    });
    const latency = Math.round(performance.now() - t0);

    // Extraction des valeurs d'embedding
    const embedding = res.embedding?.values || res.embeddings?.[0]?.values;
    if (!embedding || !Array.isArray(embedding)) {
      console.log(`❌ [${modelName}] Réponse sans vecteur valide :`, res);
      return null;
    }

    console.log(`✅ [${modelName}] DISPONIBLE`);
    console.log(`   - Dimension       : ${embedding.length}`);
    console.log(`   - Type éléments   : ${typeof embedding[0]} (${Number.isFinite(embedding[0]) ? 'fini' : 'invalide'})`);
    console.log(`   - Latence appel   : ${latency} ms`);
    console.log(`   - Échantillon     : [${embedding.slice(0, 4).map(v => v.toFixed(6)).join(', ')}...]`);

    return {
      model: modelName,
      available: true,
      dimension: embedding.length,
      latency,
      sample: embedding.slice(0, 4)
    };
  } catch (err) {
    console.log(`❌ [${modelName}] INDISPONIBLE (${err.message})`);
    return {
      model: modelName,
      available: false,
      error: err.message
    };
  }
}

async function run() {
  for (const m of CANDIDATE_MODELS) {
    await testModel(m);
  }
}

run();
