import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(process.cwd()+'/package.json');
const { chromium, expect } = require('@playwright/test');


const origin = process.env.SIGHT_QA_URL || 'http://127.0.0.1:4199';
const build = process.env.SIGHT_QA_BUILD;
const output = process.argv[2] || '/tmp/sight-play-preview/key-colors';
function installCapture() {
  const worklets = new WeakMap();
  const canvas = CanvasRenderingContext2D.prototype;
  const {clearRect,fillRect}=canvas;
  canvas.clearRect=function(...rect) {
    if (this.canvas.closest('.challenge-graph')) window.qaGrid=[];
    return clearRect.apply(this,rect);
  };
  canvas.fillRect=function(x,y,w,h) {
    if (this.canvas.closest('.challenge-graph') && w>10 && h===1) window.qaGrid.push([x,y,w,this.fillStyle]);
    return fillRect.call(this,x,y,w,h);
  };
  const { beginPath, lineTo, stroke, arc } = canvas;
  canvas.beginPath = function () {
    this.qaPoints = [];
    return beginPath.call(this);
  };
  canvas.lineTo = function (x, y) {
    this.qaPoints?.push([x, y]);
    return lineTo.call(this, x, y);
  };
  canvas.stroke = function () {
    if (this.canvas.closest('.challenge-graph')) {
      if (Math.abs(this.lineWidth - 2.3) < .001) window.qaTrace = this.qaPoints;
      if (this.lineWidth === 5) window.qaTarget = this.qaPoints;
    }
    return stroke.call(this);
  };
  canvas.arc = function (x, y, ...rest) {
    if (this.canvas.closest('.challenge-graph')) window.qaMarker = [x, y];
    return arc.call(this, x, y, ...rest);
  };
  const nativeWorklet = window.AudioWorkletNode, nativeContext = window.AudioContext;
  const nativeStart = window.OscillatorNode.prototype.start;
  window.captureClock = [];
  window.scheduledPitches = [];
  window.audioProbe = [];
  window.lastWorkletMessages = [];
  window.audioContexts = [];
  window.qaToneSequence = [52, 62.35, 64, null];
  window.beatSounds = [];
  const nativeSourceStart = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (time, ...rest) {
    const clip = this.buffer;
    if (clip?.sampleRate === 44100 && Math.abs(clip.duration - .18) < .002) {
      const peak = clip.getChannelData(0).reduce((p,sample) => Math.max(p,Math.abs(sample)),0);
      window.beatSounds.push({ time, peak });
    }
    return nativeSourceStart.call(this,time,...rest);
  };
  window.OscillatorNode.prototype.start = function (time) {
    window.scheduledPitches.push({ frequency: this.frequency.value, time, context: this.context.constructor.name });
    return nativeStart.call(this, time);
  };
  window.AudioWorkletNode = class extends nativeWorklet {
    constructor(context, name, options) {
      super(context, name, options);
      worklets.set(this, options.processorOptions);
      window.captureClock.push(options.processorOptions);
      this.port.addEventListener('message', ({ data }) => {
        window.lastWorkletMessages.push(data.samples ? [data.samples.length, data.done] : data.count);
      });
    }
  };
  window.AudioContext = class extends nativeContext {
    constructor() { super({ sampleRate: 48000 }); window.audioContexts.push(this); }
    createMediaStreamSource() {
      // Real AudioWorklet and capture callbacks get calibrated synthetic samples.
      // GUM tracks are native Chromium fake media. This excludes acoustic bleed.
      const context = this;
      const source = context.createBufferSource();
      const connect = source.connect.bind(source);
      source.connect = node => {
        const { beatFrames, beats, durationFrames, startFrame } = worklets.get(node);
        const countFrames = beatFrames * beats;
        const noteFrames = beatFrames * (beats === 6 ? 3 : 2);
        const buffer = context.createBuffer(1, countFrames + durationFrames + beatFrames, context.sampleRate);
        const samples = buffer.getChannelData(0);
        const tones = window.qaToneSequence;
        for (let i = 0; i < durationFrames; i++) {
          const phase = i % noteFrames / noteFrames;
          if (phase < .07 || phase > .95) continue;
          const index = Math.floor(i / noteFrames);
          const midi = tones[index % tones.length];
          if (midi === null) continue;
          const t = i / context.sampleRate;
          samples[i + countFrames] = .35 * Math.sin(2 * Math.PI * 440 * 2 ** ((midi - 69) / 12) * t);
        }
        source.buffer = buffer;
        const result = connect(node);
        source.start(startFrame === undefined ? 0 : startFrame / context.sampleRate);
        source.onended = () => window.audioProbe.push({ end: context.currentTime, length: buffer.duration, time: Date.now() });
        return result;
      };
      return source;
    }
  };
}



