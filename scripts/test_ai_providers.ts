// Tests du connecteur multi-fournisseur avec un faux serveur compatible OpenAI (aucun appel réseau réel)
const store: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => (k in store ? store[k] : null),
  setItem: (k: string, v: string) => { store[k] = String(v); },
  removeItem: (k: string) => { delete store[k]; }
};

import { generateNewRagResponse, stripJsonCodeFence } from '../services/generationAdapter';
import { buildChatMessages, pickPreferredModels, AI_PROVIDERS, testProviderApiKey, getAiFeatureKeys, getAiFeatureKey, createAiClient } from '../services/aiProviderService';
import { setActiveAiProvider, setProviderApiKey, getActiveAiProvider, hasActiveAiKey, setGeminiApiKey, getGeminiApiKey } from '../utils/apiKeyHelper';

let failures = 0;
const check = (name: string, cond: any, extra?: any) => {
  if (cond) console.log('  OK  ', name);
  else { failures++; console.log('  FAIL', name, extra ?? ''); }
};

const answerJson = {
  answerability: true,
  summary: 'Le cavalier portait un arc sans flèche.',
  arguments: [{ pointTitle: 'Le bluff', explanation: 'Explication.', citations: [{ sourceId: '63-0318-SHP', paragraphIndex: 2, exactQuote: 'Il avait un arc' }] }],
  deepDiveQuestions: ['Q1 ?']
};

// Faux serveur : /models, /chat/completions (normal + flux SSE), scénarios d'erreur
let scenario = 'ok';
let lastBody: any = null;
let calls: string[] = [];
(globalThis as any).fetch = async (url: string, init: any = {}) => {
  calls.push(`${init.method || 'GET'} ${url}`);
  const auth = init.headers?.Authorization || '';
  if (auth.includes('bad')) return new Response(JSON.stringify({ error: { message: 'Invalid API Key' } }), { status: 401 });
  if (url.endsWith('/models')) {
    return new Response(JSON.stringify({ data: [{ id: 'whisper-large-v3' }, { id: 'llama-3.3-70b-versatile' }, { id: 'openai/gpt-oss-120b' }, { id: 'mistral-small-2503' }, { id: 'mistral-large-latest' }, { id: 'mistral-large-2411' }] }), { status: 200 });
  }
  lastBody = JSON.parse(init.body);
  if (scenario === 'json400' && lastBody.response_format) return new Response(JSON.stringify({ error: { message: 'response_format json_object not supported' } }), { status: 400 });
  if (scenario === 'quota' && auth.includes('k1')) return new Response(JSON.stringify({ error: { message: 'Rate limit' } }), { status: 429 });
  const content = scenario === 'fenced' ? '```json\n' + JSON.stringify(answerJson) + '\n```' : JSON.stringify(answerJson);
  if (lastBody.stream) {
    const pieces = content.match(/.{1,25}/gs)!;
    const lines = pieces.map(p => `data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`);
    lines.unshift(': OPENROUTER PROCESSING\n\n');
    lines.push(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } })}\n\n`);
    lines.push('data: [DONE]\n\n');
    const enc = new TextEncoder();
    const stream = new ReadableStream({ start(c) { for (const l of lines) c.enqueue(enc.encode(l)); c.close(); } });
    return new Response(stream, { status: 200 });
  }
  return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } }), { status: 200 });
};

const evidencePackage: any = {
  answerable: true, confidenceScore: 0.9, reason: '', query: 'arc', totalCandidates: 1, rejectedCount: 0,
  evidence: [{
    chunkId: '63-0318-SHP_c1_p2_p2', sermonId: '63-0318-SHP', sermonTitle: 'Le premier sceau', paragraphIds: [2], startParagraph: 2, endParagraph: 2,
    text: '2. Il avait un arc, mais pas de flèche.', date: '1963-03-18', city: 'Jeffersonville', version: 'SHP', retrievalScore: 1, rank: 1, sourceType: 'reranked',
    citationParagraphs: [{ paragraphIndex: 2, textSnippet: 'Il avait un arc, mais pas de flèche.', fullParagraphText: '2. Il avait un arc, mais pas de flèche.' }]
  }]
};

console.log('1. Réglages et clés');
check('fournisseur par défaut = gemini', getActiveAiProvider() === 'gemini');
await setProviderApiKey('groq', 'gsk_k1\ngsk_k2');
await setActiveAiProvider('groq');
check('fournisseur actif = groq', getActiveAiProvider() === 'groq');
check('clé active détectée', hasActiveAiKey());

console.log('2. Conversion des messages et choix du modèle');
const msgs = buildChatMessages([{ role: 'user', parts: [{ text: 'SOURCES' }] }, { role: 'model', parts: [{ text: 'reçu' }] }, { role: 'user', parts: [{ text: 'Q' }] }], { systemInstruction: 'SYS', responseMimeType: 'application/json', responseSchema: { type: 'OBJECT', properties: { a: { type: 'BOOLEAN' } } } });
check('rôles system/user/assistant/user', msgs.map(m => m.role).join(',') === 'system,user,assistant,user', msgs.map(m => m.role));
check('consigne JSON + squelette ajoutés', msgs[0].content.includes('FORMAT DE SORTIE') && msgs[0].content.includes('"a"'));
const ids = ['whisper-large-v3', 'llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'mistral-small-2503', 'mistral-large-latest', 'mistral-large-2411'];
check('groq : gpt-oss-120b en premier, whisper exclu', pickPreferredModels(AI_PROVIDERS.groq, ids)[0] === 'openai/gpt-oss-120b' && !pickPreferredModels(AI_PROVIDERS.groq, ids).includes('whisper-large-v3'));
check('mistral : alias latest préféré', pickPreferredModels(AI_PROVIDERS.mistral, ids)[0] === 'mistral-large-latest');
check('openrouter : modèles :free uniquement', pickPreferredModels(AI_PROVIDERS.openrouter, ['a/b', 'meta-llama/llama-3.3-70b-instruct:free'])[0] === 'meta-llama/llama-3.3-70b-instruct:free');
check('stripJsonCodeFence', stripJsonCodeFence('```json\n{"x":1}\n```') === '{"x":1}' && stripJsonCodeFence('Voici : {"x":1} merci') === '{"x":1}');

console.log('3. Génération complète (sans flux)');
scenario = 'ok'; calls = [];
let r = await generateNewRagResponse({ query: 'Que portait le cavalier ?', evidencePackage });
check('statut success', r.status === 'success', r.errorMessage);
check('provider = groq', r.provider === 'groq');
check('modèle résolu = gpt-oss-120b', r.model === 'openai/gpt-oss-120b', r.model);
check('réponse contient la synthèse', (r.answerText || '').includes('arc sans flèche'));
check('format JSON demandé', lastBody.response_format?.type === 'json_object');
check('jetons mesurés', r.usageMetadata?.totalTokenCount === 150);

console.log('4. Génération en flux (affichage progressif)');
let partials = 0;
r = await generateNewRagResponse({ query: 'Que portait le cavalier ?', evidencePackage, onPartialAnswer: () => { partials++; } });
check('statut success (flux)', r.status === 'success', r.errorMessage);
check('requête en flux', lastBody.stream === true);
check('réponses partielles reçues', partials > 0, partials);

console.log('5. Réponse entourée de ```json');
scenario = 'fenced';
r = await generateNewRagResponse({ query: 'Que portait le cavalier ?', evidencePackage });
check('JSON lu malgré le bloc de code', r.status === 'success' && !!r.structuredResponse, r.errorCode);

