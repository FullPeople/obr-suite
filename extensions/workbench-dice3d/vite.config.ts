import {defineConfig} from 'vite';
import {resolve} from 'node:path';
export default defineConfig({root:resolve(import.meta.dirname),base:'/suite-dev/dice3d/',worker:{format:'es'},build:{outDir:resolve(import.meta.dirname,'../../.cache/dice3d-build'),emptyOutDir:true,rollupOptions:{input:{overlay:resolve(import.meta.dirname,'overlay.html')}}}});
