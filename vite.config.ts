
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import packageJson from './package.json';

export default defineConfig(({ mode }) => {
  // Charge les variables d'environnement (y compris API_KEY du fichier .env)
  const env = loadEnv(mode, (process as any).cwd(), '');
  const appVersion = packageJson.version || '2.0.0';
  
  return {
    plugins: [react()],
    resolve: {
      dedupe: ['react', 'react-dom']
    },
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    base: './', // Crucial pour Electron : permet de charger les assets via file://
    define: {
      // Injecte la clé API pour l'utilisation dans le Renderer process
      'process.env.API_KEY': JSON.stringify(env.API_KEY || process.env.API_KEY),
      // Injecte la version automatique de l'application synchronisée avec package.json
      'process.env.APP_VERSION': JSON.stringify(appVersion),
      '__APP_VERSION__': JSON.stringify(appVersion),
      // NODE_ENV est utile pour certaines bibliothèques
      'process.env.NODE_ENV': JSON.stringify(mode),
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'zustand'],
            'vendor-utils': ['marked', 'jspdf', 'docx'],
            'vendor-genai': ['@google/genai']
          }
        }
      }
    },
    optimizeDeps: {
      // Force l'inclusion de certaines dépendances qui pourraient poser problème en ESM direct
      include: ['react', 'react-dom', 'zustand', 'lucide-react', 'marked']
    }
  };
});
