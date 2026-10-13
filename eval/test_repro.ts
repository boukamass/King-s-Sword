import { createMockSermon470412 } from './run_phase_b_c_measurements.js';
import { executeUnifiedRagAssistantFlow } from '../services/unifiedRagIntegrationService.ts';

async function main() {
  const sermon = createMockSermon470412();
  const sermonsMap = new Map([[sermon.id, sermon]]);
  const apiKey = process.env.GEMINI_API_KEY;

  const queries = [
    "Que dit-il sur le fait de se retirer seul avec Dieu dans les montagnes ?",
    "Résume",
    "Quel rôle joue l'isolement dans la communion personnelle et le ressourcement spirituel d'un serviteur de Dieu ?"
  ];

  for (const q of queries) {
    console.log(`\n========================================`);
    console.log(`QUERY: "${q}"`);
    console.log(`========================================`);

    const result = await executeUnifiedRagAssistantFlow(q, [sermon.id], {
      loadedSermonsMap: sermonsMap,
      apiKey: apiKey
    });

    console.log(`STATUS:`, result.status);
    console.log(`EVIDENCE COUNT:`, result.evidencePackage.evidence.length);
    console.log(`EVIDENCE PARAGRAPHS TRANSMITTED:`);
    for (const ev of result.evidencePackage.evidence) {
      console.log(` - Sermon: ${ev.sermonId}, Title: ${ev.sermonTitle}, Text Len: ${ev.text?.length || 0} chars, Paras: ${ev.citationParagraphs.map(p => p.paragraphIndex).join(',')}`);
    }

    console.log(`\nRAW GEMINI ANSWER TEXT:`);
    console.log(result.answerText);

    console.log(`\nSOURCES FIELD RETURNED:`);
    console.log(JSON.stringify(result.sources, null, 2));

    console.log(`\nCLOSEST PASSAGES FIELD:`);
    console.log(JSON.stringify(result.evidencePackage.closestPassages, null, 2));
  }
}

main().catch(console.error);
