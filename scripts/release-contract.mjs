import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
async function sourceFiles(cwd, directory) {
  const files=[];
  for(const entry of await readdir(path.join(cwd,directory),{withFileTypes:true})) {
    const file=path.posix.join(directory,entry.name);
    if(entry.isDirectory()) files.push(...await sourceFiles(cwd,file));
    else if(/\.tsx?$/.test(file)&&!/(?:\.test\.|\/test\/)/.test(file)) files.push(file);
  }
  return files;
}
export async function storageContract(cwd = process.cwd()) {
  const sources=(await Promise.all(['src/client','src/shared','worker'].map(d=>sourceFiles(cwd,d)))).flat();
  const texts=new Map(await Promise.all(sources.map(async f=>[f,await readFile(path.join(cwd,f),'utf8')])));
  // Discover reverse consumers too: a writer can define a new serialized system
  // key without becoming a dependency of the database class itself.
  const pending=sources.filter(f=>/\b(?:localDatabase|SamePageDatabase|indexedDB|Dexie|localStorage|sessionStorage)\b|\.DB\b/.test(texts.get(f)));
  const inputs=new Set();
  while(pending.length){
    const file=pending.pop();if(inputs.has(file))continue;inputs.add(file);
    const info=ts.preProcessFile(texts.get(file)??await readFile(path.join(cwd,file),'utf8'),true,true);
    for(const {fileName}of info.importedFiles){
      if(!fileName.startsWith('.'))continue;
      const base=path.posix.normalize(path.posix.join(path.posix.dirname(file),fileName));
      for(const name of [base,base+'.ts',base+'.tsx',base+'/index.ts']) {
        try { if((await stat(path.join(cwd,name))).isFile()&&/\.(?:tsx?|json)$/.test(name)){pending.push(name);break;} } catch { /* TypeScript extension probing */ }
      }
    }
  }
  for(const f of (await readdir(path.join(cwd,'migrations'))).filter(f=>f.endsWith('.sql'))) inputs.add('migrations/'+f);
  const files=Object.fromEntries(await Promise.all([...inputs].sort().map(async f=>[f,createHash('sha256').update(await readFile(path.join(cwd,f))).digest('hex')])));
  const lock=JSON.parse(await readFile(path.join(cwd,'package-lock.json'),'utf8'));
  return {contract:'same-page-storage-v15-sync-v1',dexie:lock.packages['node_modules/dexie'].version,zod:lock.packages['node_modules/zod'].version,files};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await writeFile('dist/release-storage.json',JSON.stringify(await storageContract()));
