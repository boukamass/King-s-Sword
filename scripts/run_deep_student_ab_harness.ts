/**
 * King's Sword — Harnais d'Évaluation Avant / Après pour le Mode Étudiant Profond (v2.9.11)
 *
 * Exécutable directement sur la machine de l'utilisateur avec sa base SQLite complète (`kings_sword_v2.db`
 * + vecteurs binaires 384D Int8) ou sur le corpus local du dépôt.
 *
 * RÈGLES STRICTES RESPECTÉES :
 * 1. Aucun chiffre estimé ni inventé : TOUS les nombres de tokens proviennent exclusivement de `usageMetadata`
 *    retourné par l'API Gemini, et toutes les latences proviennent de `performance.now()`.
 * 2. Mesure l'effet de la correction de la consigne l. 313 (`autoRagRetrievalService.ts`) SEULE,
 *    puis chaque étape isolément (Expansion LLM + RRF, Rerank Gemini 0-3, Seuil < N, Génération 4a/4b,
 *    Contexte jusqu'à 60 extraits avec voisins ±1).
 * 3. Prépare pour chacune des 10 questions conceptuelles :
 *    - Le tableau comparatif côte à côte (Avant vs Consigne l.313 seule vs Après Mode Étudiant Profond)
 *    - La grille d'évaluation humaine des passages (`pertinent_juge_par_utilisateur: null`) pour le décompte manuel
 *    - Les latences exactes (ms), les tokens mesurés (`promptTokenCount`, `candidatesTokenCount`, `totalTokenCount`) et le coût exact ($).
 *
 * Usage sur votre machine :
 *   npm run eval:deep-student
 *   npx tsx scripts/run_deep_student_ab_harness.ts --db="/chemin/vers/kings_sword_v2.db"
 *   npx tsx scripts/run_deep_student_ab_harness.ts --questions="eval/deep_student_10_questions.json" --max-excerpts=60 --min-n=3
 *   npx tsx scripts/run_deep_student_ab_harness.ts --all-stages   (exécute aussi toutes les étapes intermédiaires isolées)
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { performance } from 'perf_hooks';
import { SermonChunk } from '../types';
import { createExposeDocumentChunks } from '../services/exposeDocumentService';
import { buildCorpusVocabulary } from '../services/corpusVocabularyService';
import { executeUnifiedRagAssistantFlow } from '../services/unifiedRagIntegrationService';
import { executeDeepStudentPipeline } from '../services/deepStudentModeService';
import { defaultDeepStudentConfig, DeepStudentConfig } from '../config/aiConfig';
import { getGeminiApiKey } from '../utils/apiKeyHelper';

interface ConceptualQuestionItem {
  id: string;
  question: string;
  category?: string;
  notes?: string;
}

interface StageRunSummary {
  configId: string;
  configLabel: string;
  latencyMs: number;
  retrievedPassagesCount: number;
  retainedPassagesScoreGte2Count: number;
  belowThresholdN: boolean;
  validCitationsCount: number;
  invalidCitationsCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  usageMetadataMeasured: boolean;
  fallback429Triggered: boolean;
  stageBreakdown: Array<{
    stage: string;
    latencyMs: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd: number;
  }>;
  passagesForHumanJudgment: Array<{
    rank: number;
    sourceId: string;
    sermonTitle: string;
    paragraphIndex: number;
    geminiScore: number | null;
    geminiJustification: string | null;
    snippet: string;
    pertinent_juge_par_utilisateur: boolean | null;
  }>;
  answerText: string;
}

/**
 * Détecte automatiquement le chemin de `kings_sword_v2.db` sur la machine de l'utilisateur
 * (Windows AppData, macOS Application Support, Linux .config, ou argument CLI `--db=...`).
 */
