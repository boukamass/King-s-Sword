
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Charge les variables d'environnement (y compris API_KEY du fichier .env)
  // fix: Cast process to any to bypass the missing 'cwd' property error in TypeScript environments that don't recognize it on the global process object
  const env = loadEnv(mode, (process as any).cwd(), '');
  
  return {
    plugins: [react()],
    base: './', // Crucial pour Electron : permet de charger les assets via file://
    define: {
      // Injecte la clé API de l'environnement de build directement dans le code
      // On donne la priorité à la variable d'environnement système, puis au fichier .env
      'process.env.API_KEY': JSON.stringify(env.API_KEY || process.env.API_KEY)
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    }
  };
});
