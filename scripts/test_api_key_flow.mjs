// Test suite automatisée pour le parcours de clé API Gemini et la sécurité de King's Sword

console.log("=================================================");
console.log(" TESTS DU PARCOURS DE CLÉ API ET DE SÉCURITÉ");
console.log("=================================================\n");

let passed = 0;
let total = 0;

function assert(condition, message) {
  total++;
  if (condition) {
    console.log(`  ✅ [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${message}`);
  }
}

// 1. Logique d'assainissement de clé (identique à utils/apiKeyHelper.ts)
function cleanApiKey(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw
    .trim()
    .replace(/^["'`\s]+|["'`\s]+$/g, '')
    .trim();
}

const sampleKey = "AIzaSyDummyKeyForTestingOnly123456789";

assert(cleanApiKey(sampleKey) === sampleKey, "Clé propre conservée intacte");
assert(cleanApiKey(`  ${sampleKey}  \n\t`) === sampleKey, "Suppression des espaces et retours chariot");
assert(cleanApiKey(`"${sampleKey}"`) === sampleKey, "Suppression des guillemets doubles");
assert(cleanApiKey(`'${sampleKey}'`) === sampleKey, "Suppression des guillemets simples");
assert(cleanApiKey("`" + sampleKey + "`") === sampleKey, "Suppression des backticks");
assert(cleanApiKey("") === "", "Gestion de chaîne vide");
assert(cleanApiKey(null) === "", "Gestion de null");
assert(cleanApiKey(undefined) === "", "Gestion de undefined");

// 2. Tests de sanitization d'erreur (masquage de toute fuite de clé)
function sanitizeErrorText(rawMessage) {
  if (!rawMessage) return "Une erreur est survenue.";
  return rawMessage
    .replace(/AIza[0-9A-Za-z-_]{10,}/gi, '[CLÉ_MASQUÉE]')
    .replace(/(?:key|token|api_key|apiKey)=([^&\s]+)/gi, '$1=[CLÉ_MASQUÉE]')
    .replace(/bearer\s+[A-Za-z0-9-_.]+/gi, 'Bearer [TOKEN_MASQUÉ]');
}

const leakError = "Google API Error on https://generativelanguage.googleapis.com/v1beta?key=" + sampleKey + " : API_KEY_INVALID";
const sanitized = sanitizeErrorText(leakError);

assert(!sanitized.includes(sampleKey), "La clé API n'apparaît JAMAIS dans le texte d'erreur");
assert(sanitized.includes('[CLÉ_MASQUÉE]'), "Remplacement sécurisé par [CLÉ_MASQUÉE]");

// 3. Tests de catégorisation des erreurs Google Gemini
function classifyGeminiError(error) {
  const rawMsg = sanitizeErrorText(error?.message || String(error || ''));
  const status = error?.status || error?.statusCode;

  if (
    status === 400 || 
    rawMsg.includes('API_KEY_INVALID') || 
    rawMsg.includes('API key not valid')
  ) {
    return {
      type: 'API_KEY_INVALID',
      userMessage: 'La clé API Google Gemini saisie est invalide ou non reconnue par Google AI Studio. Veuillez vérifier la clé collée dans la configuration.'
    };
  }

  if (
    status === 429 || 
    rawMsg.includes('429') || 
    rawMsg.includes('RESOURCE_EXHAUSTED') || 
    rawMsg.includes('QUOTA_EXHAUSTED')
  ) {
    return {
      type: 'QUOTA_EXHAUSTED',
      userMessage: 'Le quota gratuit de votre clé Google Gemini est temporairement saturé. Veuillez patienter une minute avant de réessayer.'
    };
  }

  if (
    status === 403 || 
    rawMsg.includes('PERMISSION_DENIED')
  ) {
    return {
      type: 'PERMISSION_DENIED',
      userMessage: "Accès non autorisé ou API Google Generative Language non activée sur votre compte/projet Google Cloud."
    };
  }

  if (
    status === 404 || 
    rawMsg.includes('NOT_FOUND')
  ) {
    return {
      type: 'MODEL_UNAVAILABLE',
      userMessage: "Le modèle gemini-2.5-flash n'est pas accessible avec cette clé sur cette région géographique."
    };
  }

  if (
    rawMsg.includes('fetch failed') || 
    rawMsg.includes('NetworkError')
  ) {
    return {
      type: 'NETWORK_ERROR',
      userMessage: 'Impossible de joindre les serveurs Google (connexion réseau interrompue ou bloquée).'
    };
  }

  return {
    type: 'GENERIC_API_ERROR',
    userMessage: `Erreur API Google Gemini : ${rawMsg.slice(0, 150)}`
  };
}

const err400 = classifyGeminiError({ status: 400, message: "API_KEY_INVALID" });
assert(err400.type === 'API_KEY_INVALID', "Détection précise du code 400 (API_KEY_INVALID)");
assert(err400.userMessage.includes("invalide ou non reconnue"), "Message explicite pour clé invalide");

const err429 = classifyGeminiError({ status: 429, message: "RESOURCE_EXHAUSTED: Quota exceeded" });
assert(err429.type === 'QUOTA_EXHAUSTED', "Détection précise du code 429 (QUOTA_EXHAUSTED)");
assert(err429.userMessage.includes("quota gratuit"), "Message explicite pour quota saturé");

const err403 = classifyGeminiError({ status: 403, message: "PERMISSION_DENIED" });
assert(err403.type === 'PERMISSION_DENIED', "Détection précise du code 403 (PERMISSION_DENIED)");

const errNetwork = classifyGeminiError({ message: "TypeError: fetch failed" });
assert(errNetwork.type === 'NETWORK_ERROR', "Détection précise des pannes réseau");

console.log("\n=================================================");
console.log(` RÉSULTATS : ${passed}/${total} TESTS PASSÉS AVEC SUCCÈS`);
console.log("=================================================");
