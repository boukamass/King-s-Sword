/**
 * King's Sword — Banc d'essai de la recherche sur le corpus complet
 *
 * Charge les passages exactement comme l'application (public/library.json → chunks) avec leurs vecteurs E5
 * précalculés (public/sermons_vectors.bin / .idx), puis exécute le pipeline de production sur
 * eval/questions.json (questions réelles dont le paragraphe attendu existe dans le corpus).
 *
 * Usage : npm run eval:corpus -- [mode] [limite]
 *   mode : legacy (ancien reranking pondéré) | bm25 (BM25 en tête, sans cross-encoder) | ce (BM25 en tête + cross-encoder)
 *          | all (les trois, par défaut)
 * Résultats : eval/results/full_corpus_<mode>.json
 */
import fs from 'fs';
import path from 'path';
import { extractLibrarySermonsArray, normalizeSermonsForSqlite, createLibraryChunks } from '../services/chunkingService';
import { parseBinaryIndex } from '../services/binaryVectorStorageService';
import { executeUnifiedRagPipeline } from '../services/unifiedRagService';

const ROOT = process.cwd();
// Les modèles locaux sont lus dans public/models (le dossier models/ peut être incomplet dans un clone)
(process as any).resourcesPath = path.join(ROOT, 'public');

const modeArg = process.argv[2] || 'all';
const limit = Number(process.argv[3] || 0);
const modes = modeArg === 'all' ? ['legacy', 'bm25', 'ce'] : [modeArg];

type Question = { id: string; question: string; category: string; answerable: boolean; expected_sources: Array<{ sermonId: string; paragraphIndex: number }> };

function loadCorpus() {
  const t0 = Date.now();
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'library.json'), 'utf8'));
  const sermons = normalizeSermonsForSqlite(extractLibrarySermonsArray(raw));
  const chunks: any[] = createLibraryChunks(sermons, { computeHashes: false } as any);
  const idx = parseBinaryIndex(fs.readFileSync(path.join(ROOT, 'public', 'sermons_vectors.idx')));
  const bin = fs.readFileSync(path.join(ROOT, 'public', 'sermons_vectors.bin'));
  const loc = new Map<string, { offset: number; length: number }>();
  for (const e of idx?.chunks || []) loc.set(e.chunkId, e as any);
  let attached = 0;
  for (const c of chunks) {
    const l = loc.get(c.chunkId);
    if (l) { c.embedding = new Int8Array(bin.buffer, bin.byteOffset + l.offset, l.length); attached++; }
  }
  console.log(`Corpus : ${sermons.length} sermons, ${chunks.length} passages, ${attached} vecteurs (${Date.now() - t0} ms)`);
  return chunks;
}

const isHit = (ev: any, src: { sermonId: string; paragraphIndex: number }) =>
  ev && ev.sermonId === src.sermonId && Array.isArray(ev.paragraphIds) && ev.paragraphIds.includes(src.paragraphIndex);

function summarize(rows: Array<{ category: string; rank: number; answerable: boolean; ms: number; expectedAnswerable: boolean }>) {
  const agg = (sel: typeof rows) => {
    const n = sel.length || 1;
    const at = (k: number) => Math.round(100 * sel.filter(r => r.rank <= k).length / n);
    const mrr = sel.reduce((s, r) => s + (Number.isFinite(r.rank) ? 1 / r.rank : 0), 0) / n;
    return { n: sel.length, top1: at(1), top5: at(5), top10: at(10), top24: at(24), mrr: Math.round(mrr * 1000) / 1000 };
  };
  const answerable = rows.filter(r => r.expectedAnswerable);
  const outDomain = rows.filter(r => !r.expectedAnswerable);
  return {
    toutes: agg(answerable),
    mots_cles: agg(answerable.filter(r => r.category !== 'paraphrase_semantique')),
    paraphrases: agg(answerable.filter(r => r.category === 'paraphrase_semantique')),
    refus_a_tort: answerable.filter(r => !r.answerable).length,
    hors_corpus_acceptees: outDomain.filter(r => r.answerable).length,
    hors_corpus_total: outDomain.length,
    latence_moyenne_ms: Math.round(rows.reduce((s, r) => s + r.ms, 0) / (rows.length || 1))
  };
}

const questions: Question[] = JSON.parse(fs.readFileSync(path.join(ROOT, 'eval', 'questions.json'), 'utf8'));
const selected = limit ? questions.slice(0, limit) : questions;
const chunks = loadCorpus();
const log = console.log, warn = console.warn;
fs.mkdirSync(path.join(ROOT, 'eval', 'results'), { recursive: true });

for (const mode of modes) {
  const rows: any[] = [];
  for (const q of selected) {
    console.log = () => {}; console.warn = () => {};
    const t0 = Date.now();
    let pkg: any = null;
    try {
      pkg = await executeUnifiedRagPipeline(q.question, [] as any, {
        providedChunks: chunks,
        topK: 25,
        maxEvidenceCount: 24,
        legacyRanking: mode === 'legacy',
        useCrossEncoder: mode === 'ce',
        ...(process.env.KS_MMR_LAMBDA ? { mmrLambda: Number(process.env.KS_MMR_LAMBDA) } : {})
      } as any);
    } catch (err) {
      console.log = log; console.warn = warn;
      console.error(`[${mode}] ${q.id} erreur :`, err);
      continue;
    }
    const ms = Date.now() - t0;
    console.log = log; console.warn = warn;
    const evidence = pkg?.evidence || [];
    const src = q.expected_sources?.[0];
    const idx = src ? evidence.findIndex((e: any) => isHit(e, src)) : -1;
    rows.push({ id: q.id, category: q.category, expectedAnswerable: q.answerable, answerable: Boolean(pkg?.answerable), rank: idx < 0 ? Infinity : idx + 1, ms });
    process.stdout.write(`\r[${mode}] ${rows.length}/${selected.length}`);
  }
  const summary = summarize(rows);
  fs.writeFileSync(path.join(ROOT, 'eval', 'results', `full_corpus_${mode}${process.env.KS_MMR_LAMBDA ? `_mmr${process.env.KS_MMR_LAMBDA}` : ''}.json`), JSON.stringify({ mode, date: new Date().toISOString(), summary, rows }, null, 1));
  console.log(`\n=== ${mode} ===`);
  console.log(JSON.stringify(summary, null, 1));
}
process.exit(0);
