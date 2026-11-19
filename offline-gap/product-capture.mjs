import {startStorageFixture} from './browser-tests/storage-fixture.mjs';
import {chromium,expect} from '@playwright/test';
import {musicXmlFixture} from './browser-tests/musicxml-fixture.mjs';
import {writeFile,mkdir} from 'node:fs/promises';
const fixture=await startStorageFixture({authenticated:true,previewEntry:false,script:'preview'});
await mkdir('/tmp/offline-gap-evidence',{recursive:true});
const browser=await chromium.launch({args:['--no-sandbox','--remote-debugging-port=9230']});
const context=await browser.newContext({locale:'zh-CN',viewport:{width:1024,height:900},serviceWorkers:'block',hasTouch:true});
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

await page.screenshot({path:'/tmp/offline-gap-evidence/diagnostic.png'});console.log('BODY',await page.locator('body').innerText());

if(await page.getByRole('button',{name:'显示阅读器工具',exact:true}).count()){await page.getByRole('button',{name:'显示阅读器工具',exact:true}).focus();await page.keyboard.press('Enter');}
await page.getByRole('button',{name:'练习谱',exact:true}).click();await page.getByRole('button',{name:'春风合唱.xml',exact:true}).click();
await expect(page.getByTestId('musicxml-player').getByRole('button',{name:'播放',exact:true})).toBeEnabled({timeout:60000});
await writeFile('/tmp/offline-gap-evidence/url.txt',fixture.origin);
console.log('READY',fixture.origin);


const bar=page.getByTestId('musicxml-player');
if(await page.getByRole('button',{name:'展开练习控制',exact:true}).isVisible())await page.getByRole('button',{name:'展开练习控制',exact:true}).click();
await page.getByRole('button',{name:'练习设置',exact:true}).click();
await expect(page.getByRole('button',{name:'进阶设置',exact:true})).toHaveAttribute('aria-expanded','false');
await expect(page.getByRole('button',{name:'重试离线准备',exact:true})).toHaveCount(0);
await expect(page.getByText('离线准备未完成。',{exact:true})).toHaveCount(0);
await page.screenshot({path:'/tmp/offline-gap-evidence/default-desktop.png'});
await page.setViewportSize({width:390,height:844});
await expect.poll(()=>page.locator('.at-surface svg').first().evaluate(e=>e.getBoundingClientRect().width)).toBeLessThan(390);
await page.screenshot({path:'/tmp/offline-gap-evidence/default-mobile.png'});
await page.getByRole('button',{name:'进阶设置',exact:true}).click();
await expect(page.getByRole('button',{name:'重试离线准备',exact:true})).toBeVisible();
await page.screenshot({path:'/tmp/offline-gap-evidence/advanced-mobile.png'});

console.log('CURRENT HEAD: normal default is clean; advanced still contains the sole offline retry');
await browser.close();await fixture.stop();
