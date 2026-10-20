import { generateNewRagResponse } from "../services/generationAdapter";
import { loadExposeAsCanonicalDocuments } from "../services/exposeDocumentService";

async function main() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
  const exposeDocs = await loadExposeAsCanonicalDocuments();
  const doc = exposeDocs.find(d => d.id === "expose-ch-4") || exposeDocs[0];
  const pkg = {
    answerable: true,
    vectorMethod: "HYBRID_RRF",
    evidence: [{
      sermonId: doc.id || "expose-ch-4",
      sermonTitle: doc.title,
      date: "1965",
      citationParagraphs: [{
        paragraphIndex: 1,
        textSnippet: doc.paragraphs[0]?.text?.slice(0, 300) || "",
        fullParagraphText: doc.paragraphs[0]?.text?.slice(0, 500) || "",
        formattedCitation: `> « ${doc.paragraphs[0]?.text?.slice(0, 100) || ""} » [Réf: ${doc.id}, Para. 1]`
      }]
    }]
  };
  const res = await generateNewRagResponse({
    query: "Quel est le sens spirituel de l'Âge de Smyrne ?",
    evidencePackage: pkg,
    apiKey,
    model: "gemini-3.8-flash"
  });
  console.log("Status:", res.status);
  console.log("Latency:", res.latencyMs, "ms");
  console.log("StructuredResponse:", JSON.stringify(res.structuredResponse, null, 2));
}

main().catch(console.error);
