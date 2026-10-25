import React, { useEffect } from 'react';
import { setIndexKeywordsOnly, setIndexSelectionOnly } from '../services/embeddingIndexService';

export const IndexingBenchmarkModal: React.FC = () => {
  useEffect(() => {
    // L'application utilise automatiquement l'index vectoriel précalculé :
    // on s'assure que la recherche vectorielle n'est jamais désactivée par un ancien flag.
    setIndexKeywordsOnly(false);
    setIndexSelectionOnly(false);
  }, []);

  return null;
};
