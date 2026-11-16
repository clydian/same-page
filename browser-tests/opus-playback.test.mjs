import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdir} from 'node:fs/promises';
import {chromium,webkit,expect} from '@playwright/test';
import {startStorageFixture} from './storage-fixture.mjs';
import {setLoopRange,changeNotationSize,closePractice} from './practice-controls.mjs';

for(const [engine,type] of [['chromium',chromium],['webkit',webkit]]) test(`flat MXL Opus uses ordinary practice controls (${engine})`,{timeout:180000},async t=>{
 const fixture=await startStorageFixture({authenticated:true,previewEntry:false});let browser;
 t.after(async()=>{try{await browser?.close();}finally{await fixture.stop();}});
 browser=await type.launch(engine==='chromium'&&process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{});
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 await context.addInitScript(()=>{
  localStorage.setItem('reader-gesture-hint-seen','true');window.__opusAudio=[];
  const connect=AudioNode.prototype.connect;
  AudioNode.prototype.connect=function(destination,...args){if(destination instanceof AudioDestinationNode){const analyser=this.context.createAnalyser();analyser.fftSize=256;window.__opusAudio.push(analyser);connect.call(this,analyser);connect.call(analyser,destination);return destination;}return connect.call(this,destination,...args);};
 });
 assert.equal((await context.request.post(fixture.origin+'/api/auth/sign-in/email',{headers:{origin:fixture.origin},data:{email:fixture.accounts[0].email,password:fixture.accounts[0].password}})).status(),200);
 const bytes=await opusMusicXmlFixture();
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.stack));
 await page.goto(`${fixture.origin}/choirs/${fixture.choirId}`);
 await page.getByRole('button',{name:'本地链路测试 更多操作',exact:true}).click();await page.getByRole('menuitem',{name:'添加附件',exact:true}).click();await page.getByRole('button',{name:'可播放乐谱',exact:true}).click();
 await page.getByLabel('选择附件文件').setInputFiles({name:'Original-opus.mxl',mimeType:'application/vnd.recordare.musicxml',buffer:bytes});await page.getByRole('button',{name:'上传',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.getByRole('button',{name:'本地链路测试：1 个附件',exact:true}).click();await page.getByRole('button',{name:'Original-opus.mxl',exact:true}).click();
 const bar=page.getByTestId('musicxml-player'),timeline=bar.getByRole('slider',{name:'播放进度',exact:true});
 await expect(bar.getByRole('button',{name:'播放',exact:true})).toBeEnabled({timeout:60000});
 await expect(timeline).toHaveAttribute('max','5');
 await expect(page.locator('.practice-measure-label')).toHaveText(['1-1','1-2','2-1','2-2']);
 const pieces=page.locator('.practice-score-piece');await expect(pieces).toHaveCount(2);
 const boxes=await pieces.evaluateAll(nodes=>nodes.map(node=>({y:node.getBoundingClientRect().y,bottom:node.getBoundingClientRect().bottom,systems:node.querySelectorAll('svg').length})));
 assert.ok(boxes[1].y>=boxes[0].bottom,'each independent score begins a new block');
 const output='artifacts/verification/flat-opus';if(engine==='chromium'){await mkdir(output,{recursive:true});await page.screenshot({path:output+'/independent-scores.png'});}
 // Drag uses the existing timeline, including its normal preview and commit.
 const box=await timeline.boundingBox();await page.mouse.move(box.x+8,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width*.4,box.y+box.height/2,{steps:5});
 await expect(page.locator('.practice-timeline-preview')).toContainText('第 2-1 小节');
 if(engine==='chromium') await page.screenshot({path:output+'/drag-second-score.png'});
 await page.mouse.up();await expect(timeline).toHaveValue('2');
 await bar.getByRole('button',{name:'练习设置',exact:true}).click();await page.getByRole('button',{name:'声部混音',exact:true}).click();
 await expect(page.getByRole('button',{name:'静音 Piano',exact:true})).toBeVisible();
 await page.getByRole('switch',{name:'跳转后预备一小节',exact:true}).locator('xpath=ancestor::label').click();
 await page.getByRole('button',{name:'关闭练习设置',exact:true}).click();
 await timeline.fill('3');await bar.getByRole('button',{name:'播放',exact:true}).click();
 await expect(page.locator('.practice-notice')).toContainText('预备：');
 await expect(page.locator('.practice-notice')).toContainText('/ 4');
 await expect(page.locator('.practice-notice')).toHaveCount(0,{timeout:6000});
 await expect.poll(()=>page.evaluate(()=>window.__opusAudio.some(analyser=>{const values=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(values);return values.some(value=>Math.abs(value)>0.0001);})),{timeout:10000}).toBe(true);
 await expect(timeline).toHaveValue('5',{timeout:8000});
 await expect(timeline).toHaveAttribute('aria-valuetext','第 2-2 小节 · 第 2 次经过');
 await bar.getByRole('button',{name:'暂停',exact:true}).click();
 // Different ensembles restore their own mixes; channel state cannot leak.
 const pickup=pieces.nth(1).locator('svg text').filter({hasText:'\uE0A4'}).first();
 const noteBox=await pickup.boundingBox();assert.ok(noteBox);await page.mouse.click(noteBox.x+noteBox.width/2,noteBox.y+noteBox.height/2);await expect(timeline).toHaveValue('4');
 await timeline.fill('0');await bar.getByRole('button',{name:'练习设置',exact:true}).click();await page.getByRole('button',{name:'声部混音',exact:true}).click();
 await expect(page.getByRole('button',{name:'静音 Bass',exact:true})).toBeVisible();await page.getByRole('button',{name:'独奏 Bass',exact:true}).click();
 await page.getByRole('switch',{name:'跳转后预备一小节',exact:true}).locator('xpath=ancestor::label').click();
 await page.getByRole('button',{name:'关闭练习设置',exact:true}).click();
 await timeline.fill('2');await bar.getByRole('button',{name:'练习设置',exact:true}).click();await page.getByRole('button',{name:'声部混音',exact:true}).click();
 await expect(page.getByRole('button',{name:'独奏 Piano',exact:true})).toHaveAttribute('aria-pressed','false');
 await setLoopRange(page,1,3);await page.getByRole('button',{name:'关闭练习设置',exact:true}).click();
 await expect(timeline).toHaveAttribute('min','1');await expect(timeline).toHaveAttribute('max','3');
 await timeline.fill('1');
 await timeline.evaluate(node=>{window.__opusPositions=[Number(node.value)];const observer=new MutationObserver(()=>window.__opusPositions.push(Number(node.value)));observer.observe(node,{attributes:true,attributeFilter:['value']});});
 await bar.getByRole('button',{name:'播放',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>{const positions=window.__opusPositions;const second=positions.indexOf(2);return second>=0&&positions.slice(second+1).includes(1);}),{timeout:10000}).toBe(true);
 await bar.getByRole('button',{name:'暂停',exact:true}).click();
 await changeNotationSize(page,'放大谱面');await expect(page.locator('.practice-measure-label')).toHaveText(['1-1','1-2','2-1','2-2']);
 await bar.getByRole('button',{name:'练习设置',exact:true}).click();await page.getByRole('button',{name:'声部混音',exact:true}).click();
 await expect(page.getByRole('button',{name:'独奏 Bass',exact:true})).toHaveAttribute('aria-pressed','true');
 if(engine==='chromium') await page.screenshot({path:output+'/cross-score-loop.png'});
 await page.getByRole('button',{name:'关闭练习设置',exact:true}).click();
 await page.setViewportSize({width:390,height:600});
 const viewport=page.locator('.practice-notation-scroll');await viewport.hover();await page.mouse.wheel(0,220);
 await expect(page.getByRole('button',{name:'恢复自动跟随',exact:true})).toBeVisible();await page.getByRole('button',{name:'恢复自动跟随',exact:true}).click();
 await expect(page.getByRole('button',{name:'恢复自动跟随',exact:true})).toHaveCount(0);
 await page.evaluate(()=>{const owner=localStorage.getItem('same-page:appearance-owner');if(!owner)throw new Error('missing appearance owner');localStorage.setItem('same-page:appearance:'+owner,JSON.stringify({interfaceTheme:'dark',darkPaper:'inverted'}));window.dispatchEvent(new StorageEvent('storage',{key:'same-page:appearance:'+owner}));});
 await expect(page.locator('html')).toHaveAttribute('data-paper-theme','inverted');
 await expect(pieces.nth(1).locator('svg text').first()).toHaveCSS('fill','rgb(230, 230, 230)');
 await expect(timeline).toHaveValue('1');
 await closePractice(page);assert.deepEqual(errors,[]);
});

