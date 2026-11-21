import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {startStorageFixture} from '../../../browser-tests/storage-fixture.mjs';
import {setLoopRange} from '../../../browser-tests/practice-controls.mjs';
const out='artifacts/verification/timbre-rows';
const names=['Soprano','Alto','Tenor','Bass'];
const xml=Buffer.from(`<score-partwise version="4.0"><work><work-title>合唱练习 · SATB</work-title></work><part-list>${names.map((name,i)=>`<score-part id="P${i}"><part-name>${name}</part-name><midi-instrument id="I${i}"><midi-channel>${i+1}</midi-channel><midi-program>1</midi-program></midi-instrument></score-part>`).join('')}</part-list>${names.map((_,i)=>`<part id="P${i}">${Array.from({length:12},(_,j)=>`<measure number="${j+1}">${j===0?`<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>${i===3?'F':'G'}</sign><line>${i===3?4:2}</line></clef></attributes><direction><sound tempo="80"/></direction>`:''}<note><pitch><step>${['E','C','G','C'][i]}</step><octave>${[5,4,4,3][i]}</octave></pitch><duration>4</duration><type>whole</type></note></measure>`).join('')}</part>`).join('')}</score-partwise>`);
const fixture=await startStorageFixture({authenticated:true,previewEntry:false});let browser;
try{
 browser=await chromium.launch();const context=await browser.newContext({locale:'zh-CN',viewport:{width:1024,height:1000},serviceWorkers:'block'});
 await context.addInitScript(()=>{
  localStorage.setItem('reader-gesture-hint-seen','true');window.__midi=[];window.__volumes=[];
  const post=Worker.prototype.postMessage;
  Worker.prototype.postMessage=function(message,...rest){
   if(message?.cmd==='alphaSynth.setChannelVolume')window.__volumes.push({channel:message.channel,volume:message.volume});
   if(message?.cmd==='alphaSynth.loadMidi')window.__midi.push(JSON.parse(JSON.stringify(message.midi,(_,v)=>v instanceof Map?Object.fromEntries(v):v)));
   return post.call(this,message,...rest);
  };
 });
 assert.equal((await context.request.post(fixture.origin+'/api/auth/sign-in/email',{headers:{origin:fixture.origin},data:{email:fixture.accounts[0].email,password:fixture.accounts[0].password}})).status(),200);
 const id=crypto.randomUUID();assert.equal((await context.request.post(`${fixture.origin}/api/choirs/${fixture.choirId}/scores/${fixture.scoreId}/attachments/${id}/file?name=satb.xml&size=${xml.length}`,{data:xml})).status(),201);
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${fixture.origin}/choirs/${fixture.choirId}`);await page.getByRole('button',{name:'本地链路测试：1 个附件',exact:true}).click();await page.getByRole('button',{name:'satb.xml',exact:true}).click();
 const bar=page.getByTestId('musicxml-player'),progress=bar.getByRole('slider',{name:'播放进度',exact:true}),settings=page.getByRole('dialog',{name:'练习设置',exact:true});
 await expect(bar.getByRole('button',{name:'播放',exact:true})).toBeEnabled({timeout:60000});await bar.getByRole('button',{name:'展开练习控制',exact:true}).click();await progress.fill('4');
 await bar.getByRole('button',{name:'练习设置',exact:true}).click();await settings.getByRole('button',{name:'声部混音',exact:true}).click();
 const disclosure=settings.getByRole('button',{name:'声部音色',exact:true}),sounds=settings.locator('.practice-timbre-part select');
 await expect(disclosure).toHaveAttribute('aria-expanded','false');await expect(sounds).toHaveCount(0);
 await page.screenshot({path:out+'/collapsed-desktop.png'});await page.setViewportSize({width:390,height:844});await page.screenshot({path:out+'/collapsed-mobile.png'});await page.setViewportSize({width:1024,height:1000});
 await disclosure.click();await expect(sounds).toHaveCount(4);await expect(settings.locator('.practice-timbre-part .practice-part-name')).toHaveText(names);
 await sounds.nth(0).selectOption('piano');await expect(sounds.nth(0)).toBeEnabled();
 await sounds.nth(1).selectOption('oohs');await expect(sounds.nth(1)).toBeEnabled();
 await page.locator('.practice-panel-content').evaluate(node=>{node.scrollTop=0;});
 await page.screenshot({path:out+'/expanded-desktop.png'});
 await page.setViewportSize({width:390,height:844});await page.locator('.practice-panel-content').evaluate(node=>{node.scrollTop=0;});
 await page.screenshot({path:out+'/expanded-mobile.png'});
 console.log('Captured final SATB row layout');
}finally{await browser?.close();await fixture.stop();}
