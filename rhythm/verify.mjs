import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(process.cwd()+'/package.json');
const { chromium, expect } = require('@playwright/test');
const origin = process.env.SIGHT_QA_URL || 'http://127.0.0.1:4193';
const output = process.argv[2] || '/tmp/sight-play-preview/rhythm-evidence-release';
const product = '9ae353094a71a0b6074c4a219298b8ceaf7f8ea6';

function installCapture() {
  const worklets = new WeakMap();
  const nativeWorklet = window.AudioWorkletNode, nativeContext = window.AudioContext;
  const nativeStart = window.OscillatorNode.prototype.start;
  window.captureClock = [];
  window.scheduledPitches = [];
  window.audioProbe = [];
  window.lastWorkletMessages = [];
  window.audioContexts = [];
  window.qaToneSequence = [52, 50, 53, 55, 57, 55, 53, 52];
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
const browser = await chromium.launch({ args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'] });
const evidence = [];
const api = '/api/choirs/visual-choir/sight-singing/questions';
try {
  for (const example of [
    {name:'phone-zh', locale:'zh-CN', theme:'light', viewport:{width:390,height:844}, hasTouch:true, beats:4, value:.75, expected:100},
    {name:'desktop-en', locale:'en-US', theme:'dark', viewport:{width:1200,height:1000}, hasTouch:false, beats:4, value:1, expected:75},
    {name:'phone-68', locale:'zh-CN', theme:'light', viewport:{width:390,height:844}, hasTouch:true, beats:6, value:1, expected:100},
  ].filter(example => !process.env.SIGHT_QA_CASE || example.name === process.env.SIGHT_QA_CASE)) {
    const {name,locale,theme,viewport,hasTouch,beats,value,expected} = example;
    const context = await browser.newContext({ locale, colorScheme:theme, viewport, hasTouch, permissions:['microphone'] });
    const page = await context.newPage();
    const bad = [], network = [];
    page.on('pageerror',error=>bad.push(String(error)));
    page.on('request',request=> { if (new URL(request.url()).pathname.startsWith('/api/')) network.push(request.url()); });
    await page.addInitScript(installCapture);
    await page.goto(origin);
    assert.equal((await (await context.request.get(origin+'/build.json')).json()).buildId,product);
    if (expected===75) await page.evaluate(()=>{window.qaToneSequence[0]=52.35;});
    const l = locale==='zh-CN' ? { voice:'我要唱的声部', start:'开始唱', beat:/预备/, speed:'播放速度', points:expected+' 分',
       alignment:'演唱轨迹已按谱面八度对齐', details:'逐音反馈', replay:'回听演唱与钢琴答案' } :
      { voice:'Part to sing', start:'Start singing', beat:/Get ready/, speed:'Playback speed', points:expected+' points',
       alignment:'Sung trace aligned to the score octave', details:'Note-by-note feedback', replay:'Play recording with piano' };
    await page.getByRole('button',{name:beats===6?/六八拍练习/:/四声部试听/}).click();
    await page.getByRole('combobox',{name:l.voice}).selectOption({label:'Alto'});
    await expect(page.locator('.challenge-notation-note[data-track="1"][data-midi="64"]').first()).toBeVisible();
    const speed = page.getByRole('slider',{name:l.speed});
    if (value!==1) {
      await speed.press('Home');
      for (let i=0;i<25;i++) await speed.press('ArrowRight');
      await expect(speed).toHaveValue(String(value));
    }
    await speed.blur();
    await page.screenshot({path:output+'/'+name+'-ready.png'});
    const soundfont = page.waitForResponse(response => response.url().includes('/playback/'+product+'/soundfont/sonivox.sf2') && response.ok());
    await page.getByRole('button',{name:l.start,exact:true}).click();
    await soundfont;
    await expect(page.getByText(l.beat).first()).toBeVisible();
    await page.screenshot({path:output+'/'+name+'-count.png'});
    await page.locator('.challenge-run[data-phase="sing"]').waitFor();
    await expect(page.getByText(l.alignment,{exact:true})).toBeVisible();
    await page.screenshot({path:output+'/'+name+'-sing.png'});
    await expect(page.getByText(l.points,{exact:true}).first()).toBeVisible({timeout:25000});
    await expect(page.locator('.challenge-current-feedback')).toContainText('E4');
    await expect(page.locator('.challenge-current-feedback')).toContainText('E3');
    await expect(page.getByRole('button',{name:l.replay,exact:true})).toBeVisible();
    const audio = await page.evaluate(() => ({beat:window.captureClock[0], pulses:window.beatSounds, piano:window.scheduledPitches.filter(x=>x.context==='OfflineAudioContext').map(x=>x.frequency)}));
    const beatSeconds = (beats===4?.5:1/3)/value;
    const intervals = audio.pulses.slice(1).map((p,i)=>p.time-audio.pulses[i].time);
    assert.ok(intervals.length>=beats*2-1);
    assert.ok(intervals.every(delta=> Math.abs(delta-beatSeconds)<.0001),{intervals,beatSeconds});
    assert.equal(audio.pulses.length,beats*(1+(beats===4?2:4)));
    for (let i=0;i<audio.pulses.length;i+=beats) {
      const p=audio.pulses;
      assert.ok(p[i].peak>p[i+1].peak);
      if (beats===6) assert.ok(p[i].peak>p[i+3].peak && p[i+3].peak>p[i+4].peak);
    }
    assert.ok(audio.piano.some(hz=>Math.round(69+12*Math.log2(hz/440))===52));
    assert.ok(!audio.piano.some(hz=>Math.round(69+12*Math.log2(hz/440))===64));
    await page.screenshot({path:output+'/'+name+'-result.png',fullPage:true});
    if (beats===4) {
      await page.locator('.challenge-review-details summary').click();
      await expect(page.getByText('E3',{exact:true}).last()).toBeVisible();
      await page.screenshot({path:output+'/'+name+'-notes.png',fullPage:true});
      await page.getByRole('button',{name:l.replay,exact:true}).click();
      await expect.poll(()=>page.locator('.challenge-run audio').evaluate(a=>a.currentTime)).toBeGreaterThan(.05);
      await expect(page.locator('.challenge-replay-timeline input')).toBeVisible();
      const secondBar = page.locator('.challenge-notation-note[data-track="1"][data-bar="1"][data-midi="65"]').first();
      await secondBar.scrollIntoViewIfNeeded();
      const rect = await secondBar.boundingBox();
      assert.ok(rect);
      if (hasTouch) await page.touchscreen.tap(rect.x+rect.width/2,rect.y+rect.height/2);
      else await page.mouse.click(rect.x+rect.width/2,rect.y+rect.height/2);
      await expect.poll(()=>page.locator('.challenge-run audio').evaluate(a=>a.currentTime)).toBeGreaterThanOrEqual(2/value-.02);
      await expect(page.locator('.challenge-current-feedback')).toContainText('F3');
      await page.screenshot({path:output+'/'+name+'-seek.png',fullPage:true});
      await page.locator('.challenge-note-replay').first().click();
      await expect.poll(()=>page.locator('.challenge-run audio').evaluate(a=>a.currentTime)).toBeLessThan(.6);

    }
    assert.deepEqual(network,[]);
    assert.deepEqual(bad,[]);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth),viewport.width);
    evidence.push({name,beats,speed:value,score:expected,clicks:audio.pulses.length,beatSeconds,
      duration:audio.beat.durationFrames/48000, peaks:audio.pulses.slice(0,beats).map(p=>Number(p.peak.toFixed(4)))});
    await context.close();
  }
  await writeFile(output+'/metrics.json', JSON.stringify({product,evidence},null,2));
  console.log(JSON.stringify(evidence));
} finally { await browser.close(); }