await mkdir(output,{recursive:true});
const browser=await chromium.launch({args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
try {
  const phone=process.env.SIGHT_QA_THEME!=='dark';
  const name=phone?'phone':'desktop';
  const context=await browser.newContext({colorScheme:phone?'light':'dark', locale:phone?'zh-CN':'en-US',
    viewport:phone?{width:390,height:844}:{width:1230,height:1000}, hasTouch:phone, permissions:['microphone']});
  const page=await context.newPage(); page.setDefaultTimeout(10000);
  const errors=[], api=[];
  page.on('pageerror',error=>errors.push(String(error)));
  page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/')) api.push(request.url());});
  await page.addInitScript(installCapture);
  await page.goto(origin);
  assert.equal((await (await context.request.get(origin+'/build.json')).json()).buildId,build);
  const xml = await page.evaluate(async () => {
    const api='/api/choirs/visual-choir/sight-singing/questions';
    const {questions}=await (await fetch(api)).json();
    const answer=await (await fetch(api+'/'+questions[0].id+'/score')).text();
    return answer.replaceAll('<fifths>0</fifths>','<fifths>1</fifths>').replaceAll('<measure number="2">',
      '<measure number="2"><attributes><key><fifths>-1</fifths><mode>major</mode></key></attributes>');
  });
  const labels=phone?{create:'新建题目',name:'题目名称',source:'题目谱源',last:'结束小节',publish:'发布到云盘',voice:'我要唱的声部',start:'开始唱',points:'25 分',t:'准确'}:
    {create:'New question',name:'Question name',source:'Question score source',last:'Last measure',publish:'Publish to drive',voice:'Part to sing',start:'Start singing',points:'25 points',t:'In tune'};
  await page.getByRole('button',{name:labels.create}).click();
  await page.getByRole('textbox',{name:labels.name}).fill(phone?'调号与音准练习':'Key & intonation practice');
  await page.getByRole('combobox',{name:labels.source}).selectOption('upload');
  await page.locator('input[type=file]').setInputFiles({name:'two-keys.musicxml',mimeType:'application/vnd.recordare.musicxml+xml',buffer:Buffer.from(xml)});
  await page.getByRole('combobox',{name:labels.last}).selectOption('1');
  await page.getByRole('button',{name:labels.publish}).click();
  await page.getByRole('combobox',{name:labels.voice}).selectOption({label:'Alto'});
  const chosen=page.locator('.challenge-notation-note[data-track="1"][data-bar="0"][data-midi="64"]').first();
  const chordNeighbor=page.locator('.challenge-notation-note[data-track="1"][data-bar="0"][data-midi="60"]').first();
  await expect(chosen).toBeVisible();
  await page.getByRole('button',{name:labels.start,exact:true}).click();
  await expect(page.getByText(labels.points,{exact:true}).first()).toBeVisible({timeout:14_000});
  const notation=page.locator('.challenge-notation');
  const heads=notation.locator('svg text[data-challenge-feedback]');
  await expect(heads).toHaveCount(4);
  const colors=await heads.evaluateAll(elements=>Object.fromEntries(elements.map(el=>[el.dataset.challengeFeedback,getComputedStyle(el).fill])));
  assert.equal(Object.keys(colors).length,4);
  assert.equal(new Set(Object.values(colors)).size,3);
  await expect(notation.locator('g[data-challenge-part="context"] [data-challenge-feedback]')).toHaveCount(0);
  await expect(chosen).toHaveAttribute('aria-description',labels.t);
  await expect(chordNeighbor).not.toHaveAttribute('aria-description');
  await expect(notation.locator('.challenge-notation-feedback')).toHaveCount(0);
  await notation.screenshot({path:output+'/'+name+'-notation.png'});
  await page.locator('.challenge-pitch-details summary').click();
  const graph=page.locator('.challenge-pitch-details figure');
  const audio=page.locator('.challenge-run audio');
  await expect(audio).toBeAttached();
  const slider=page.locator('.challenge-replay-timeline input');
  for (const [time,tag,expected] of [[.42,'g',[true,false,false]],[2.42,'f',[false,true,true]]]) {
    await audio.evaluate((el,t)=>{el.currentTime=t;},time);
    await expect(slider).toHaveValue(String(time));
    for (const [pitch,index] of [['F♯4',0],['F4',1],['B♭3',2]]) {
      await expect(graph.locator('.challenge-pitch-axis').getByText(pitch,{exact:true})).toHaveAttribute('data-in-key',String(expected[index]));
    }
    const shaded=await graph.evaluate(el=>{
      const canvas=el.querySelector('canvas'),view=el.querySelector('.challenge-pitch-scroll');
      const key=getComputedStyle(canvas).getPropertyValue('--pitch-grid-scale').trim();
      const rows=Object.fromEntries([...el.querySelectorAll('.challenge-pitch-axis span')].map(label=>[label.textContent, Math.round(parseFloat(label.style.top)-view.scrollTop)]));
      return {...Object.fromEntries(Object.entries(rows).filter(([,y])=>y>5&&y<view.clientHeight-5).map(([pitch,y])=>
        [pitch,window.qaGrid.filter(([,row,,color])=>row===y&&color===key)])),key};
    });
    assert.ok(Object.values(shaded).some(row=>Array.isArray(row)&&row.length===1), 'Paint real scale emphasis across each key segment');
    if (tag==='f') {
      assert.ok(shaded['F♯4']?.[0]?.[0]===0 && shaded['F4']?.[0]?.[0]>0,
        'F sharp is dark only in the opening key; F natural is dark in the next key');
    }
    await graph.screenshot({path:output+'/'+name+'-key-'+tag+'.png'});
  }
  await page.locator('.challenge-review-details summary').click();
  await notation.scrollIntoViewIfNeeded();
  await expect(heads).toHaveCount(4);
  await page.screenshot({path:output+'/'+name+'-review.png',fullPage:true});
  assert.deepEqual(errors,[]); assert.deepEqual(api,[]);
  await page.getByRole('button',{name:phone?'再试一次':'Try again',exact:true}).click();
  await expect(heads).toHaveCount(0);
  await writeFile(output+'/'+name+'.json',JSON.stringify({build,colors,theme:phone?'light':'dark', checkedKeys:['G','F'],score:25},null,2));
  console.log(JSON.stringify({name,colors,success:true}));
} finally {await browser.close();}
