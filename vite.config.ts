
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Charge les variables d'environnement (y compris API_KEY du fichier .env)
  const env = loadEnv(mode, (process as any).cwd(), '');
  
  return {
    plugins: [react()],
    base: './', // Crucial pour Electron : permet de charger les assets via file://
    define: {
      // Injecte la clé API pour l'utilisation dans le Renderer process
      'process.env.API_KEY': JSON.stringify(env.API_KEY || process.env.API_KEY),
      // Injecte la version de l'application
      'process.env.APP_VERSION': JSON.stringify('1.0.3'),
      // NODE_ENV est utile pour certaines bibliothèques
      'process.env.NODE_ENV': JSON.stringify(mode),
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom'],
            'vendor-utils': ['marked', 'jspdf', 'docx', 'zustand'],
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
