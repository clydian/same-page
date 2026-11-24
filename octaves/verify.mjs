import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(process.cwd()+'/package.json');
const { chromium, expect } = require('@playwright/test');

const origin = process.env.SIGHT_QA_URL || 'http://127.0.0.1:4194';
const product = process.env.SIGHT_QA_BUILD || '3da052c09336550adf0860da09cf6f3e036ecec3';
const output = process.argv[2] || '/tmp/sight-play-preview/graph-octaves';
function installCapture() {
  const worklets = new WeakMap();
  const canvas = CanvasRenderingContext2D.prototype;
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
  window.qaToneSequence = [52, 62, 77, 67];
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


await mkdir(output, { recursive: true });
const browser = await chromium.launch({args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
try {
  const theme = process.env.SIGHT_QA_THEME || 'light';
  const phone = theme === 'light';
  const context = await browser.newContext({
    locale: phone ? 'zh-CN' : 'en-US', colorScheme: theme, hasTouch: phone,
    viewport: phone ? {width:390,height:844} : {width:1200,height:1000}, permissions:['microphone'],
  });
  const page = await context.newPage();
  const errors = [], api = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) api.push(request.url()); });
  await page.addInitScript(installCapture);
  await page.goto(origin);
  assert.equal((await (await context.request.get(origin+'/build.json')).json()).buildId, product);
  await page.getByRole('button',{name:/四声部试听/}).click();
  await page.getByRole('combobox',{name:phone?'我要唱的声部':'Part to sing'}).selectOption({label:'Alto'});
  await expect(page.locator('.challenge-notation-note[data-track="1"][data-midi="64"]').first()).toBeVisible();
  await page.getByRole('button',{name:phone?'开始唱':'Start singing',exact:true}).click();
  const monitor = page.locator('.challenge-pitch-details');
  await monitor.locator('summary').click();
  const graph = monitor.locator('figure');
  const legend = graph.locator('.challenge-graph-legend span').last();
  await expect(legend).toContainText('E3');
  const live = await page.evaluate(() => ({marker:window.qaMarker, target:window.qaTarget}));
  await expect(legend).toContainText('F5');
  await graph.screenshot({path:output+'/'+theme+'-live.png', timeout:5000});
  await expect(page.getByText(phone?'100 分':'100 points',{exact:true}).first()).toBeVisible();
  await expect(page.locator('.challenge-current-feedback')).toContainText('E3');
  await graph.screenshot({path:output+'/'+theme+'-result.png'});
  const plot = await graph.locator('canvas').evaluate(el => {
    const plot = el.getBoundingClientRect();
    const labels = [...el.closest('figure').querySelectorAll('.challenge-pitch-axis span')].map(label => {
      const rect = label.getBoundingClientRect();
      return [label.textContent, rect.top + rect.height / 2 - plot.top];
    });
    return { width:el.clientWidth, height:el.clientHeight, points:window.qaTrace, target:window.qaTarget, labels };
  });
  const mids = [0.5, 1.5, 2.5, 3.5].map(time => {
    const x = 8 + time / 4 * (plot.width - 16);
    const frames = plot.points.filter(([px]) => Math.abs(px - x) < (plot.width - 16) / 52);
    assert.ok(frames.length > 1);
    return frames.reduce((sum, [,y]) => sum + y, 0) / frames.length;
  });
  const staff = await page.locator('.challenge-staff-trace-curve').getAttribute('d');
  const head = await page.locator('.challenge-notation-note[data-track="1"][data-bar="0"][data-midi="64"]').first()
    .evaluate(button => ({x:parseFloat(button.style.left), y:parseFloat(button.style.top)}));
  const staffPoints = [...staff.matchAll(/[ML]([0-9.]+) ([0-9.]+)/g)].map(([,x,y]) => [Number(x), Number(y)])
    .filter(([x,y])=>x>head.x+3 && x<head.x+24 && Math.abs(y-head.y)<2);
  assert.ok(staffPoints.length > 3, 'Staff trace still aligns low octave to the written notehead');
  const numbers = {product, theme, score:100, actualY:mids, targetY:plot.target.map(([,y])=>y),
    liveE3Y:live.marker[1], axis:plot.labels};
  await writeFile(output+'/'+theme+'.json', JSON.stringify(numbers, null, 2));
  console.log(JSON.stringify(numbers));
  assert.ok(mids[0] > plot.target[0][1] + 25, 'E3 trace should be visibly below the written E4');
  assert.ok(mids[2] < plot.target[3][1] - 25, 'F5 trace should be visibly above the written F4');
  assert.ok(Math.abs(mids[1] - plot.target[2][1]) < 1, 'D4 trace should align with the written D4');
  assert.ok(Math.abs(mids[3] - plot.target[4][1]) < 1, 'G4 trace should align with the written G4');
  assert.ok(live.marker[1] > live.target[0][1] + 25, 'Live E3 marker should be below the written E4');
  for (const [label, index] of [['E3', 0], ['F5', 2]]) {
    const row = plot.labels.find(([name]) => name === label);
    assert.ok(row && Math.abs(row[1] - mids[index]) < 1, 'Axis label should line up with the sung ' + label);
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(api, []);
} finally {
  await browser.close();
}
