// HTTP preview for the already-built stable host and its actual viewer entry.
import {defineConfig} from 'vite';
export default defineConfig({base:'/suite/',build:{outDir:'dist'},preview:{host:'127.0.0.1',port:5443,strictPort:true}});
