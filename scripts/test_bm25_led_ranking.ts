// Tests du classement « BM25 en tête » et du reranking cross-encoder
import { buildBm25LedOrder, rerankWithCrossEncoder, rankBm25Led } from '../services/bm25LedRankingService';
import { rerankHybridResults } from '../services/rerankingService';
import { scoreWithCrossEncoder } from '../services/crossEncoderService';

let failures = 0;
let passed = 0;
const check = (name: string, cond: any, extra?: any) => {
  if (cond) { passed++; console.log('✓', name); }
  else { failures++; console.log('✗', name, extra ?? ''); }
};

// 1. Ordre BM25 en tête
const order = buildBm25LedOrder(['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7'], ['v1', 'b6', 'v2', 'b1'], 5, 60);
check('les 5 premiers BM25 restent en tête, dans leur ordre', order.slice(0, 5).join(',') === 'b1,b2,b3,b4,b5', order);
check('un passage BM25 également trouvé par E5 remonte dans la suite', order.indexOf('b6') === 5, order);
check('les passages E5 seuls sont inclus', order.includes('v1') && order.includes('v2'));
check('aucun doublon', new Set(order).size === order.length);
check('tête plus courte si BM25 a moins de résultats', buildBm25LedOrder(['b1'], ['v1', 'v2'], 5).join(',') === 'b1,v1,v2');

// 2. Repli sans cross-encoder : l'ordre est conservé
const items = [{ text: 'a' }, { text: 'b' }, { text: 'c' }];
const noPool = await rerankWithCrossEncoder('q', items, { poolSize: 1, maxLength: 64, timeoutMs: 1000, weight: 1 });
check('bassin trop petit : ordre inchangé, cross-encoder non utilisé', !noPool.usedCrossEncoder && noPool.ordered === items);

// 3. Score de rang conservé par rerankHybridResults (preserveOrder)
const mk = (id: string, lexicalRank: number | null, vectorRank: number | null): any => ({
  chunkId: id, sermonId: 'S', paragraphIds: [1], startParagraph: 1, endParagraph: 1, text: `texte ${id}`,
  sermonTitle: 'T', lexicalRank, lexicalScore: lexicalRank ? 50 - lexicalRank : null, vectorRank, vectorScore: vectorRank ? 0.9 : null,
  rrfScore: 0.01, rank: 0
});
const hybrid = [mk('z', null, 1), mk('a', 1, null), mk('m', 2, 2)];
const kept = rerankHybridResults({ query: 'texte', hybridResults: hybrid, preserveOrder: true, options: { topK: 10 } });
check('preserveOrder : ordre reçu conservé', kept.map(k => k.chunkId).join(',') === 'z,a,m', kept.map(k => k.chunkId));
check('preserveOrder : score de rang strictement décroissant', kept[0].rerankScore > kept[1].rerankScore && kept[1].rerankScore > kept[2].rerankScore);
const legacy = rerankHybridResults({ query: 'texte', hybridResults: hybrid, options: { topK: 10 } });
check('sans preserveOrder : ancien tri pondéré inchangé', legacy[0].chunkId === 'm', legacy.map(k => k.chunkId));

// 4. rankBm25Led sans cross-encoder
const ranked = await rankBm25Led('texte', hybrid, ['a', 'm'], ['z', 'm'], {
  headCount: 1, k: 60, useCrossEncoder: false,
  crossEncoder: { poolSize: 40, maxLength: 256, timeoutMs: 1000, weight: 1 }
});
check('rankBm25Led : tête BM25 puis fusion', ranked.ordered[0].chunkId === 'a' && ranked.ordered.length === 3 && !ranked.usedCrossEncoder, ranked.ordered.map(h => h.chunkId));

// 5. Cross-encoder réel (si le modèle est présent dans models/)
const scores = await scoreWithCrossEncoder('Que portait le cavalier sur le cheval blanc ?', [
  'Le boulanger prépare le pain du matin.',
  "Il avait un arc, mais pas de flèche. C'est le grand bluff religieux."
], { timeoutMs: 60000 });
if (scores) {
  check('cross-encoder : le passage pertinent obtient le meilleur score', scores[1] > scores[0], scores);
  const re = await rerankWithCrossEncoder('Que portait le cavalier sur le cheval blanc ?', [
    { text: 'Le boulanger prépare le pain du matin.' },
    { text: "Il avait un arc, mais pas de flèche. C'est le grand bluff religieux." }
  ], { poolSize: 40, maxLength: 256, timeoutMs: 60000, weight: 1 });
  check('cross-encoder : passage pertinent remonté en tête', re.usedCrossEncoder && re.ordered[0].text.startsWith('Il avait un arc'));
} else {
  console.log('(cross-encoder absent : tests du modèle ignorés — lancez `node scripts/fetch-model.mjs`)');
}

console.log(failures === 0 ? `\n${passed} test(s) réussi(s).` : `\n${failures} échec(s), ${passed} réussi(s).`);
process.exit(failures === 0 ? 0 : 1);
