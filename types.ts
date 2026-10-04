
export interface TranscriptSegment {
  startTime: number;
  endTime: number;
  text: string;
}

export interface Highlight {
  id: string;
  start: number;
  end: number;
  // Added optional color property to support custom highlighting colors used in the reader
  color?: string;
}

export interface Sermon {
  id: string;
  title: string;
  date: string;
  time?: string;
  city: string | null;
  version?: string;
  audio_url?: string;
  text: string;
  highlights?: Highlight[];
  _normalizedTitle?: string;
}

export interface CitationHighlight {
  start: number;
  end: number;
  color?: string;
  text?: string;
}

export interface Citation {
  id: string;
  sermon_id: string;
  sermon_title_snapshot: string;
  sermon_date_snapshot: string;
  sermon_version_snapshot?: string;
  quoted_text: string;
  date_added: string;
  paragraph_index?: number;
  highlights?: CitationHighlight[];
}

export interface NoteSeparator {
  id: string;
  type: 'subtitle' | 'comment';
  text: string;
  category: 'scripture' | 'church_age' | 'teaching';
  orderIndex: number;
  createdAt?: string;
}

export interface NoteImage {
  id: string;
  url: string;
  name?: string;
  caption?: string;
  addedAt?: string;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  citations: Citation[];
  separators?: NoteSeparator[];
  sourceOrder?: string[];
  images?: NoteImage[];
  creationDate: string;
  date: string;
  updatedAt?: string;
  color?: string;
  order: number;
}

export enum SearchMode {
  DIVERSE = 'DIVERSE',
  EXACT_WORDS = 'EXACT_WORDS',
  EXACT_PHRASE = 'EXACT_PHRASE',
  PARTIAL = 'PARTIAL'
}

