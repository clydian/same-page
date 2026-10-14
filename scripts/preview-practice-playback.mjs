// Isolated local Worker/D1/R2 fixture, with synthetic PDF/XML/audio attachments.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { request } from '@playwright/test';
import { startStorageFixture } from '../browser-tests/storage-fixture.mjs';
import { musicXmlFixture } from '../browser-tests/musicxml-fixture.mjs';
const fixture = await startStorageFixture({authenticated:true,previewEntry:false});
const api = await request.newContext({baseURL:fixture.origin,extraHTTPHeaders:{origin:fixture.origin}});
async function ok(response) { if(!response.ok()) throw new Error(`Local fixture request failed: ${response.status()}`); return response; }
await ok(await api.post('/api/auth/sign-in/email',{data:{email:fixture.accounts[0].email,password:fixture.accounts[0].password}}));
const base=`/api/choirs/${fixture.choirId}/scores/${fixture.scoreId}/attachments`;
async function attach(name,bytes) {
 await ok(await api.post(`${base}/${randomUUID()}/file?${new URLSearchParams({name,size:String(bytes.length)})}`,{data:bytes,headers:{'content-length':String(bytes.length)}}));
}
await attach('分声部练习.xml',musicXmlFixture(48));
const rate=22050,samples=rate*16,wav=Buffer.alloc(44+samples*2);
wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
for(let i=0;i<samples;i++)wav.writeInt16LE(Math.round(Math.sin(2*Math.PI*261.63*i/rate)*1500),44+i*2);
await attach('音频示例.wav',wav);await attach('排练说明.md',Buffer.from('# 排练说明\n\n打开可播放乐谱，拖动进度、调整声部音量，或者切回原始 PDF。'));
const state=await api.storageState();
const url=`${fixture.origin}/choirs/${fixture.choirId}/scores/${fixture.scoreId}`;
const launcher=createServer((req,res)=>{
 res.writeHead(302,{'Set-Cookie':state.cookies.map(c=>`${c.name}=${c.value}; Path=/; HttpOnly; SameSite=Lax`),Location:url,'Cache-Control':'no-store'});res.end();
});
await new Promise(resolve=>launcher.listen(0,'127.0.0.1',resolve));
const previewUrl=`http://127.0.0.1:${launcher.address().port}`;
await mkdir('artifacts/verification/playback-413',{recursive:true});
await writeFile('artifacts/verification/playback-413/preview.json',JSON.stringify({previewUrl,url,origin:fixture.origin},null,2));
console.log(`Practice preview: ${previewUrl}`);
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{launcher.close();void api.dispose();});