// Original CC0 controls: independent ensembles, meter/key/tempo, pickup and D.C.
async function opusMusicXmlFixture() {
 const {zipSync,strToU8}=await import('fflate');
 const names=['Soprano','Alto','Tenor','Bass'];
 const a=`<score-partwise version="4.0"><work><work-title>Original SATB A</work-title></work><part-list>${names.map((name,i)=>`<score-part id="A${i}"><part-name>${name}</part-name></score-part>`).join('')}</part-list>${names.map((_,i)=>`<part id="A${i}">${[1,2].map(number=>`<measure number="${number}">${number===1?`<attributes><divisions>1</divisions><key><fifths>2</fifths></key><time><beats>3</beats><beat-type>4</beat-type></time><clef><sign>${i===3?'F':'G'}</sign><line>${i===3?4:2}</line></clef></attributes><direction><sound tempo="180"/></direction>`:'<print new-system="yes"/>'}<note><pitch><step>${i%2?'A':'D'}</step><octave>${i<2?4:3}</octave></pitch><duration>3</duration><type>half</type><dot/></note></measure>`).join('')}</part>`).join('')}</score-partwise>`;
 const note=(duration,staff)=>`<note><pitch><step>C</step><octave>${staff===1?5:3}</octave></pitch><duration>${duration}</duration><voice>${staff}</voice><type>${duration===1?'quarter':'whole'}</type><staff>${staff}</staff></note>`;
 const b=`<score-partwise version="4.0"><work><work-title>Original Piano B</work-title></work><part-list><score-part id="B"><part-name>Piano</part-name></score-part></part-list><part id="B">${[1,2].map(number=>`<measure number="${number}"${number===1?' implicit="yes"':''}>${number===1?'<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes><direction><sound tempo="240"/></direction>':'<print new-page="yes"/>'}${note(number===1?1:4,1)}<backup><duration>${number===1?1:4}</duration></backup>${note(number===1?1:4,2)}${number===2?'<sound dacapo="yes"/>':''}</measure>`).join('')}</part></score-partwise>`;
 return Buffer.from(zipSync({'META-INF/container.xml':strToU8('<container><rootfiles><rootfile full-path="opus.xml"/></rootfiles></container>'),'opus.xml':strToU8('<opus version="4.0" xmlns:xlink="http://www.w3.org/1999/xlink"><title>Original two-piece controls</title><score xlink:href="a.musicxml"/><score xlink:href="b.musicxml"/></opus>'),'a.musicxml':strToU8(a),'b.musicxml':strToU8(b)}));
}
