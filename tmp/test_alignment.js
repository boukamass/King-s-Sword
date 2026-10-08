const fs = require("fs");
const readline = require("readline");

async function testAlignment() {
  const fileStream = fs.createReadStream("/tmp/Sg1910.csv");
  const rl = readline.createInterface({ input: fileStream });

  const testVerses = [
    { book: "Gen", ch: "1", vs: "1" },
    { book: "John", ch: "1", vs: "1" },
    { book: "Matt", ch: "1", vs: "1" },
    { book: "Rom", ch: "8", vs: "1" }
  ];

  for await (const line of rl) {
    const parts = line.split("\t");
    const found = testVerses.find(v => v.book === parts[0] && v.ch === parts[1] && v.vs === parts[2]);
    if (found) {
      console.log("\n=== Testing " + found.book + " " + found.ch + ":" + found.vs + " ===");
      const raw = parts[3];
      const matches = Array.from(raw.matchAll(/<w strong="([HG])0*(\d+)(?:\s+[HG]0*(\d+))*">([^<]*)<\/w>/g));
      const pairs = matches.filter(m => m[4].trim()).map(m => ({ word: m[4].trim(), strong: m[1] + m[2] }));

      const plain = raw.replace(/<w strong="[^"]*">/g, "").replace(/<\/w>/g, "");
      const tokens = plain.split(/[\s,.;:!?()’'»«\n\r]+/).filter(t => t.trim().length > 0);

      let pairIdx = 0;
      for (const token of tokens) {
        const cleanToken = token.toLowerCase().replace(/[^a-zà-ÿ0-9]/gi, "");
        if (!cleanToken) continue;
        let matchedStrong = null;
        if (pairIdx < pairs.length) {
          const cleanPairWord = pairs[pairIdx].word.toLowerCase().replace(/[^a-zà-ÿ0-9]/gi, "");
          if (cleanToken === cleanPairWord || cleanPairWord.includes(cleanToken) || cleanToken.includes(cleanPairWord)) {
            matchedStrong = pairs[pairIdx].strong;
            pairIdx++;
          }
        }
        if (matchedStrong) {
          console.log("  ✓ \"" + token + "\" -> " + matchedStrong);
        } else {
          console.log("  - \"" + token + "\" (no strong)");
        }
      }
    }
  }
}
testAlignment();