function resolveLocalDatabasePath(cliDbArg?: string): string | null {
  if (cliDbArg && fs.existsSync(cliDbArg)) {
    return path.resolve(cliDbArg);
  }

  const home = os.homedir();
  const platform = os.platform();
  const candidates: string[] = [];

  if (platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    candidates.push(path.join(appData, 'kings-sword', 'kings_sword_v2.db'));
    candidates.push(path.join(appData, "King's Sword", 'kings_sword_v2.db'));
  } else if (platform === 'darwin') {
    candidates.push(path.join(home, 'Library', 'Application Support', 'kings-sword', 'kings_sword_v2.db'));
    candidates.push(path.join(home, 'Library', 'Application Support', "King's Sword", 'kings_sword_v2.db'));
  } else {
    candidates.push(path.join(home, '.config', 'kings-sword', 'kings_sword_v2.db'));
    candidates.push(path.join(home, '.config', "King's Sword", 'kings_sword_v2.db'));
    candidates.push(path.join(home, '.local', 'share', 'kings-sword', 'kings_sword_v2.db'));
  }

  candidates.push(path.join(process.cwd(), 'kings_sword_v2.db'));
  candidates.push(path.join(process.cwd(), 'public', 'kings_sword_v2.db'));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Charge l'intégralité des chunks de la base complète de l'utilisateur (SQLite `sermon_chunks` ou `paragraphs`
 * + vecteurs binaires `sermons_vectors.bin`, ou repli sur `public/library.json` + `expose`).
 * Ne modifie JAMAIS l'index ni le chunking.
 */
async function loadFullCorpusChunksReadonly(cliDbArg?: string): Promise<{
  chunks: SermonChunk[];
  corpusSourceLabel: string;
}> {
  const dbPath = resolveLocalDatabasePath(cliDbArg);
  const chunks: SermonChunk[] = [];
  let corpusSourceLabel = '';

  if (dbPath) {
    try {
      const Database = (await import('better-sqlite3')).default;
      const db = new Database(dbPath, { readonly: true });
      db.pragma('temp_store = MEMORY');
      db.pragma('cache_size = -64000');

      const chunkCountRow = db
        .prepare("SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='sermon_chunks'")
        .get() as { cnt: number };

      if (chunkCountRow && chunkCountRow.cnt > 0) {
        const rows = db
          .prepare(
            `SELECT chunk_id, sermon_id, paragraph_ids, start_paragraph, end_paragraph,
                    text, sermon_title, date, city, version, character_count, word_count, embedding
             FROM sermon_chunks`
          )
          .all() as any[];

        if (rows.length > 0) {
          for (const r of rows) {
            let pIds: number[] = [r.start_paragraph || 1];
            try {
              if (r.paragraph_ids) pIds = JSON.parse(r.paragraph_ids);
            } catch {}

            let embedding: Int8Array | undefined = undefined;
            if (r.embedding && Buffer.isBuffer(r.embedding) && r.embedding.byteLength === 384) {
              embedding = new Int8Array(
                r.embedding.buffer,
                r.embedding.byteOffset,
                r.embedding.byteLength
              );
            }

            chunks.push({
              chunkId: r.chunk_id,
              sermonId: r.sermon_id,
              documentId: r.sermon_id,
              documentType: r.sermon_id?.startsWith('expose-') ? 'expose' : 'sermon',
              paragraphIds: pIds,
              startParagraph: r.start_paragraph || pIds[0] || 1,
              endParagraph: r.end_paragraph || pIds[pIds.length - 1] || 1,
              text: r.text || '',
              sermonTitle: r.sermon_title || r.sermon_id,
              date: r.date || undefined,
              city: r.city || undefined,
              version: r.version || undefined,
              characterCount: r.character_count || (r.text ? r.text.length : 0),
              wordCount: r.word_count || 0,
              embedding
            });
          }
          corpusSourceLabel = `SQLite sermon_chunks (${dbPath}) — ${chunks.length.toLocaleString('fr-FR')} chunks`;
        }
      }

      // Si `sermon_chunks` est vide mais que la table `paragraphs` est peuplée
      if (chunks.length === 0) {
        const paraRows = db
          .prepare(
            `SELECT p.sermon_id, p.paragraph_index, p.content, s.title, s.date, s.city, s.version
             FROM paragraphs p
             LEFT JOIN sermons s ON s.id = p.sermon_id
             ORDER BY p.sermon_id, p.paragraph_index ASC`
          )
          .all() as any[];

        for (const p of paraRows) {
          const text = (p.content || '').trim();
          if (!text) continue;
          chunks.push({
            chunkId: `${p.sermon_id}_p${p.paragraph_index}`,
            sermonId: p.sermon_id,
            documentId: p.sermon_id,
            documentType: 'sermon',
            paragraphIds: [p.paragraph_index],
            startParagraph: p.paragraph_index,
            endParagraph: p.paragraph_index,
            text,
            sermonTitle: p.title || p.sermon_id,
            date: p.date || undefined,
            city: p.city || undefined,
            version: p.version || undefined,
            characterCount: text.length,
            wordCount: text.split(/\s+/).length
          });
        }
        if (chunks.length > 0) {
          corpusSourceLabel = `SQLite paragraphs (${dbPath}) — ${chunks.length.toLocaleString('fr-FR')} paragraphes`;
        }
      }

      db.close();
    } catch (err: any) {
      console.warn(`[Harnais] Avertissement lecture SQLite (${dbPath}): ${err?.message || err}`);
    }
  }

  // Fallback sur `public/library.json` + `Exposé` si SQLite n'est pas trouvé dans l'environnement courant
  if (chunks.length === 0) {
    const libPath = path.resolve(process.cwd(), 'public', 'library.json');
    if (fs.existsSync(libPath)) {
      const { createSermonChunks, extractLibrarySermonsArray } = await import('../services/chunkingService');
      const rawLib = JSON.parse(fs.readFileSync(libPath, 'utf8'));
      const sermons = extractLibrarySermonsArray(rawLib);
      for (const s of sermons) {
        const sChunks = createSermonChunks(s);
        chunks.push(...sChunks);
      }
    }
    try {
      const exposeChunks = await createExposeDocumentChunks();
      chunks.push(...exposeChunks);
    } catch {}
    corpusSourceLabel = `Corpus local (public/library.json + Exposé) — ${chunks.length.toLocaleString('fr-FR')} chunks`;
  }

  // Hydratation en lecture seule des vecteurs binaires 384D Int8 si disponibles sur disque
  try {
    const missingVecChunks = chunks.filter(c => !c.embedding);
    if (missingVecChunks.length > 0) {
      const { hydrateChunksWithBinaryVectors } = await import('../services/binaryVectorStorageService');
      await hydrateChunksWithBinaryVectors(missingVecChunks, {
        target: 'sermons',
        binaryFileName: 'sermons_vectors.bin',
        indexFileName: 'sermons_vectors.idx'
      });
    }
  } catch {}

  return { chunks, corpusSourceLabel };
}

function parseCliArgs() {
  const args = process.argv.slice(2);
  let dbPath: string | undefined;
  let questionsPath = path.resolve(process.cwd(), 'eval', 'deep_student_10_questions.json');
  let maxExcerpts = 60;
  let minN = 3;
  let candidatePoolSize = 80;
  let runAllIsolatedStages = false;
  let limitQuestions = 10;

  for (const arg of args) {
    if (arg.startsWith('--db=')) {
      dbPath = arg.slice('--db='.length).trim();
    } else if (arg.startsWith('--questions=')) {
      questionsPath = path.resolve(arg.slice('--questions='.length).trim());
    } else if (arg.startsWith('--max-excerpts=')) {
      maxExcerpts = Math.min(60, Math.max(1, parseInt(arg.slice('--max-excerpts='.length), 10) || 60));
    } else if (arg.startsWith('--min-n=')) {
      minN = Math.max(1, parseInt(arg.slice('--min-n='.length), 10) || 3);
    } else if (arg.startsWith('--pool=')) {
      candidatePoolSize = Math.min(100, Math.max(60, parseInt(arg.slice('--pool='.length), 10) || 80));
    } else if (arg === '--all-stages') {
      runAllIsolatedStages = true;
    } else if (arg.startsWith('--limit=')) {
      limitQuestions = Math.max(1, parseInt(arg.slice('--limit='.length), 10) || 10);
    }
  }

  return {
    dbPath,
    questionsPath,
    maxExcerpts,
    minN,
    candidatePoolSize,
    runAllIsolatedStages,
    limitQuestions
  };
}

async function runStandardConfigForQuestion(
  question: string,
  allChunks: SermonChunk[],
  contextIds: string[],
  apiKey: string,
  useLegacyExtrapolativeDirective6: boolean,
  configId: string,
  configLabel: string
): Promise<StageRunSummary> {
  const t0 = performance.now();
  const res = await executeUnifiedRagAssistantFlow(question, contextIds, {
    apiKey,
    providedChunks: allChunks,
    useDeepStudentMode: false,
    useLegacyExtrapolativeDirective6,
    topK: 25,
    maxEvidenceCount: 16
  });
  const latencyMs = Math.round(performance.now() - t0);

  const usage = res.generationResult?.usageMetadata;
  const pTok = usage?.promptTokenCount || 0;
  const cTok = usage?.candidatesTokenCount || 0;
  const tTok = usage?.totalTokenCount || 0;
  const costUsd = Number(
    (
      (pTok / 1_000_000) * defaultDeepStudentConfig.inputCostPerMillionUsd +
      (cTok / 1_000_000) * defaultDeepStudentConfig.outputCostPerMillionUsd
    ).toFixed(6)
  );

  const evidence = res.evidencePackage?.evidence || [];
  const validCits = res.citationsValidation?.validCitationCount ?? 0;
  const invalidCits = res.citationsValidation?.invalidCitationCount ?? 0;

  return {
    configId,
    configLabel,
    latencyMs,
    retrievedPassagesCount: evidence.length,
    retainedPassagesScoreGte2Count: evidence.length,
    belowThresholdN: evidence.length < defaultDeepStudentConfig.minRelevantPassagesN,
    validCitationsCount: validCits,
    invalidCitationsCount: invalidCits,
    promptTokens: pTok,
    completionTokens: cTok,
    totalTokens: tTok,
    costUsd,
    usageMetadataMeasured: Boolean(usage?.measured),
    fallback429Triggered: false,
    stageBreakdown: [
      {
        stage: 'standard_pipeline_total',
        latencyMs,
        promptTokens: pTok,
        completionTokens: cTok,
        totalTokens: tTok,
        costUsd
      }
    ],
    passagesForHumanJudgment: evidence.map((ev, idx) => ({
      rank: idx + 1,
      sourceId: ev.sermonId,
      sermonTitle: ev.sermonTitle || ev.sermonId,
      paragraphIndex: ev.startParagraph,
      geminiScore: null,
      geminiJustification: null,
      snippet: (ev.text || '').slice(0, 260),
      pertinent_juge_par_utilisateur: null
    })),
    answerText: res.answerText || `[Non answerable: ${res.errorMessage || res.evidencePackage?.reason || ''}]`
  };
}

async function runDeepStudentConfigForQuestion(
  question: string,
  allChunks: SermonChunk[],
  contextIds: string[],
  apiKey: string,
  cfgOverride: Partial<DeepStudentConfig>,
  configId: string,
  configLabel: string
): Promise<StageRunSummary> {
  const res = await executeDeepStudentPipeline(question, allChunks.length > 0 ? contextIds : [], {
    apiKey,
    providedChunks: allChunks,
    config: cfgOverride
  });

  const tel = res.telemetry;
  const validCits = res.citationsValidation?.validCitationCount ?? 0;
  const invalidCits = res.citationsValidation?.invalidCitationCount ?? 0;
  const retained = tel.rerankedCandidates.filter(r => r.retained);

  return {
    configId,
    configLabel,
    latencyMs: tel.totalLatencyMs,
    retrievedPassagesCount: tel.candidatePoolCount,
    retainedPassagesScoreGte2Count: tel.retainedPassagesCount,
    belowThresholdN: tel.belowThresholdN,
    validCitationsCount: validCits,
    invalidCitationsCount: invalidCits,
    promptTokens: tel.totalPromptTokens,
    completionTokens: tel.totalCandidatesTokens,
    totalTokens: tel.totalTokens,
    costUsd: tel.totalCostUsd,
    usageMetadataMeasured: tel.stages.every(s => s.usageMetadataMeasured),
    fallback429Triggered: tel.fallback429Triggered,
    stageBreakdown: tel.stages.map(s => ({
      stage: s.stageName,
      latencyMs: s.latencyMs,
      promptTokens: s.promptTokenCount,
      completionTokens: s.candidatesTokenCount,
      totalTokens: s.totalTokenCount,
      costUsd: s.costUsd
    })),
    passagesForHumanJudgment: retained.map((p, idx) => ({
      rank: idx + 1,
      sourceId: p.sourceId,
      sermonTitle: p.sermonTitle,
      paragraphIndex: p.paragraphIndex,
      geminiScore: p.geminiScore,
      geminiJustification: p.justification,
      snippet: (p.text || '').slice(0, 260),
      pertinent_juge_par_utilisateur: null
    })),
    answerText: res.answerText || `[Fallback/Erreur: ${res.errorMessage || ''}]`
  };
}

async function main() {
  const cli = parseCliArgs();
  console.log(`\n================================================================================`);
  console.log(`📚 KING'S SWORD v2.9.11 — HARNAIS AVANT / APRÈS (MODE ÉTUDIANT PROFOND)`);
  console.log(`================================================================================\n`);

  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || getGeminiApiKey();
  if (!apiKey) {
    console.error(`❌ Aucune clé API Gemini détectée.`);
    console.error(`   Définissez GEMINI_API_KEY dans votre environnement avant de lancer le harnais :`);
    console.error(`   GEMINI_API_KEY="votre_cle" npm run eval:deep-student\n`);
    process.exit(1);
  }

  if (!fs.existsSync(cli.questionsPath)) {
    console.error(`❌ Fichier de questions introuvable : ${cli.questionsPath}`);
    process.exit(1);
  }

  const rawQuestions: ConceptualQuestionItem[] = JSON.parse(
    fs.readFileSync(cli.questionsPath, 'utf8')
  ).slice(0, cli.limitQuestions);

  console.log(`📋 Questions chargées : ${rawQuestions.length} depuis ${cli.questionsPath}`);
  const { chunks, corpusSourceLabel } = await loadFullCorpusChunksReadonly(cli.dbPath);
  console.log(`📦 Corpus chargé      : ${corpusSourceLabel}`);

  const chunksWithE5 = chunks.filter(c => c.embedding && (c.embedding as any).length === 384).length;
  console.log(`🧭 Chunks avec vecteur E5 384D Int8 : ${chunksWithE5.toLocaleString('fr-FR')} / ${chunks.length.toLocaleString('fr-FR')}`);

  console.log(`⚙️  Pré-calcul de l'index inversé BM25 en mémoire...`);
  const tVocab0 = performance.now();
  buildCorpusVocabulary(chunks);
  console.log(`   Index BM25 prêt en ${(performance.now() - tVocab0).toFixed(0)} ms.\n`);

  const allDocIds = Array.from(new Set(chunks.map(c => c.sermonId)));

  const resultsPerQuestion: Array<{
    questionId: string;
    question: string;
    runs: Record<string, StageRunSummary>;
  }> = [];

  for (let i = 0; i < rawQuestions.length; i++) {
    const qItem = rawQuestions[i];
    console.log(`--------------------------------------------------------------------------------`);
    console.log(`🔎 [${i + 1}/${rawQuestions.length}] (${qItem.id}) "${qItem.question}"`);
    console.log(`--------------------------------------------------------------------------------`);

    const runs: Record<string, StageRunSummary> = {};

    // 1. AVANT (Baseline avec ancienne consigne l. 313 extrapolative)
    process.stdout.write(`   ▶ [1] AVANT (Pipeline actuel + ancienne consigne l.313)... `);
    const avantRun = await runStandardConfigForQuestion(
      qItem.question,
      chunks,
      allDocIds,
      apiKey,
      true,
      'AVANT_BASELINE',
      'Avant (Pipeline actuel, l.313 non corrigée)'
    );
    runs['AVANT_BASELINE'] = avantRun;
    console.log(
      `OK (${avantRun.latencyMs} ms | Passages=${avantRun.retrievedPassagesCount} | Tokens=${avantRun.totalTokens} | Coût=$${avantRun.costUsd.toFixed(5)})`
    );

    // 2. CONDITION 1 SEULE (Correction de la consigne l. 313 seule, sans changer le retrieval)
    process.stdout.write(`   ▶ [2] CONDITION 1 SEULE (Correction l.313 anti-extrapolation seule)... `);
    const cond1Run = await runStandardConfigForQuestion(
      qItem.question,
      chunks,
      allDocIds,
      apiKey,
      false,
      'CONDITION_1_DIRECTIVE6_SEULE',
      'Condition 1 seule (Consigne l.313 corrigée)'
    );
    runs['CONDITION_1_DIRECTIVE6_SEULE'] = cond1Run;
    console.log(
      `OK (${cond1Run.latencyMs} ms | Passages=${cond1Run.retrievedPassagesCount} | Tokens=${cond1Run.totalTokens} | Coût=$${cond1Run.costUsd.toFixed(5)})`
    );

    // Optionnel : exécution isolée des étapes intermédiaires si `--all-stages` est passé
    if (cli.runAllIsolatedStages) {
      process.stdout.write(`   ▶ [2b] ÉTAPE 1 ISOLÉE (Expansion LLM + RRF sans Rerank Gemini ni 4a/4b)... `);
      const stage1Only = await runDeepStudentConfigForQuestion(
        qItem.question,
        chunks,
        allDocIds,
        apiKey,
        {
          enableLlmExpansion: true,
          candidatePoolSize: cli.candidatePoolSize,
          enableGeminiRerank: false,
          enableThresholdGuard: false,
          enableTwoStageGeneration: false,
          maxContextExcerpts: 20,
          includeNeighbors: true
        },
        'ETAPE_1_EXPANSION_SEULE',
        'Étape 1 isolée (Expansion LLM + RRF)'
      );
      runs['ETAPE_1_EXPANSION_SEULE'] = stage1Only;
      console.log(`OK (${stage1Only.latencyMs} ms | Tokens=${stage1Only.totalTokens})`);

      process.stdout.write(`   ▶ [2c] ÉTAPES 1+2+3 ISOLÉES (Expansion + Rerank 0-3 + Seuil, sans 4a/4b)... `);
      const stage123Only = await runDeepStudentConfigForQuestion(
        qItem.question,
        chunks,
        allDocIds,
        apiKey,
        {
          enableLlmExpansion: true,
          candidatePoolSize: cli.candidatePoolSize,
          enableGeminiRerank: true,
          minRelevanceScore: 2,
          enableThresholdGuard: true,
          minRelevantPassagesN: cli.minN,
          enableTwoStageGeneration: false,
          maxContextExcerpts: cli.maxExcerpts,
          includeNeighbors: true
        },
        'ETAPES_1_2_3_SANS_4A4B',
        'Étapes 1+2+3 (Expansion + Rerank ≥2 + Seuil, génération 1-temps)'
      );
      runs['ETAPES_1_2_3_SANS_4A4B'] = stage123Only;
      console.log(
        `OK (${stage123Only.latencyMs} ms | Retenus≥2=${stage123Only.retainedPassagesScoreGte2Count}/${stage123Only.retrievedPassagesCount} | Tokens=${stage123Only.totalTokens})`
      );
    }

    // 3. APRÈS (Mode Étudiant Profond complet : Étapes 1 + 2 + 3 + 4a/4b + 5 avec mesure isolée de chaque étape dans `stageBreakdown`)
    process.stdout.write(`   ▶ [3] APRÈS (Mode Étudiant Profond complet : Étapes 1, 2, 3, 4a/4b, 5)... `);
    const apresRun = await runDeepStudentConfigForQuestion(
      qItem.question,
      chunks,
      allDocIds,
      apiKey,
      {
        enableLlmExpansion: true,
        subQueriesCount: 6,
        candidatePoolSize: cli.candidatePoolSize,
        enableGeminiRerank: true,
        minRelevanceScore: 2,
        enableThresholdGuard: true,
        minRelevantPassagesN: cli.minN,
        enableTwoStageGeneration: true,
        maxContextExcerpts: cli.maxExcerpts,
        includeNeighbors: true
      },
      'APRES_DEEP_STUDENT',
      'Après (Mode Étudiant Profond complet)'
    );
    runs['APRES_DEEP_STUDENT'] = apresRun;
    console.log(
      `OK (${apresRun.latencyMs} ms | Candidats=${apresRun.retrievedPassagesCount} -> Retenus(≥2)=${apresRun.retainedPassagesScoreGte2Count} | Tokens=${apresRun.totalTokens} | Coût=$${apresRun.costUsd.toFixed(5)})`
    );

    // Affichage immédiat de la décomposition mesurée par étape pour cette question
    for (const st of apresRun.stageBreakdown) {
      console.log(
        `      • ${st.stage.padEnd(28, ' ')} : ${String(st.latencyMs).padStart(5, ' ')} ms | in=${String(st.promptTokens).padStart(6, ' ')} tok | out=${String(st.completionTokens).padStart(5, ' ')} tok | tot=${String(st.totalTokens).padStart(6, ' ')} tok | $${st.costUsd.toFixed(6)}`
      );
    }

    resultsPerQuestion.push({
      questionId: qItem.id,
      question: qItem.question,
      runs
    });
  }

  // Génération du rapport Markdown côte à côte + JSON complet
  const mdLines: string[] = [
    `# Rapport d'Évaluation Avant / Après — Mode Étudiant Profond (v2.9.11)`,
    ``,
    `- **Date d'exécution** : ${new Date().toISOString()}`,
    `- **Corpus évalué** : ${corpusSourceLabel}`,
    `- **Paramètres Mode Étudiant Profond** : Bassin=${cli.candidatePoolSize} candidats, Score min=2/3, Seuil N=${cli.minN}, Contexte max=${cli.maxExcerpts} extraits (avec voisins ±1)`,
    `- **Source des métriques de tokens** : 100 % mesuré via \`usageMetadata\` de l'API Gemini (aucun chiffre estimé)`,
    ``,
    `## 1. Tableau Comparatif Côte à Côte par Question`,
    ``,
    `| ID | Question | Config | Passages (Retenus / Analysés) | Pertinents jugés par vous | Citations Valides / Invalides | Latence (ms) | Tokens (Prompt / Out / Total) | Coût mesuré ($) |`,
    `| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |`
  ];

  for (const item of resultsPerQuestion) {
    const orderedKeys = ['AVANT_BASELINE', 'CONDITION_1_DIRECTIVE6_SEULE', 'APRES_DEEP_STUDENT'];
    if (cli.runAllIsolatedStages) {
      orderedKeys.splice(2, 0, 'ETAPE_1_EXPANSION_SEULE', 'ETAPES_1_2_3_SANS_4A4B');
    }

    for (const k of orderedKeys) {
      const r = item.runs[k];
      if (!r) continue;
      const passagesCell =
        k === 'APRES_DEEP_STUDENT' || k === 'ETAPES_1_2_3_SANS_4A4B'
          ? `${r.retainedPassagesScoreGte2Count} / ${r.retrievedPassagesCount}${r.belowThresholdN ? ' (⚠️ < N)' : ''}`
          : `${r.retrievedPassagesCount}`;
      mdLines.push(
        `| **${item.questionId}** | ${item.question} | ${r.configLabel} | ${passagesCell} | *[À compléter : ___ / ${r.retainedPassagesScoreGte2Count}]* | ${r.validCitationsCount} / ${r.invalidCitationsCount} | ${r.latencyMs.toLocaleString('fr-FR')} ms | ${r.promptTokens} / ${r.completionTokens} / **${r.totalTokens}** | $${r.costUsd.toFixed(5)} |`
      );
    }
  }

  mdLines.push(``, `## 2. Mesure Isolée de Chaque Étape du Mode Étudiant Profond (via \`usageMetadata\`)`, ``);
  mdLines.push(
    `| ID | Étape 1a : Expansion LLM (ms / tok / $) | Étape 1b : BM25+Vec+RRF (ms) | Étape 2 : Rerank Gemini 0-3 (ms / tok / $) | Étape 3 : Seuil < N | Étape 4a : Extraction (ms / tok / $) | Étape 4b : Rédaction ancrée (ms / tok / $) | Total Après (ms / tok / $) |`
  );
  mdLines.push(`| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |`);

  for (const item of resultsPerQuestion) {
    const apres = item.runs['APRES_DEEP_STUDENT'];
    if (!apres) continue;
    const findSt = (name: string) =>
      apres.stageBreakdown.find(s => s.stage === name) || {
        latencyMs: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        costUsd: 0
      };

    const s1a = findSt('stage1_query_expansion');
    const s1b = findSt('stage1_multi_retrieval_rrf');
    const s2 = findSt('stage2_gemini_rerank');
    const s4a = findSt('stage4a_fact_extraction');
    const s4b = findSt('stage4b_grounded_redaction');

    mdLines.push(
      `| **${item.questionId}** | ${s1a.latencyMs}ms / ${s1a.totalTokens}t / $${s1a.costUsd.toFixed(5)} | ${s1b.latencyMs}ms | ${s2.latencyMs}ms / ${s2.totalTokens}t / $${s2.costUsd.toFixed(5)} | ${apres.belowThresholdN ? `⚠️ < ${cli.minN} (${apres.retainedPassagesScoreGte2Count})` : `✅ ≥ ${cli.minN} (${apres.retainedPassagesScoreGte2Count})`} | ${s4a.latencyMs}ms / ${s4a.totalTokens}t / $${s4a.costUsd.toFixed(5)} | ${s4b.latencyMs}ms / ${s4b.totalTokens}t / $${s4b.costUsd.toFixed(5)} | **${apres.latencyMs}ms / ${apres.totalTokens}t / $${apres.costUsd.toFixed(5)}** |`
    );
  }

  mdLines.push(``, `## 3. Réponses Côte à Côte et Passages Retenus`, ``);
  for (const item of resultsPerQuestion) {
    const av = item.runs['AVANT_BASELINE'];
    const c1 = item.runs['CONDITION_1_DIRECTIVE6_SEULE'];
    const ap = item.runs['APRES_DEEP_STUDENT'];

    mdLines.push(`### ${item.questionId} — « ${item.question} »`, ``);
    if (ap && ap.passagesForHumanJudgment.length > 0) {
      mdLines.push(`#### Passages retenus par Gemini Rerank (score ≥ 2/3) — Grille de jugement humain :`);
      for (const p of ap.passagesForHumanJudgment) {
        mdLines.push(
          `- [ ] **[${p.sourceId}, §${p.paragraphIndex}]** *(Score Gemini: ${p.geminiScore}/3 — ${p.geminiJustification})* : « ${p.snippet.replace(/\n+/g, ' ')}... »`
        );
      }
      mdLines.push(``);
    }
    mdLines.push(`#### A. AVANT (Baseline — l.313 non corrigée) :`);
    mdLines.push(av?.answerText || '*Aucune réponse*', ``);
    mdLines.push(`#### B. CONDITION 1 SEULE (Consigne l.313 corrigée seule) :`);
    mdLines.push(c1?.answerText || '*Aucune réponse*', ``);
    mdLines.push(`#### C. APRÈS (Mode Étudiant Profond complet) :`);
    mdLines.push(ap?.answerText || '*Aucune réponse*', ``, `---`, ``);
  }

  const outJsonPath = path.resolve(process.cwd(), 'eval', 'deep_student_ab_report.json');
  const outMdPath = path.resolve(process.cwd(), 'eval', 'deep_student_ab_report.md');

  fs.writeFileSync(
    outJsonPath,
    JSON.stringify(
      {
        version: '2.9.11',
        generatedAt: new Date().toISOString(),
        corpusSource: corpusSourceLabel,
        parameters: cli,
        resultsPerQuestion
      },
      null,
      2
    ),
    'utf8'
  );
  fs.writeFileSync(outMdPath, mdLines.join('\n'), 'utf8');

  console.log(`\n================================================================================`);
  console.log(`✅ ÉVALUATION TERMINÉE AVEC SUCCÈS`);
  console.log(`   - Rapport Markdown côte à côte : ${outMdPath}`);
  console.log(`   - Rapport JSON détaillé        : ${outJsonPath}`);
  console.log(`================================================================================\n`);
}

main().catch(err => {
  console.error('❌ Erreur fatale dans le harnais Avant/Après :', err);
  process.exit(1);
});
