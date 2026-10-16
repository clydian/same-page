import { defineConfig } from 'vite';
import {realpathSync} from 'node:fs';
import {resolve} from 'node:path';
import react from '@vitejs/plugin-react';
import { alphaTab } from '@coderline/alphatab-vite';
export default defineConfig({root:import.meta.dirname,cacheDir:'/tmp/same-page-admin-prototype-vite',plugins:[react(),alphaTab()],optimizeDeps:{exclude:['@clydian/chorus-player','@coderline/alphatab'],include:['saxes','fast-xml-parser','fflate']},server:{host:'127.0.0.1',port:4399,strictPort:true,fs:{allow:[resolve(import.meta.dirname,'../../../..'),realpathSync(resolve(import.meta.dirname,'../../../../node_modules'))]}},build:{outDir:'/tmp/same-page-admin-prototype-build',emptyOutDir:true}});
