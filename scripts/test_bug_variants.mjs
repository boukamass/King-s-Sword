import { assessAnswerability } from '../services/rerankingService.ts';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const exposePath = path.join(__dirname, '..', 'public', 'expose.json');
const exposeData = JSON.parse(fs.readFileSync(exposePath, 'utf8'));

const corpusText = (exposeData.paragraphs || []).map(p => p.text || '').join(' ');

const mockCandidate = {
  chunkId: 'exp_ch1_sec1',
  text: "L'antichrist séduira le monde entier... L'esprit de l'antichrist est déjà à l'œuvre.",
  vectorScore: 0.58,
  vectorRank: 1,
  lexicalScore: 42,
  lexicalRank: 1,
  rrfScore: 0.03,
  rank: 1
};

const variants = [
  "Monter une étude très détailé et exahustive sur l'antichrist",
  "monter une etude tres detaile et exahustive sur l'antichrist",
  "MONTER UNE ETUDE TRES DETAILE ET EXAHUSTIVE SUR L'ANTICHRIST",
  "Monter une etude tres detailé et exahustive sur l'antichrist ?",
  "Can you monter une étude très détailé et exahustive sur l'antichrist please",
  "Monter une etude très detailé & exahustive sur l'antichrist, donne moi tous les passages",
  "monter une etude tres detaile et exahustive sur l'antichrist dans les sermons",
  "Monter une etude tres detaile et exahustive sur l'antichrist...",
  "Monter une étude très detaile et exahustive sur l antichrist",
  "monter une etude tres detaile et exahustive sur l'antichrist svp",
  "Monter une étude très détailé et exahustive sur l'antichrist et son esprit"
];

console.log("Testing bug question and 10 noisy variants:");
let allPassed = true;

variants.forEach((v, idx) => {
  const res = assessAnswerability({
    query: v,
    candidates: [mockCandidate],
    corpusTextIndex: corpusText
  });
  console.log(`[Variant ${idx + 1}] answerable=${res.answerable} confidence=${res.confidenceScore} reason="${res.reason}"`);
  if (!res.answerable) {
    allPassed = false;
  }
});

console.log(`\nALL VARIANTS PASSED: ${allPassed}`);
if (!allPassed) process.exit(1);
