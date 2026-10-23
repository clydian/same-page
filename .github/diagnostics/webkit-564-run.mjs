import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, readlink, writeFile } from 'node:fs/promises';
const root='artifacts/verification/issue-564';
await mkdir(root,{recursive:true});
let busy=false;
const snapshots=[];
async function snapshot() {
 if(busy)return;busy=true;
 try {
  const processes=[];
  for(const pid of (await readdir('/proc')).filter(v=>/^\d+$/.test(v))) {
   try {
    const status=await readFile(`/proc/${pid}/status`,'utf8');
    if(!/^Name:\s+(?:node|MiniBrowser|WPE|WebKit|WebProcess|NetworkProcess|pw_run)/m.test(status))continue;
    const exe=await readlink(`/proc/${pid}/exe`).catch(()=>null);
    const libsoup=exe?.includes('WPENetworkProcess')?(await readFile(`/proc/${pid}/maps`,'utf8')).split('\n').filter(line=>line.includes('libsoup')):undefined;
    processes.push({pid,exe,libsoup,status:status.split('\n').filter(v=>/^(Name|State|PPid|VmPeak|VmRSS|Threads):/.test(v))});
   }catch{ /* A process may have exited between listing and reading. */ }
  }
  const memory={};
  for(const name of ['memory.current','memory.max','memory.peak','memory.events','memory.events.local'])memory[name]=await readFile(`/sys/fs/cgroup/${name}`,'utf8').catch(()=>null);
  snapshots.push({time:Date.now(),processes,memory});
 } finally {busy=false;}
}
const timer=setInterval(()=>void snapshot(),500);timer.unref();
async function run(label,command,args,extra={}) {
 console.log(`Diagnostic case ${label}`);
 const start=Date.now();
 const child=spawn(command,args,{stdio:['ignore','pipe','pipe'],env:{...process.env,DEBUG:'pw:browser',...extra}});
 let log='';child.stdout.on('data',b=>{process.stdout.write(b);log+=b;});child.stderr.on('data',b=>{process.stderr.write(b);log+=b;});
 const result=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',(code,signal)=>resolve({code,signal}));});
 await writeFile(`${root}/${label}.log`,log);
 await writeFile(`${root}/${label}.json`,JSON.stringify({start,end:Date.now(),...result},null,2));
 if(result.code!==0)throw new Error(`${label}: exit ${result.code}, signal ${result.signal}`);
}
try {
 await snapshot();
 await run('build', 'npm', ['run','build'], {SAME_PAGE_BUILD_ID:'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'});
 await run('prepare-fresh',process.execPath,['.github/diagnostics/webkit-564-minimize.mjs']);
 const summary=[];
 for(const [label,limit,preload] of [['baseline',20,''],['fixed',50,process.env.LIBSOUP_FIXED],['restored',20,'']]) {
  if(label==='fixed'&&!preload)throw new Error('Missing fixed library');
  const arm={label,limit,preload,passed:0,failed:null};
  for(let i=1;i<=limit;i++) {
   let failure;
   try {await run(`${label}-${i}`,process.execPath,['scripts/diagnostic-webkit-564-fresh.mjs'],{LD_PRELOAD:preload});}
   catch(error){failure=String(error);}
   const {cp}=await import('node:fs/promises');
   await mkdir(`${root}/${label}-${i}`,{recursive:true});
   await cp('artifacts/verification/shell-lifecycle',`${root}/${label}-${i}`,{recursive:true});
   if(failure){arm.failed={iteration:i,error:failure};break;}
   arm.passed++;
  }
  summary.push(arm);
  await writeFile(`${root}/library-comparison.json`,JSON.stringify(summary,null,2));
  console.log('LIBRARY_COMPARISON',JSON.stringify(arm));
 }
 // A diagnostic run preserves real baseline failures as a nonzero result.
 if(summary.some(arm=>arm.failed))process.exitCode=1;
} finally {
 clearInterval(timer);while(busy)await new Promise(r=>setTimeout(r,10));await snapshot();
 await writeFile(`${root}/process-memory.json`,JSON.stringify(snapshots));
}
