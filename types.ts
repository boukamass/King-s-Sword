
export interface TranscriptSegment {
  startTime: number; // in seconds
  endTime: number;   // in seconds
  text: string;
}

export interface Highlight {
  id: string;
  start: number; // globalIndex of start word
  end: number;   // globalIndex of end word
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
  _normalizedTitle?: string; // Cache pour la recherche ultra-rapide
}

export interface Citation {
  id: string;
  sermon_id: string;
  sermon_title_snapshot: string;
  sermon_date_snapshot: string;
  quoted_text: string;
  date_added: string;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  citations: Citation[];
  creationDate: string;
  date: string;
  color?: string;
  order: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
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
  type: 'success' | 'error';
}

export interface ElectronAPI {
  platform: string;
  onUpdateAvailable: (callback: () => void) => void;
  onUpdateDownloaded: (callback: () => void) => void;
  restartApp: () => void;
  printPage: () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
