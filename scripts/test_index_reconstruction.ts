import { validateIndexMetadata, loadPrecalculatedIndex } from '../services/precalculatedIndexService';

async function testIndexValidationAndReconstruction() {
  console.log("================================================================================");
  console.log("   TEST DE VALIDATION DE L'INDEX & RECONSTRUCTION AUTOMATIQUE");
  console.log("================================================================================\n");

  // Test 1 : Index valide
  const resValid = await loadPrecalculatedIndex();
  console.log("1. Chargement index actuel :");
  console.log(`   • Valide : ${resValid.valid ? 'OUI ✅' : 'NON ❌'}`);
  if (resValid.valid && resValid.indexData) {
    console.log(`   • Version Index : ${resValid.indexData.metadata.indexVersion}`);
    console.log(`   • Modèle : ${resValid.indexData.metadata.modelId} (${resValid.indexData.metadata.modelVersion})`);
    console.log(`   • Quantification : ${resValid.indexData.metadata.quantization}`);
    console.log(`   • Version Chunking : ${resValid.indexData.metadata.chunkingVersion}`);
    console.log(`   • Chunks hydratés : ${resValid.hydratedChunks?.length}`);
  }

  // Test 2 : Détection d'incompatibilité de version d'index
  const badIndexVersion = validateIndexMetadata({
    indexVersion: '0.9.0',
    modelId: 'Xenova/multilingual-e5-small',
    modelVersion: '1.0.0',
    quantization: 'int8',
    chunkingVersion: '1.0.0'
  });
  console.log("\n2. Test version index incompatible ('0.9.0') :");
  console.log(`   • Valide : ${badIndexVersion.valid} (Attendu: false)`);
  console.log(`   • Motif : "${badIndexVersion.reason}" ✅`);

  // Test 3 : Détection d'incompatibilité de modèle d'embedding
  const badModel = validateIndexMetadata({
    indexVersion: '1.0.0',
    modelId: 'other-model/bert',
    modelVersion: '1.0.0',
    quantization: 'int8',
    chunkingVersion: '1.0.0'
  });
  console.log("\n3. Test modèle incompatible ('other-model/bert') :");
  console.log(`   • Valide : ${badModel.valid} (Attendu: false)`);
  console.log(`   • Motif : "${badModel.reason}" ✅`);

  // Test 4 : Détection d'incompatibilité de chunking
  const badChunking = validateIndexMetadata({
    indexVersion: '1.0.0',
    modelId: 'Xenova/multilingual-e5-small',
    modelVersion: '1.0.0',
    quantization: 'int8',
    chunkingVersion: '2.0.0'
  });
  console.log("\n4. Test version chunking incompatible ('2.0.0') :");
  console.log(`   • Valide : ${badChunking.valid} (Attendu: false)`);
  console.log(`   • Motif : "${badChunking.reason}" ✅`);

  // Test 5 : Détection d'incompatibilité de hash de corpus
  const badHash = validateIndexMetadata({
    indexVersion: '1.0.0',
    modelId: 'Xenova/multilingual-e5-small',
    modelVersion: '1.0.0',
    quantization: 'int8',
    chunkingVersion: '1.0.0',
    corpusHash: 'old_hash_12345'
  }, 'new_hash_67890');
  console.log("\n5. Test hash corpus modifié :");
  console.log(`   • Valide : ${badHash.valid} (Attendu: false)`);
  console.log(`   • Motif : "${badHash.reason}" ✅`);

  const allPassed = resValid.valid &&
    !badIndexVersion.valid &&
    !badModel.valid &&
    !badChunking.valid &&
    !badHash.valid;

  if (allPassed) {
    console.log("\n🎉 TOUS LES TESTS DE VALIDATION ONT RÉUSSI AVEC SUCCÈS !");
    process.exit(0);
  } else {
    console.error("\n❌ ÉCHEC DU TEST");
    process.exit(1);
  }
}

testIndexValidationAndReconstruction().catch(err => {
  console.error(err);
  process.exit(1);
});
