
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { ProjectionView, MaskView } from './components/ProjectionView';
import ErrorBoundary from './components/ErrorBoundary';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const searchParams = new URLSearchParams(window.location.search);
let isProjection = searchParams.get('projection') === 'true';
let isMask = searchParams.get('mask') === 'true';

// If we are in an iframe or main window without window.opener / projection window name, clean query params to prevent black screen lock
const isStandalonePopout = window.name === 'KingsSwordProjection' || window.name === 'KingsSwordMask' || Boolean(window.opener);

if ((isProjection || isMask) && !isStandalonePopout && window.self === window.top) {
  // If user refreshed or opened directly with query params in top window without opener, clean params if desired or keep fallback
} else if ((isProjection || isMask) && window.self !== window.top && !isStandalonePopout) {
  // In preview iframe without popout name, override so main app renders
  isProjection = false;
  isMask = false;
  try {
    const cleanUrl = window.location.pathname + window.location.hash;
    window.history.replaceState({}, '', cleanUrl);
  } catch (e) {}
}

const root = ReactDOM.createRoot(rootElement);

if (isMask) {
  root.render(
    <ErrorBoundary>
      <MaskView />
    </ErrorBoundary>
  );
} else if (isProjection) {
  root.render(
    <ErrorBoundary>
      <ProjectionView />
    </ErrorBoundary>
  );
} else {
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
}


