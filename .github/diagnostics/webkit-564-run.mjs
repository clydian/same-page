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
    processes.push({pid,exe,status:status.split('\n').filter(v=>/^(Name|State|PPid|VmPeak|VmRSS|Threads):/.test(v))});
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
 const result=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',(code,signal)=>resolve({code,signal}));});
 await writeFile(`${root}/${label}.log`,log);
 await writeFile(`${root}/${label}.json`,JSON.stringify({start,end:Date.now(),...result},null,2));
 if(result.code!==0)throw new Error(`${label}: exit ${result.code}, signal ${result.signal}`);
}
try {
 await snapshot();
 // Original pipeline, including the real synthetic builds and its first failure.
 await run('original-pwa-pipeline','npm',['run','test:pwa-update']);
 // Independent diagnostic iterations. Stop at the first failure and preserve it.
 for(let i=1;i<=10;i++) {
  await run(`lifecycle-${i}`,process.execPath,['scripts/verify-shell-lifecycle.mjs']);
  await mkdir(`${root}/lifecycle-${i}`,{recursive:true});
  const {cp}=await import('node:fs/promises');
  await cp('artifacts/verification/shell-lifecycle',`${root}/lifecycle-${i}`,{recursive:true});
 }
 await run('pure-sw',process.execPath,['.github/diagnostics/webkit-564-probe.mjs'],{ROUNDS:'1',OBSERVE_MS:'23000'});
} finally {
 clearInterval(timer);while(busy)await new Promise(r=>setTimeout(r,10));await snapshot();
 await writeFile(`${root}/process-memory.json`,JSON.stringify(snapshots));
}