export interface Notification {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface Song {
  id: number | string;
  title: string;
  filename?: string;
  content: string;
  language?: string;
  custom?: boolean;
  updatedAt?: string;
}

export interface Announcement {
  id: string;
  title: string;
  category?: string;
  date?: string;
  location?: string;
  content: string;
  alignment?: 'center' | 'left';
  accentColor?: 'teal' | 'amber' | 'blue' | 'purple' | 'emerald' | 'rose';
  fontSize?: number;
  bgImageUrl?: string;
  updatedAt?: string;
}

export interface MediaFolder {
  id: string;
  name: string;
  color?: string;
  createdAt?: string;
}

export interface ProjectedImageMedia {
  id: string;
  name: string;
  url: string;
  orientation: 'landscape' | 'portrait' | 'square';
  aspectRatio: number;
  width?: number;
  height?: number;
  caption?: string;
  createdAt?: string;
  folderId?: string;
}

export type QuickAccessItemType = 'sermon' | 'bible' | 'expose' | 'song';

export interface QuickAccessItem {
  id: string;
  targetId: string;
  type: QuickAccessItemType;
  title: string;
  subtitle?: string;
  snippet?: string;
  paragraphIndex?: number;
  bibleBookId?: string;
  bibleChapter?: number;
  bibleVerse?: number;
  date?: string;
  timestamp: number;
  isFavorite?: boolean;
}

export type DocumentSourceType = 'sermon' | 'expose' | 'bible' | 'song';

export type AIContextUnitType = 'document' | 'chapter' | 'section' | 'page' | 'paragraph' | 'verse' | 'range';

export interface AIContextUnit {
  type: AIContextUnitType;
  id?: string | number;
  start?: number;
  end?: number;
  paragraphIndex?: number;
  verse?: number;
}

export interface AIContextSource {
  sourceType: DocumentSourceType;
  sourceId: string;
  title?: string;
  selectedUnit?: AIContextUnit;
  allowedParagraphIds?: number[];
  allowedVerses?: number[];
}

export interface AIContext {
  sources: AIContextSource[];
}

export interface DocumentParagraph {
  paragraphId: string | number;
  paragraphIndex: number; // 1-based sequential index in document
  text: string;
  sectionTitle?: string | null;
  chapterNumber?: string | number | null;
  chapterTitle?: string | null;
  pageNumber?: number | null;
  indexInPage?: number | null;
}

export interface CanonicalDocument {
  documentId: string;
  documentType: DocumentSourceType;
  title: string;
  author?: string;
  date?: string;
  city?: string | null;
  version?: string;
  paragraphs: DocumentParagraph[];
  metadata?: Record<string, any>;
}

export interface SermonChunk {
  chunkId: string;
  sermonId: string;
  paragraphIds: number[];
  startParagraph: number;
  endParagraph: number;
  text: string;
  sermonTitle: string;
  date?: string;
  city?: string | null;
  version?: string;
  characterCount: number;
  wordCount: number;
  contentHash?: string;
  embedding?: number[] | null;
  createdAt?: string;
  updatedAt?: string;
  // Generic Document Abstraction Extensions (Phase 2F.11)
  documentType?: DocumentSourceType;
  documentId?: string;
  sectionTitle?: string | null;
  chapterTitle?: string | null;
  chapterNumber?: string | null;
  metadata?: Record<string, any>;
}

export type DocumentChunk = SermonChunk;
export type Chunk = SermonChunk;

export interface ChunkingOptions {
  maxCharacters?: number;
  minCharacters?: number;
  overlapParagraphs?: number;
  maxParagraphsPerChunk?: number;
}

export interface VectorSearchResult {
  chunk: SermonChunk;
  score: number;
  rank: number;
}

export interface VectorSearchOptions {
  topK?: number;
  minScoreThreshold?: number;
  sermonIdFilter?: string[];
}

export interface LexicalChunkHit {
  chunkId: string;
  rank: number;
  score?: number;
  matchedParagraphIds?: number[];
}

export interface HybridSearchResult {
  chunkId: string;
  sermonId: string;
  paragraphIds: number[];
  startParagraph: number;
  endParagraph: number;
  text: string;
  sermonTitle: string;
  date?: string;
  city?: string | null;
  version?: string;
  lexicalRank: number | null;
  lexicalScore: number | null;
  vectorRank: number | null;
  vectorScore: number | null;
  rrfScore: number;
  rank: number;
  chunk: SermonChunk;
}

export interface HybridSearchOptions {
  k?: number; // RRF constant, default 60
  topK?: number; // default 10
  minRrfScore?: number;
  sermonIdFilter?: string[];
  vectorWeight?: number;
  lexicalWeight?: number;
}

export interface RerankedSearchResult extends HybridSearchResult {
  rerankScore: number;
  rerankDetails: {
    baseRrfScore: number;
    vectorCosine: number;
    lexicalScore: number;
    isMultiModal: boolean;
    queryTermCoverage: number;
  };
}

export interface AnswerabilityAssessment {
  answerable: boolean;
  confidenceScore: number; // 0.0 à 1.0
  reason: string;
  topScore: number;
  evidenceCount: number;
  absentKeywords?: string[];
}

export interface ValidatedCitation {
  chunkId: string;
  sermonId: string;
  paragraphIndex: number;
  citationTitle: string;
  isAuthentic: boolean;
  textSnippet: string;
  validationError?: string;
}

export interface RerankOptions {
  topK?: number;
  vectorWeight?: number;
  lexicalWeight?: number;
  rrfWeight?: number;
  multiModalBonus?: number;
}

export interface EvidenceParagraphCitation {
  paragraphIndex: number;
  formattedCitation: string; // e.g. "[Réf: 63-0324M, §2]" ou "[Réf: 63-0324M, Para. 2]" - JAMAIS de chunkId !
  textSnippet: string;
  isAuthentic: boolean;
}

export interface RetrievalEvidence {
  chunkId: string;
  sermonId: string;
  sermonTitle: string;
  paragraphIds: number[];
  startParagraph: number;
  endParagraph: number;
  text: string;
  date?: string;
  city?: string | null;
  version?: string;
  retrievalScore: number;
  rank: number;
  sourceType: 'lexical' | 'vector' | 'hybrid' | 'reranked';
  citationParagraphs: EvidenceParagraphCitation[];
}

export interface RetrievalEvidencePackage {
  answerable: boolean;
  confidenceScore: number;
  reason: string;
  evidence: RetrievalEvidence[];
  query: string;
  totalCandidates?: number;
  rejectedCount?: number;
}

export interface ValidatedCitationDetail {
  rawMatch: string;
  sermonId: string | null;
  paragraphIndex: number | null;
  isValid: boolean;
  reason: string;
  matchedEvidence?: {
    sermonId: string;
    sermonTitle: string;
    paragraphIndex: number;
    snippet: string;
  };
}

export interface CitationValidationResult {
  text: string;
  citations: ValidatedCitationDetail[];
  validCitationCount: number;
  invalidCitationCount: number;
  allCitationsValid: boolean;
}

export interface ElectronAPI {
  platform: string;
  onUpdateAvailable: (callback: () => void) => void;
  onUpdateDownloaded: (callback: () => void) => void;
  restartApp: () => void;
  printPage: () => void;
  db: {
    isReady: () => Promise<boolean>;
    getSermonsMetadata: () => Promise<Omit<Sermon, 'text'>[]>;
    getSermonFull: (id: string) => Promise<Sermon | null>;
    search: (params: { query: string; mode: SearchMode; limit: number; offset: number }) => Promise<any[]>;
    // Updated count to be optional to match main.js error handling
    importSermons: (sermons: Sermon[]) => Promise<{ success: boolean; count?: number; error?: string }>;
    getParagraphContent: (id: string) => Promise<any>;
    getNotes: () => Promise<Note[]>;
    saveNote: (note: Note) => Promise<{ success: boolean; error?: string }>;
    deleteNote: (id: string) => Promise<{ success: boolean; error?: string }>;
    reorderNotes: (notes: Note[]) => Promise<{ success: boolean; error?: string }>;
    getSongs: () => Promise<Song[]>;
    getSong: (id: string | number) => Promise<Song | null>;
    saveSong: (song: Song) => Promise<{ success: boolean; song?: Song; error?: string }>;
    deleteSong: (id: string | number) => Promise<{ success: boolean; error?: string }>;
    bulkImportSongs: (songs: Song[]) => Promise<{ success: boolean; count?: number; error?: string }>;
    getKV: (key: string) => Promise<string | null>;
    setKV: (key: string, value: any) => Promise<{ success: boolean; error?: string }>;
    exportBackup?: () => Promise<{ success: boolean; backup?: any; error?: string }>;
    importBackup?: (backupData: any) => Promise<{ success: boolean; importedNotes?: number; importedSongs?: number; error?: string }>;
    saveChunks?: (chunks: SermonChunk[]) => Promise<{ success: boolean; count: number; saved: number; unchanged: number; error?: string }>;
    getChunk?: (chunkId: string) => Promise<SermonChunk | null>;
    getChunksBySermon?: (sermonId: string) => Promise<SermonChunk[]>;
    getAllChunks?: () => Promise<SermonChunk[]>;
    deleteChunksBySermon?: (sermonId: string) => Promise<{ success: boolean; count?: number; error?: string }>;
  };
  security?: {
    getLockStatus: () => Promise<{ locked: boolean; machineId: string; reason?: string }>;
    activateDevice: (activationCode: string) => Promise<{ success: boolean; error?: string }>;
    encryptSecureData?: (plainText: string) => Promise<string>;
    decryptSecureData?: (cipherText: string) => Promise<string>;
  };
}

declare global {
  // Use capital Window to correctly augment the global window object in TypeScript
  interface Window {
    electronAPI: ElectronAPI;
  }
}