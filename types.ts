
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

export interface Citation {
  id: string;
  sermon_id: string;
  sermon_title_snapshot: string;
  sermon_date_snapshot: string;
  sermon_version_snapshot?: string;
  quoted_text: string;
  date_added: string;
  paragraph_index?: number;
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
  images?: NoteImage[];
  creationDate: string;
  date: string;
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