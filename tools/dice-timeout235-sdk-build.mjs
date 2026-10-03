import {build,loadConfigFromFile} from 'vite';
import {resolve} from 'node:path';
const root=resolve('.');
const {config}=await loadConfigFromFile({command:'build',mode:'production'},resolve('vite.config.ts'));
await build({...config,root,configFile:false,build:{...config.build,outDir:resolve('../sdk235'),emptyOutDir:false,copyPublicDir:false,rollupOptions:{...config.build.rollupOptions,input:{'sdk-verify':resolve('extensions/workbench-dice3d/sdk-verify.html')}}}});
