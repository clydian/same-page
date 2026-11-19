import { defineConfig } from '/workspace/same-page/node_modules/vite/dist/node/index.js';
import {alphaTab} from '/workspace/same-page/node_modules/@coderline/alphatab-vite/dist/alphaTab.vite.mjs';
export default defineConfig({root:'/workspace/same-page',plugins:[alphaTab()],server:{host:'0.0.0.0',port:5173},publicDir:false});
