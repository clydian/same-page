import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(process.cwd()+'/package.json');
const { chromium, expect } = require('@playwright/test');



const origin = process.env.SIGHT_QA_URL || 'http://127.0.0.1:4201';
const build = process.env.SIGHT_QA_BUILD || '156920f064821b8d7e96558407694a3bf3e43c9d';
const output = process.argv[2] || '/tmp/sight-play-preview/intonation';
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
  const phone=process.env.SIGHT_QA_THEME!=='dark', name=phone?'phone':'desktop';
  const context=await browser.newContext({colorScheme:phone?'light':'dark', locale:phone?'zh-CN':'en-US',
    viewport:phone?{width:390,height:844}:{width:1230,height:1000}, hasTouch:phone, permissions:['microphone']});
  const page=await context.newPage(); page.setDefaultTimeout(10000);
  const errors=[], api=[];
  page.on('pageerror',error=>errors.push(String(error)));
  page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/')) api.push(request.url());});
  await page.addInitScript(installCapture);
  await page.goto(origin);
  assert.equal((await (await context.request.get(origin+'/build.json')).json()).buildId,build);
  const l = phone ? {
    part:'我要唱的声部', tonic:'持续主音', others:'其他声部伴奏', tip:'关闭耳机提示', start:'开始唱', preview:/预备/,
    points:'音准 40 分', boardPoints:'40 分', correct:'唱对 2/4', scoring:'评分规则', old:'92 分', details:'逐音反馈', play:'回听演唱与钢琴答案', stop:'停止回听', retry:'再试一次', best:'最佳成绩', filter:'成绩版本',
    published:'最佳成绩已发布', back:'返回题目列表', remove:'撤下 V1 成绩', confirm:'撤下成绩', cancel:'取消',
    initial:'88 分', fallback:'76 分',
  } : {
    part:'Part to sing', tonic:'Sustained tonic', others:'Other parts', tip:'Dismiss headphone tip', start:'Start singing', preview:/Get ready/,
    points:'Intonation · 40', boardPoints:'40 points', correct:'2/4 notes correct', scoring:'Scoring method', old:'92 points', details:'Note-by-note feedback', play:'Play recording with piano', stop:'Stop replay', retry:'Try again', best:'Best scores', filter:'Score version',
    published:'Best score published', back:'Back to questions', remove:'Remove V1 score', confirm:'Remove score', cancel:'Cancel',
    initial:'88 points', fallback:'76 points',
  };
  const run=page.locator('.challenge-run');
  const screen=stage=>page.screenshot({path:output+'/'+name+'-'+stage+'.png'});
  await page.getByRole('button',{name:/四声部试听/}).click();
  await page.getByRole('combobox',{name:l.part}).selectOption({label:'Alto'});
  const selected=run.locator('.challenge-notation-note[data-track="1"][data-midi="64"]').first();
  await expect(selected).toBeVisible();
  const bpm=run.locator('.challenge-notation-tempo'), buttons=run.locator('.challenge-speed button');
  const speed=run.locator('.challenge-speed output');
  await expect(speed).toHaveText('1.00×');
  await expect(bpm).toHaveText('♩ = 120');
  const down=buttons.first(), up=buttons.last();
  await down.click(); await expect(bpm).toHaveText('♩ = 90');
  await down.click(); await expect(bpm).toHaveText('♩ = 60'); await expect(down).toBeDisabled();
  for (const value of [90,120,150,180]) { await up.click(); await expect(bpm).toHaveText('♩ = '+value); }
  await expect(up).toBeDisabled();
  await down.click();
  await expect(speed).toHaveText('1.25×');
  const tonic=page.getByRole('button',{name:l.tonic,exact:true}), tip=page.getByRole('button',{name:l.tip,exact:true});
  await expect(tip).toHaveCount(0);
  await tonic.click(); await expect(tip).toBeVisible(); await expect(tonic).toHaveAttribute('aria-pressed','true');
  await screen('headphones');
  await tip.click(); await expect(tip).toHaveCount(0);
  await tonic.click(); await expect(tip).toHaveCount(0);
  await tonic.click(); await expect(tip).toBeVisible(); await tip.click(); await tonic.click();
  const backing=run.locator('button.challenge-option').last();
  await backing.click(); await expect(tip).toBeVisible(); await tip.click(); await backing.click();
  await down.click(); await down.click();
  await expect(speed).toHaveText('0.75×');
  await run.scrollIntoViewIfNeeded();
  await screen('setup');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),phone?390:1230);
  await page.getByRole('button',{name:l.start,exact:true}).click();
  await run.locator('.challenge-count').waitFor();
  await screen('count');
  await page.locator('.challenge-run[data-phase="sing"]').waitFor();
  await expect(run.locator('.challenge-staff-trace-curve')).toBeVisible();
  await screen('singing');
  await expect(page.getByText(l.points,{exact:true}).first()).toBeVisible({timeout:13000});
  await expect(page.getByText(l.published,{exact:true})).toBeVisible();
  await expect(run.locator('.challenge-staff-trace-curve')).toHaveCount(0);
  const heads=run.locator('svg text[data-challenge-feedback]');
  const stems=run.locator('svg rect[data-challenge-feedback]');
  await expect(heads).toHaveCount(4);
  await expect(run.getByText(l.correct,{exact:true})).toBeVisible();
  const inks = await heads.evaluateAll(nodes=>Object.fromEntries(nodes.map(el=>[el.dataset.challengeFeedback,
    {fill:getComputedStyle(el).fill,stroke:getComputedStyle(el).stroke,width:parseFloat(getComputedStyle(el).strokeWidth)}])));
  assert.equal(inks.inTune.fill,inks.sharp.fill);
  assert.equal(inks.wrongNote.fill,inks.missed.fill);
  assert.notEqual(inks.inTune.fill,inks.wrongNote.fill);
  for (const shape of Object.values(inks)) {assert.equal(shape.fill,shape.stroke); assert.ok(shape.width >= .65);}

  await expect(stems).toHaveCount(3);
  assert.ok(await stems.evaluateAll(nodes=>nodes.every(node=>parseFloat(getComputedStyle(node).strokeWidth) === 1)));
  await expect(run.locator('input[type="range"]')).toHaveCount(0);
  await expect(run.getByRole('button',{name:l.play,exact:true})).toBeEnabled();
  await screen('result');
  const noteRows = run.locator('.challenge-review-details');
  await noteRows.locator('summary').click();
  await expect(noteRows.getByText(phone?'偏高':'Sharp',{exact:true})).toBeVisible();
  const signedError = await noteRows.locator('tbody tr').nth(1).locator('td').nth(3).innerText();
  assert.ok(Number(signedError) > 34 && Number(signedError) < 36, signedError);
  await screen('details');
  await noteRows.locator('summary').click();

  const audio=run.locator('audio'), playback=()=>audio.evaluate(el=>el.currentTime);
  const path=()=>run.locator('.challenge-staff-trace-curve').getAttribute('d');
  await run.getByRole('button',{name:l.play,exact:true}).click();
  await expect.poll(playback,{intervals:[20,25,40,80]}).toBeGreaterThan(.33);
  await expect(run.locator('.challenge-staff-trace-curve')).toBeVisible();
  await screen('replay');
  await run.getByRole('button',{name:l.stop,exact:true}).click();
  await expect(run).toHaveAttribute('data-replaying','false');
  const paused=await playback(), pausedPath=await path();
  await page.waitForTimeout(120);
  assert.ok(Math.abs((await playback())-paused)<.05);
  assert.equal(await path(),pausedPath);
  await run.getByRole('button',{name:l.play,exact:true}).click();
  await expect.poll(playback,{intervals:[20,25,40,80]}).toBeGreaterThan(paused+.13);
  assert.ok(await playback()<paused+.55);
  await run.getByRole('button',{name:l.stop,exact:true}).click();
  await expect(run).toHaveAttribute('data-replaying','false');
  const last=run.locator('.challenge-notation-note[data-track="1"][data-bar="1"][data-beat-index="1"]').first();
  await last.click();
  const barStart=2/.75;
  await expect.poll(playback,{intervals:[20,25,40,80]}).toBeGreaterThan(barStart-.03);
  assert.ok(await playback()<barStart+.45, 'Clicking a later note should start at the beginning of its measure');
  await run.getByRole('button',{name:l.stop,exact:true}).click();
  await expect(run).toHaveAttribute('data-replaying','false');
  await selected.click();
  await expect.poll(playback,{intervals:[20,25,40,80]}).toBeLessThan(.45);
  await run.getByRole('button',{name:l.stop,exact:true}).click();
  await expect(run).toHaveAttribute('data-replaying','false');
  const board=page.locator('.challenge-published-results');
  await board.locator('summary').click();
  await expect(board.getByText('Alto · V1 · 0.75×',{exact:true})).toBeVisible();
  await expect(board.getByText(l.boardPoints,{exact:true})).toBeVisible();
  await screen('auto-published');
  await page.getByRole('button',{name:l.back,exact:true}).click();
  await page.getByRole('button',{name:/四声部练唱/}).click();
  await board.locator('summary').click();
  await expect(board.getByText(l.initial,{exact:true})).toBeVisible();
  const scoring=board.getByRole('combobox',{name:l.scoring});
  await expect(scoring).toHaveValue('2');
  await scoring.selectOption('1');
  await expect(board.getByText(l.old,{exact:true})).toBeVisible();
  await expect(board.getByText(l.initial,{exact:true})).toHaveCount(0);
  await screen('previous-scoring');
  await scoring.selectOption('2');
  await expect(board.getByText(l.initial,{exact:true})).toBeVisible();
  const filter=board.getByRole('combobox',{name:l.filter});
  await filter.selectOption('2');
  await expect(board.getByText(l.fallback,{exact:true})).toBeVisible();
  await expect(board.getByText(l.initial,{exact:true})).toHaveCount(0);
  await filter.selectOption('');
  await expect(board.getByText(l.initial,{exact:true})).toBeVisible();
  await screen('best-all');
  await board.getByRole('button',{name:l.remove,exact:true}).click();
  const dialog=page.getByRole('dialog');
  await expect(dialog.getByText(l.remove,{exact:true})).toBeVisible();
  await screen('withdraw');
  await dialog.getByRole('button',{name:l.confirm,exact:true}).click();
  await expect(board.getByText(l.fallback,{exact:true})).toBeVisible();
  await expect(board.getByText(l.initial,{exact:true})).toHaveCount(0);
  assert.deepEqual(api,[]); assert.deepEqual(errors,[]);
  await writeFile(output+'/'+name+'.json',JSON.stringify({build,score:40, correct:2,paused,barStart,firstVersions:['V1','V2'],inks,signedError,api,errors},null,2));
  console.log(JSON.stringify({name,passed:true,score:40, correct:2,paused,barStart}));
} finally {await browser.close();}
