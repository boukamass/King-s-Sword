import fs from 'fs';
import path from 'path';

const lib = JSON.parse(fs.readFileSync('public/library.json', 'utf8'));
const exp = JSON.parse(fs.readFileSync('public/precalculated_index.json', 'utf8'));

function normalize(text) {
  return (text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function tokenize(text) {
  const separated = text.replace(/([ldqujcsnmtLDQUJCSNMT])['`’]([\p{L}\p{N}]+)/gu, '$1 $2');
  return normalize(separated)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2);
}

const STOP_WORDS = new Set([
  'le', 'la', 'les', 'de', 'du', 'des', 'un', 'une', 'en', 'dans', 'par', 'pour', 'sur', 'avec', 'sans', 'sous',
  'et', 'ou', 'ni', 'car', 'mais', 'donc', 'or', 'que', 'qui', 'quoi', 'dont', 'ce', 'cet', 'cette', 'ces',
  'est', 'sont', 'ete', 'etre', 'suis', 'es', 'sommes', 'etes', 'ont', 'ai', 'as', 'avons', 'avez', 'avait', 'avaient', 'avoir',
  'fait', 'font', 'faire', 'fais', 'il', 'elle', 'ils', 'elles', 'on', 'je', 'tu', 'se', 'sa', 'son', 'ses', 'leur', 'leurs',
  'au', 'aux', 'mon', 'ton', 'ma', 'ta', 'mes', 'tes', 'notre', 'votre', 'nos', 'vos',
  'quel', 'quelle', 'quels', 'quelles', 'comme', 'plus', 'moins', 'tres', 'bien', 'aussi', 'alors', 'si', 'ne', 'pas', 'point', 'non', 'oui',
  'pourquoi', 'comment', 'selon', 'quand', 'lorsque', 'a', 'y', 'd'
]);

function getContentWords(text) {
  return new Set(tokenize(text).filter(w => !STOP_WORDS.has(w) && w.length >= 3));
}

// Find targets in library or expose
const allTargets = [];
lib.forEach(s => {
  const paras = s.text.split(/\n\s*\n/).filter(p => p.trim());
  paras.forEach((p, idx) => {
    const match = p.trim().match(/^(\d+)[\.\s]/);
    const pNum = match ? parseInt(match[1], 10) : idx + 1;
    allTargets.push({
      sermonId: s.id,
      paragraphIndex: pNum,
      text: p.trim()
    });
  });
});

exp.chunks.slice(0, 30).forEach(c => {
  allTargets.push({
    sermonId: `expose_ch${c.chapterNumber}`,
    paragraphIndex: c.startParagraph,
    text: c.text
  });
});

console.log("Total candidate target paragraphs:", allTargets.length);
