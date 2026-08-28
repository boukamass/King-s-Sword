
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { ProjectionView, MaskView } from './components/ProjectionView';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const searchParams = new URLSearchParams(window.location.search);
const isProjection = searchParams.get('projection') === 'true';
const isMask = searchParams.get('mask') === 'true';

const root = ReactDOM.createRoot(rootElement);

if (isMask) {
  root.render(<MaskView />);
} else if (isProjection) {
  root.render(<ProjectionView />);
} else {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

