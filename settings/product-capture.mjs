import {startStorageFixture} from './browser-tests/storage-fixture.mjs';
import {chromium,expect} from '@playwright/test';
import {musicXmlFixture} from './browser-tests/musicxml-fixture.mjs';
import {writeFile,mkdir} from 'node:fs/promises';
const fixture=await startStorageFixture({authenticated:true,previewEntry:false,script:'preview'});
await mkdir('/tmp/settings-evidence',{recursive:true});
const browser=await chromium.launch({args:['--no-sandbox','--remote-debugging-port=9226']});
const context=await browser.newContext({locale:'zh-CN',viewport:{width:1024,height:900},serviceWorkers:'block'});
await context.addInitScript(()=>localStorage.setItem('reader-gesture-hint-seen','true'));
await context.request.post(fixture.origin+'/api/auth/sign-in/email',{headers:{origin:fixture.origin},data:{email:fixture.accounts[0].email,password:fixture.accounts[0].password}});
let xml=musicXmlFixture(24).toString().replace('Soprano','女高音').replace('Alto','女低音');
xml=xml.replaceAll('<duration>4</duration><type>whole</type></note>','<duration>4</duration><type>whole</type><lyric><text>春风轻轻吹</text></lyric></note>');
const bytes=Buffer.from(xml), id=crypto.randomUUID();
const upload=await context.request.post(`${fixture.origin}/api/choirs/${fixture.choirId}/scores/${fixture.scoreId}/attachments/${id}/file?name=春风合唱.xml&size=${bytes.length}`,{data:bytes,headers:{'content-length':String(bytes.length)}});
console.log('UPLOAD',upload.status(),await upload.text());
const page=await context.newPage();page.on('pageerror',e=>console.log('PAGEERROR',e.message));
await page.goto(`${fixture.origin}/choirs/${fixture.choirId}/scores/${fixture.scoreId}`);
await expect(page.locator('canvas[data-pdf-canvas-active]').first()).toBeVisible({timeout:30000});

await page.screenshot({path:'/tmp/settings-evidence/diagnostic.png'});console.log('BODY',await page.locator('body').innerText());

if(await page.getByRole('button',{name:'显示阅读器工具',exact:true}).count()){await page.getByRole('button',{name:'显示阅读器工具',exact:true}).focus();await page.keyboard.press('Enter');}
await page.getByRole('button',{name:'练习谱',exact:true}).click();await page.getByRole('button',{name:'春风合唱.xml',exact:true}).click();
await expect(page.getByTestId('musicxml-player').getByRole('button',{name:'播放',exact:true})).toBeEnabled({timeout:60000});
await writeFile('/tmp/settings-evidence/url.txt',fixture.origin);
console.log('READY',fixture.origin);
const bar=page.getByTestId('musicxml-player');
if(await page.getByRole('button',{name:'展开练习控制',exact:true}).isVisible()) await page.getByRole('button',{name:'展开练习控制',exact:true}).click();
await page.getByRole('button',{name:'练习设置',exact:true}).click();
await page.screenshot({path:'/tmp/settings-evidence/after-default-desktop.png'});
await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/settings-evidence/after-default-mobile.png'});
await page.setViewportSize({width:1024,height:900});
await page.getByRole('button',{name:'声部混音',exact:true}).click();
for(const name of ['声部关注','片段循环','首调数字']){const sw=page.getByRole('switch',{name,exact:true});await sw.focus();await page.keyboard.press('Space');}
await page.getByRole('combobox',{name:'关注声部',exact:true}).selectOption('1');
await page.getByRole('combobox',{name:'标注范围',exact:true}).selectOption('1');
await page.getByRole('slider',{name:'其他声部音量',exact:true}).focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');
const font=()=>page.locator('svg text').evaluateAll(nodes=>nodes.filter(n=>n.textContent==='春风轻轻吹').map(n=>parseFloat(n.style.fontSize)));
const size=page.getByRole('combobox',{name:'歌词字号',exact:true});
const result=[];
for(const [value,expected] of [['12',7.2],['16',9.6],['18',10.8]]){
 await size.selectOption(value);await expect.poll(async()=>Math.abs((await font())[0]-expected)).toBeLessThan(.01);result.push({value,actual:(await font())[0]});
 await expect(page.getByRole('combobox',{name:'关注声部',exact:true})).toHaveValue('1');
 await expect(page.getByRole('combobox',{name:'标注范围',exact:true})).toHaveValue('1');
 await expect(page.getByRole('switch',{name:'片段循环',exact:true})).toBeChecked();
 await expect(page.getByRole('slider',{name:'其他声部音量',exact:true})).toHaveValue('0.05');
}
await size.selectOption('16');
const panel=page.locator('.practice-panel-content');
await panel.evaluate(e=>e.scrollTop=0);await page.screenshot({path:'/tmp/settings-evidence/after-mixer-desktop.png'});
await page.getByRole('button',{name:'声部混音',exact:true}).click();
await panel.evaluate(e=>e.scrollTop=0);await page.screenshot({path:'/tmp/settings-evidence/after-compact-desktop.png'});
await page.setViewportSize({width:390,height:844});await panel.evaluate(e=>e.scrollTop=0);await page.screenshot({path:'/tmp/settings-evidence/after-compact-mobile.png'});
await page.getByRole('button',{name:'声部混音',exact:true}).click();await panel.evaluate(e=>e.scrollTop=0);await page.screenshot({path:'/tmp/settings-evidence/after-mixer-mobile.png'});
console.log('SIZE CHECKS',JSON.stringify(result));
await writeFile('/tmp/settings-evidence/validation.json',JSON.stringify({sizes:result,revision:'working tree',transport:'pending playback and reopen checks'},null,2));
console.log('CAPTURED');
await new Promise(()=>{});
