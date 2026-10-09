import http from 'http';
import https from 'https';
import { executeUnifiedRagPipeline } from '../services/unifiedRagService';
import { computeE5Embedding, quantizeToInt8 } from '../services/embeddingService';
import { SermonChunk, AIContext } from '../types';
import { pipeline } from '@xenova/transformers';

async function runE5ValidationSuite() {
  console.log('================================================================');
  console.log(' 🧪 SUITE DE VALIDATION DU RETRIEVAL LOCAL E5 384D');
  console.log('================================================================\n');

  // 1. Démonstration de l'Artefact E5 et du Runtime ONNX
  console.log('--- TEST C : Chargement du modèle ONNX Xenova/multilingual-e5-small ---');
  const t0Model = performance.now();
  const extractor = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small', { quantized: true });
  console.log(`✅ Modèle ONNX chargé avec succès en ${Math.round(performance.now() - t0Model)} ms.`);

  // 2. Test D : Persistance et rechargement d'un vecteur E5
  console.log('\n--- TEST D : Persistance et rechargement d\'un vecteur E5 (384D Int8) ---');
  const samplePassage = "passage: Le Saint-Esprit est descendu au jour de la Pentecôte sous forme de langues de feu.";
  const e5RawOutput = await extractor(samplePassage, { pooling: 'mean', normalize: true });
  const sampleInt8Vec = quantizeToInt8(e5RawOutput.data);
  const sampleBuffer = Buffer.from(sampleInt8Vec.buffer, sampleInt8Vec.byteOffset, sampleInt8Vec.byteLength);
  const reloadedInt8Vec = new Int8Array(sampleBuffer.buffer, sampleBuffer.byteOffset, sampleBuffer.byteLength);
  console.log(`✅ Vecteur original (Int8) : length=${sampleInt8Vec.length}, octets=${sampleBuffer.byteLength}`);
  console.log(`✅ Vecteur rechargé        : length=${reloadedInt8Vec.length}, octets=${reloadedInt8Vec.byteLength}`);
  const isIdentical = sampleInt8Vec.every((val, idx) => val === reloadedInt8Vec[idx]);
  console.log(`✅ Test d'égalité binaire   : ${isIdentical ? 'RÉUSSI (100% identique)' : 'ÉCHOUÉ'}`);

  // 3. Préparation d'un mini-corpus Exposé avec embeddings E5 384D Int8
  console.log('\n--- Préparation du mini-corpus Exposé avec indexation E5 384D ---');
  const exposeChunksRaw = [
    {
      chunkId: 'expose-ch5-p1',
      sermonId: 'expose-chap5',
      sermonTitle: "L'Âge de l'Église de Pergame",
      text: "Dans le chapitre 5 de l'Exposé, Frère Branham explique l'enseignement sur la semence du serpent et la séduction d'Ève dans le jardin d'Éden.",
      startParagraph: 1,
      endParagraph: 2
    },
    {
      chunkId: 'expose-ch5-p2',
      sermonId: 'expose-chap5',
      sermonTitle: "L'Âge de l'Église de Pergame",
      text: "La doctrine du Nicolaïsme est la séparation du clergé et des laïques, détruisant la fraternité du corps de Christ.",
      startParagraph: 3,
      endParagraph: 4
    },
    {
      chunkId: 'expose-ch5-p3',
      sermonId: 'expose-chap5',
      sermonTitle: "L'Âge de l'Église de Pergame",
      text: "À celui qui vaincra je donnerai de la manne cachée, et je lui donnerai un caillou blanc, et sur ce caillou un nom nouveau écrit.",
      startParagraph: 5,
      endParagraph: 6
    }
  ];

  const processedChunks: SermonChunk[] = [];
  for (const rawChunk of exposeChunksRaw) {
    const textToEmbed = `passage: ${rawChunk.text}`;
    const output = await extractor(textToEmbed, { pooling: 'mean', normalize: true });
    const int8Embedding = quantizeToInt8(output.data);
    processedChunks.push({
      ...rawChunk,
      paragraphIds: [rawChunk.startParagraph, rawChunk.endParagraph],
      characterCount: rawChunk.text.length,
      wordCount: rawChunk.text.split(/\s+/).length,
      version: 'v1',
      contentHash: 'hash_' + rawChunk.chunkId,
      embedding: int8Embedding,
      embeddingModel: 'Xenova/multilingual-e5-small',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }
  console.log(`✅ Index pré-calculé E5 prêt pour ${processedChunks.length} chunks du chapitre 5 de l'Exposé.`);

  // 4. TEST A : Exécution avec RÉSEAU BLOQUÉ (E5 + BM25)
  console.log('\n--- TEST A : Exécution avec le RÉSEAU STRICTEMENT BLOQUÉ ---');
  // Blocage explicite des appels réseau
  http.get = (() => { throw new Error('Réseau bloqué par le test !'); }) as any;
  https.get = (() => { throw new Error('Réseau bloqué par le test !'); }) as any;
  global.fetch = (() => { throw new Error('Réseau bloqué par le test !'); }) as any;

  const context: AIContext = {
    sources: [{ sourceId: 'expose-chap5', title: "L'Âge de l'Église de Pergame", sourceType: 'expose' }]
  };

  const ragResultA = await executeUnifiedRagPipeline(
    "Que dit Frère Branham sur la semence du serpent ?",
    context,
    { providedChunks: processedChunks }
  );

  console.log(`✅ Résultat Test A (Réseau Bloqué) :`);
  console.log(`   - Answerable : ${ragResultA.answerable}`);
  console.log(`   - Vector Method : ${ragResultA.vectorMethod}`);
  console.log(`   - Preuves trouvées : ${ragResultA.evidence?.length || 0}`);

  // 5. TEST B : Requête sur un paragraphe de l'Exposé (Recherche Top 5)
  console.log('\n--- TEST B : Requête sur un paragraphe de l\'Exposé -> Vérification Top 5 ---');
  const targetQuery = "la manne cachée et le caillou blanc avec un nom nouveau";
  const ragResultB = await executeUnifiedRagPipeline(
    targetQuery,
    context,
    { providedChunks: processedChunks }
  );

  const topHits = ragResultB.evidence || [];
  const foundInTop5 = topHits.slice(0, 5).some(e => e.chunkId === 'expose-ch5-p3');
  console.log(`✅ Résultat Test B (Recherche Top 5 Paragraphe) :`);
  console.log(`   - Trouvé dans le Top 5 : ${foundInTop5 ? 'OUI' : 'NON'}`);
  if (topHits.length > 0) {
    console.log(`   - Top 1 Hit ID : ${topHits[0].chunkId}`);
  }

  console.log('\n================================================================');
  console.log(' 🏁 TOUS LES TESTS DU RETRIEVAL E5 COMPLÉTÉS SANS ERREUR');
  console.log('================================================================\n');
}

runE5ValidationSuite().catch(err => {
  console.error('❌ Erreur lors du test E5:', err);
  process.exit(1);
});
