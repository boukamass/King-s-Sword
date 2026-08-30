import { Highlight, ProjectedImageMedia } from '../types';
import { WordDefinition } from './dictionaryService';

export interface ProjectionSyncPayload {
  type?: 'sync';
  title: string;
  date: string;
  city: string;
  time: string;
  text: string;
  projectedWords?: { text: string; globalIndex: number; color?: string }[];
  fontSize: number;
  blackout: boolean;
  theme: string;
  highlights: Highlight[];
  selectionIndices: number[];
  searchResults: number[];
  currentResultIndex: number;
  activeDefinition: WordDefinition | null;
  isBible?: boolean;
  projectedImage?: ProjectedImageMedia | null;
}

export const STORAGE_KEY = 'kings_sword_last_projection_sync';
export const CHANNEL_NAME = 'kings_sword_projection';

let projectionWindowRef: Window | null = null;
let broadcastChannelRef: BroadcastChannel | null = null;

// Initialize broadcast channel safely
export const getBroadcastChannel = (): BroadcastChannel | null => {
  if (!broadcastChannelRef && typeof BroadcastChannel !== 'undefined') {
    try {
      broadcastChannelRef = new BroadcastChannel(CHANNEL_NAME);
    } catch (e) {
      console.warn('BroadcastChannel not available:', e);
    }
  }
  return broadcastChannelRef;
};

/**
 * Returns whether the secondary projection window is currently active and open.
 */
export const isProjectionWindowOpen = (): boolean => {
  return Boolean(projectionWindowRef && !projectionWindowRef.closed);
};

/**
 * Gets the current window reference
 */
export const getProjectionWindow = (): Window | null => {
  if (projectionWindowRef && projectionWindowRef.closed) {
    projectionWindowRef = null;
  }
  return projectionWindowRef;
};

/**
 * Sends projection payload via BroadcastChannel, direct postMessage, and LocalStorage.
 */
export const broadcastProjectionPayload = (payload: ProjectionSyncPayload): void => {
  const fullPayload = {
    type: 'sync',
    ...payload
  };

  const payloadStr = JSON.stringify(fullPayload);

  // 1. LocalStorage & SessionStorage persistence
  try {
    localStorage.setItem(STORAGE_KEY, payloadStr);
    sessionStorage.setItem(STORAGE_KEY, payloadStr);
  } catch (e) {}

  // 2. BroadcastChannel
  const channel = getBroadcastChannel();
  if (channel) {
    try {
      channel.postMessage(fullPayload);
    } catch (e) {}
  }

  // 3. Direct window postMessage
  if (projectionWindowRef && !projectionWindowRef.closed) {
    try {
      projectionWindowRef.postMessage(fullPayload, '*');
    } catch (e) {}
  }
};

/**
 * Opens or focuses the projection window on the secondary screen and transmits payload.
 */
export const openProjectionWindow = (initialPayload?: ProjectionSyncPayload): Window | null => {
  if (projectionWindowRef && !projectionWindowRef.closed) {
    try {
      projectionWindowRef.focus();
      if (initialPayload) {
        broadcastProjectionPayload(initialPayload);
      }
      return projectionWindowRef;
    } catch (e) {
      projectionWindowRef = null;
    }
  }

  if (initialPayload) {
    broadcastProjectionPayload(initialPayload);
  }

  const url = new URL(window.location.href);
  url.searchParams.set('projection', 'true');

  const dualScreenLeft = window.screenLeft !== undefined ? window.screenLeft : (window.screenX || 0);
  const dualScreenTop = window.screenTop !== undefined ? window.screenTop : (window.screenY || 0);
  const currentWidth = window.outerWidth || window.innerWidth || (window.screen?.availWidth || 1920);

  const left = dualScreenLeft + currentWidth;
  const top = dualScreenTop;
  const targetWidth = window.screen?.availWidth || 1920;
  const targetHeight = window.screen?.availHeight || 1080;

  const windowFeatures = `width=${targetWidth},height=${targetHeight},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=no`;

  try {
    projectionWindowRef = window.open(url.toString(), 'KingsSwordProjection', windowFeatures);
    if (projectionWindowRef === window) {
      projectionWindowRef = null;
      try {
        const cleanUrl = window.location.pathname + window.location.hash;
        window.history.replaceState({}, '', cleanUrl);
      } catch (e) {}
    }
  } catch (err) {
    projectionWindowRef = null;
  }

  if (projectionWindowRef) {
    try {
      projectionWindowRef.moveTo(left, top);
      projectionWindowRef.resizeTo(targetWidth, targetHeight);
      projectionWindowRef.focus();
    } catch (e) {}

    if (initialPayload) {
      broadcastProjectionPayload(initialPayload);
    }

    // Screen API multi-monitor auto-positioning
    if ('getScreenDetails' in window || 'queryLocalScreens' in window) {
      const getDetails = (window as any).getScreenDetails || (window as any).queryLocalScreens;
      getDetails().then((screenDetails: any) => {
        if (screenDetails && screenDetails.screens && screenDetails.screens.length > 1 && projectionWindowRef && !projectionWindowRef.closed) {
          const current = screenDetails.currentScreen;
          const secondary = screenDetails.screens.find((s: any) => s !== current || !s.isPrimary) || screenDetails.screens[1];
          if (secondary) {
            const secLeft = secondary.availLeft ?? secondary.left ?? left;
            const secTop = secondary.availTop ?? secondary.top ?? top;
            const secWidth = secondary.availWidth ?? secondary.width ?? targetWidth;
            const secHeight = secondary.availHeight ?? secondary.height ?? targetHeight;
            try {
              projectionWindowRef.moveTo(secLeft, secTop);
              projectionWindowRef.resizeTo(secWidth, secHeight);
            } catch (e) {}
          }
        }
      }).catch(() => {});
    }
  }

  return projectionWindowRef;
};

/**
 * Closes the projection window and sends close event.
 */
export const closeProjectionWindow = (): void => {
  if (projectionWindowRef) {
    try {
      if (!projectionWindowRef.closed) {
        projectionWindowRef.close();
      }
    } catch (e) {}
    projectionWindowRef = null;
  }

  const channel = getBroadcastChannel();
  if (channel) {
    try {
      channel.postMessage({ type: 'close' });
    } catch (e) {}
  }

  try {
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
  } catch (e) {}
};
