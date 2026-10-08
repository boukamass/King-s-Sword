import { executeUnifiedRagPipeline } from '../services/unifiedRagService';
import { SermonChunk, AIContext } from '../types';
import { generateDeterministicSemanticVector } from '../services/embeddingService';

// Création d'un mini corpus simulé avec embeddings Float32 3072D
function createTestCorpus(): SermonChunk[] {
  const c1Text = "Frère Branham enseigne que la semence du serpent est la doctrine selon laquelle Ève a été séduite par le serpent dans le Jardin d'Éden, produisant Caïn.";
  const c2Text = "Dans le jardin d'Éden, la tromperie et la séduction ont amené la chute de l'humanité, marquant le début du péché originel.";
  const c3Text = "L'Âge de l'Église de Pergame est caractérisé par le mariage de l'Église avec l'État sous l'empereur Constantin.";

  // Vecteurs 3072D
  const vec1 = Array.from(generateDeterministicSemanticVector(c1Text, 3072));
  const vec2 = Array.from(generateDeterministicSemanticVector(c2Text, 3072));
  const vec3 = Array.from(generateDeterministicSemanticVector(c3Text, 3072));

  return [
    {
      chunkId: 'expose-chap5-chunk1',
      sermonId: 'expose-chap5',
      sermonTitle: "L'Âge de l'Église de Pergame",
      paragraphIds: [1, 2, 3],
      startParagraph: 1,
      endParagraph: 3,
      text: c1Text,
      date: '1965-12-01',
      city: 'Jeffersonville',
      version: 'Exposé',
      characterCount: c1Text.length,
      wordCount: c1Text.split(' ').length,
      contentHash: 'hash1',
      embedding: vec1
    },
    {
      chunkId: 'expose-chap5-chunk2',
      sermonId: 'expose-chap5',
      sermonTitle: "L'Âge de l'Église de Pergame",
      paragraphIds: [4, 5],
      startParagraph: 4,
      endParagraph: 5,
      text: c2Text,
      date: '1965-12-01',
      city: 'Jeffersonville',
      version: 'Exposé',
      characterCount: c2Text.length,
      wordCount: c2Text.split(' ').length,
      contentHash: 'hash2',
      embedding: vec2
    },
    {
      chunkId: 'expose-chap5-chunk3',
      sermonId: 'expose-chap5',
      sermonTitle: "L'Âge de l'Église de Pergame",
      paragraphIds: [6, 7],
      startParagraph: 6,
      endParagraph: 7,
      text: c3Text,
      date: '1965-12-01',
      city: 'Jeffersonville',
      version: 'Exposé',
      characterCount: c3Text.length,
      wordCount: c3Text.split(' ').length,
      contentHash: 'hash3',
      embedding: vec3
    }
  ];
}

async function runTests() {
  const corpus = createTestCorpus();
  const context: AIContext = {
    sources: [{ sourceId: 'expose-chap5', title: "L'Âge de l'Église de Pergame", sourceType: 'expose' }]
  };

  console.log("=================================================");
  console.log("EXÉCUTION DES 4 TESTS DE VALIDATION PHASE VECTOR 3072D");
  console.log("=================================================\n");

  // TEST A — Question doctrinale
  console.log(">>> TEST A : Question doctrinale <<<");
  const queryA = "Que dit Frère Branham sur la semence du serpent ?";
  const queryAVec = Array.from(generateDeterministicSemanticVector(queryA, 3072));
  const resA = await executeUnifiedRagPipeline(
    queryA,
    context,
    { providedChunks: corpus, queryVector: queryAVec, apiKey: 'dummy_key' }
  );
  console.log(`RESULT A: answerable=${resA.answerable}, evidenceCount=${resA.evidence.length}\n`);

  // TEST B — Paraphrase sémantique
  console.log(">>> TEST B : Paraphrase sémantique <<<");
  const queryB = "Comment la chute a-t-elle été causée par la tromperie dans le jardin ?";
  const queryBVec = Array.from(generateDeterministicSemanticVector(queryB, 3072));
  const resB = await executeUnifiedRagPipeline(
    queryB,
    context,
    { providedChunks: corpus, queryVector: queryBVec, apiKey: 'dummy_key' }
  );
  console.log(`RESULT B: answerable=${resB.answerable}, evidenceCount=${resB.evidence.length}\n`);

  // TEST C — Hors corpus
  console.log(">>> TEST C : Hors corpus <<<");
  const queryC = "Quel est le fonctionnement des réseaux informatiques et de la fibre optique ?";
  const queryCVec = Array.from(generateDeterministicSemanticVector(queryC, 3072));
  const resC = await executeUnifiedRagPipeline(
    queryC,
    context,
    { providedChunks: corpus, queryVector: queryCVec, apiKey: 'dummy_key' }
  );
  console.log(`RESULT C: answerable=${resC.answerable}, evidenceCount=${resC.evidence.length}\n`);

  // TEST D — Transformation
  console.log(">>> TEST D : Instruction de transformation <<<");
  const queryD = "Reum c txt n 4 lgns";
  const resD = await executeUnifiedRagPipeline(
    queryD,
    context,
    { providedChunks: corpus, apiKey: 'dummy_key' }
  );
  console.log(`RESULT D: answerable=${resD.answerable}, evidenceCount=${resD.evidence.length}\n`);
}

runTests().catch(err => console.error("Test Error:", err));
