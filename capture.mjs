import {chromium} from '/workspace/same-page/node_modules/@playwright/test/index.mjs';
const browser=await chromium.launch({args:['--no-sandbox']});
for(const width of [1024,390]){
 const page=await browser.newPage({viewport:{width,height:900},deviceScaleFactor:1,locale:'zh-CN'});
 page.on('pageerror',e=>console.log('PAGE ERROR',e.message));
 await page.goto('http://localhost:5173/lyrics-review.html');
 await page.waitForFunction(()=>document.querySelectorAll('#score svg text').length>30,{timeout:60000});
 await page.evaluate(()=>document.fonts.ready); await page.waitForTimeout(1200);
 await page.screenshot({path:`/tmp/lyrics-evidence/${process.argv[2]}-${width}.png`});
 console.log(width,await page.evaluate(()=>({status:window.session.getSnapshot().status,lyric:[...document.querySelectorAll('svg text')].filter(x=>x.textContent==='春').slice(0,2).map(x=>({text:x.textContent,html:x.outerHTML}))})));
 await page.close();
}await browser.close();
