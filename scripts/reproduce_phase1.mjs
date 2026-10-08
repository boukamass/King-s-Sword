import { 
  extractSignificantQueryTerms, 
  extractSubstantiveQueryTerms, 
  assessAnswerability,
  rerankHybridResults 
} from '../services/rerankingService.ts';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const exposePath = path.join(__dirname, '..', 'public', 'expose.json');
const exposeData = JSON.parse(fs.readFileSync(exposePath, 'utf8'));

// Concaténer tout le corpus exposé pour avoir le corpusTextIndex
let corpusText = '';
if (Array.isArray(exposeData.paragraphs)) {
  corpusText = exposeData.paragraphs.map(p => p.text || '').join(' ');
} else if (Array.isArray(exposeData.pages)) {
  corpusText = exposeData.pages.map(p => (p.paragraphs || []).map(pg => pg.text || '').join(' ')).join(' ');
} else if (Array.isArray(exposeData)) {
  corpusText = exposeData.map(ch => (ch.sections || []).map(s => s.content || '').join(' ')).join(' ');
}

console.log("Corpus exposé length:", corpusText.length);

const q2 = "Monter une étude très détailé et exahustive sur l'antichrist";

const mockCandidates = [
  {
    chunkId: 'exp_ch1_sec1',
    text: "L'antichrist séduira le monde entier... L'esprit de l'antichrist est déjà à l'œuvre.",
    vectorScore: 0.58,
    vectorRank: 1,
    lexicalScore: 42,
    lexicalRank: 1,
    rrfScore: 0.03,
    rank: 1
  }
];

const sig = extractSignificantQueryTerms(q2);
const sub = extractSubstantiveQueryTerms(q2);
console.log("sig:", sig);
console.log("sub:", sub);

// Check presence in corpusText:
const normCorpus = corpusText.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
for (const t of sub) {
  const normT = t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  console.log(`Term '${t}' (norm: '${normT}') in corpus:`, normCorpus.includes(normT));
}

const assessment = assessAnswerability({
  query: q2,
  candidates: mockCandidates,
  corpusTextIndex: corpusText
});
console.log("Assessment:", assessment);