console.log('6. Modèle qui refuse response_format');
scenario = 'json400';
r = await generateNewRagResponse({ query: 'Que portait le cavalier ?', evidencePackage });
check('nouvelle tentative sans response_format', r.status === 'success' && !lastBody.response_format, r.errorMessage);

console.log('7. Quota épuisé sur la 1re clé → bascule sur la 2e');
scenario = 'quota'; calls = [];
r = await generateNewRagResponse({ query: 'Que portait le cavalier ?', evidencePackage });
check('succès avec la 2e clé', r.status === 'success', r.errorMessage);

console.log('8. Clé absente');
await setProviderApiKey('groq', '');
r = await generateNewRagResponse({ query: 'Q', evidencePackage });
check('API_KEY_MISSING', r.errorCode === 'API_KEY_MISSING' && (r.errorMessage || '').includes('Groq'), r.errorMessage);

console.log('9. Test de clé (bouton « Tester la clé »)');
scenario = 'ok';
let t = await testProviderApiKey('mistral', 'good-key');
check('clé valide', t.success && t.message.includes('mistral-large-latest'), t.message);
t = await testProviderApiKey('mistral', 'bad-key');
check('clé refusée', !t.success && t.errorType === 'INVALID_KEY', t.message);

console.log('10. Gemini actif : aucun appel au connecteur OpenAI');
await setActiveAiProvider('gemini'); calls = [];
const fakeGemini: any = { generateContent: async () => ({ text: JSON.stringify(answerJson), candidates: [{ finishReason: 'STOP' }] }) };
r = await generateNewRagResponse({ query: 'Q', evidencePackage, geminiClient: fakeGemini });
check('Gemini inchangé (provider google-gemini)', r.status === 'success' && r.provider === 'google-gemini');
check('aucun fetch vers un autre fournisseur', calls.length === 0, calls);

console.log('11. Fonctions annexes (dictionnaire, Strong, analyse de sélection)');
await setGeminiApiKey('AIzaFakeGeminiKey123');
check("Gemini actif : clé Gemini d'origine", getAiFeatureKey() === getGeminiApiKey() && getAiFeatureKeys()[0] === 'AIzaFakeGeminiKey123');
await setProviderApiKey('mistral', 'good-key');
await setActiveAiProvider('mistral');
const fk = getAiFeatureKey()!;
check("Mistral actif : la clé Gemini n'est pas utilisée", !fk.includes('AIza') && getAiFeatureKeys().length === 1);
scenario = 'ok'; calls = [];
const resp = await createAiClient(fk).models.generateContent({ model: 'gemini-3.8-flash', contents: 'Définis : grâce', config: { responseMimeType: 'application/json' } });
check('réponse lue via .text', typeof resp.text === 'string' && resp.text.includes('answerability'));
check('appel envoyé à Mistral', calls.some(c => c.includes('api.mistral.ai')), calls);
await setProviderApiKey('mistral', '');
check('Mistral sans clé : repli sur Gemini', getAiFeatureKey() === getGeminiApiKey());

console.log(failures === 0 ? '\nTOUS LES TESTS RÉUSSIS' : `\n${failures} ÉCHEC(S)`);
process.exit(failures === 0 ? 0 : 1);
