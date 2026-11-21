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
 browser=await chromium.launch();const context=await browser.newContext({locale:'zh-CN',viewport:{width:1024,height:900},serviceWorkers:'block'});
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
 await page.screenshot({path:out+'/collapsed-desktop.png'});await page.setViewportSize({width:390,height:844});await page.screenshot({path:out+'/collapsed-mobile.png'});await page.setViewportSize({width:1024,height:900});
 await disclosure.click();await expect(sounds).toHaveCount(4);await expect(settings.locator('.practice-timbre-part .practice-part-name')).toHaveText(names);
 const baseline=await page.evaluate(()=>window.__midi[0]);
 await sounds.nth(0).selectOption('piano');await expect(sounds.nth(0)).toBeEnabled();await expect(progress).toHaveValue('4');
 for(const i of [1,2,3])await expect(sounds.nth(i)).toHaveValue('score');
 const afterFirst=await page.evaluate(()=>window.__midi.at(-1));
 assert.deepEqual(afterFirst.tracks[0].events.filter(e=>e.channel!==0),baseline.tracks[0].events.filter(e=>e.channel!==0));
 await settings.getByRole('slider',{name:'Soprano 音量',exact:true}).fill('0.65');await settings.getByRole('slider',{name:'Alto 音量',exact:true}).fill('0.45');
 await settings.getByRole('switch',{name:'声部关注',exact:true}).locator('xpath=ancestor::label').click();
 await settings.getByRole('slider',{name:'关注声部音量',exact:true}).fill('0.8');await settings.getByRole('slider',{name:'其他声部音量',exact:true}).fill('0.15');
 await setLoopRange(page,3,7);await settings.getByRole('button',{name:'独奏 Soprano',exact:true}).click();
 await sounds.nth(1).selectOption('oohs');await expect(sounds.nth(1)).toBeEnabled();
 const volumes=()=>page.evaluate(()=>Object.fromEntries(window.__volumes.map(c=>[c.channel,c.volume])));
 await expect.poll(volumes).toEqual({'0':.8,'1':.15,'2':.15,'3':.15});await expect(sounds.nth(0)).toHaveValue('piano');await expect(sounds.nth(2)).toHaveValue('score');await expect(sounds.nth(3)).toHaveValue('score');
 await expect(settings.getByRole('button',{name:'独奏 Soprano',exact:true})).toHaveAttribute('aria-pressed','true');await expect(progress).toHaveValue('3');await expect(progress).toHaveAttribute('min','3');await expect(progress).toHaveAttribute('max','7');
 await settings.getByRole('switch',{name:'声部关注',exact:true}).locator('xpath=ancestor::label').click();await expect.poll(volumes).toEqual({'0':.65,'1':.45,'2':.75,'3':.75});
 await settings.getByRole('button',{name:'独奏 Soprano',exact:true}).click();
 await settings.getByRole('switch',{name:'片段循环',exact:true}).locator('xpath=ancestor::label').click();
 await disclosure.scrollIntoViewIfNeeded();await page.screenshot({path:out+'/expanded-desktop.png'});
 await page.setViewportSize({width:390,height:844});await sounds.nth(3).scrollIntoViewIfNeeded();await page.screenshot({path:out+'/expanded-mobile.png'});
 const layout=await sounds.evaluateAll(nodes=>nodes.map(node=>{const b=node.getBoundingClientRect();return {x:b.x,right:b.right,y:b.y,bottom:b.bottom,width:b.width,height:b.height};}));assert.ok(layout.every(b=>b.x>=0&&b.right<=390&&b.width>100&&b.height>=44));
 await settings.getByRole('button',{name:'关闭练习设置',exact:true}).click();await bar.getByRole('button',{name:'播放',exact:true}).click();
 await bar.getByRole('button',{name:'练习设置',exact:true}).click();await settings.getByRole('button',{name:'声部混音',exact:true}).click();await settings.getByRole('button',{name:'声部音色',exact:true}).click();
 await sounds.nth(3).selectOption('piano');await expect(sounds.nth(3)).toBeEnabled();await expect(bar.getByRole('button',{name:'暂停',exact:true})).toBeVisible();
 await settings.getByRole('button',{name:'关闭练习设置',exact:true}).click();await bar.getByRole('button',{name:'暂停',exact:true}).click();await bar.getByRole('button',{name:'练习设置',exact:true}).click();await settings.getByRole('button',{name:'声部混音',exact:true}).click();await settings.getByRole('button',{name:'声部音色',exact:true}).click();
 for(const i of [0,1,3]){await sounds.nth(i).selectOption('score');await expect(sounds.nth(i)).toBeEnabled();}
 const midi=await page.evaluate(()=>window.__midi);assert.deepEqual(midi.at(-1),baseline);assert.deepEqual(errors,[]);
 await writeFile(out+'/actual-midi.json',JSON.stringify(midi,null,2));await writeFile(out+'/verification.json',JSON.stringify({voiceOrder:names,otherPartsUnchanged:true,defaultRestoresExactMidi:true,focusAfterReload:{0:.8,1:.15,2:.15,3:.15},independentAfterFocusOff:await volumes(),playbackResumed:true,loopAndSoloPreserved:true,mobileControls:layout,pageErrors:errors},null,2));
 console.log('PASS SATB direct sound rows, independent MIDI, active focus, loop/solo, playing reload and exact default restore');
}finally{await browser?.close();await fixture.stop();}
