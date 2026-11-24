import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(process.cwd()+'/package.json');
const { chromium, expect } = require('@playwright/test');


const origin = process.env.SIGHT_QA_URL || 'http://127.0.0.1:4196';
const product = process.env.SIGHT_QA_BUILD || '6da366507d089fc3ad729f6f0f6a60b5ce8c6c14';
const output = process.argv[2] || '/tmp/sight-play-preview/register-before';
const mode = process.env.SIGHT_QA_MODE || 'baseline';
function installCapture() {
  const worklets = new WeakMap();
  const canvas = CanvasRenderingContext2D.prototype;
  const { beginPath, lineTo, moveTo, stroke, arc } = canvas;
  canvas.beginPath = function () {
    this.qaPoints = [];
    return beginPath.call(this);
  };
  canvas.lineTo = function (x, y) {
    this.qaPoints?.push(['L', x, y]);
    return lineTo.call(this, x, y);
  };
  canvas.moveTo = function (x, y) {
    this.qaPoints?.push(['M', x, y]);
    return moveTo.call(this, x, y);
  };
  canvas.stroke = function () {
    if (this.canvas.closest('.challenge-graph')) {
      if (Math.abs(this.lineWidth - 2.3) < .001) window.qaTrace = this.qaPoints;
      if (this.lineWidth === 5) window.qaTarget = this.qaPoints;
      if (this.getLineDash().length) window.qaGuides = this.qaPoints;
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
  window.qaToneSequence = [52.16, 50, 53, 55, 57, 55, 65, 64, 64, 62, 65, 67, 69, 67, 77.16, 76];
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
          const index = Math.floor(i / noteFrames);
          const t = i / context.sampleRate;
          const since = (i % noteFrames) / context.sampleRate;
          const until = (noteFrames - i % noteFrames) / context.sampleRate;
          const beforeBreak = index === 5 || index === 13;
          const afterBreak = index === 6 || index === 14;
          const artifact = (beforeBreak && until <= .018) || (afterBreak && since <= .012);
          if (artifact) {
            // Brief pitched edge in otherwise breath-like low-level noise.
            samples[i + countFrames] = .12 * Math.sin(2 * Math.PI * 440 * 2 ** ((82 - 69) / 12) * t);
          } else if ((!afterBreak && phase < .055) || (afterBreak && since < .026) || phase > (beforeBreak ? .96 : .945)) {
            samples[i + countFrames] = .004 * (Math.sin(i * 7.13) + Math.cos(i * 13.91));
          } else {
            const midi = tones[index % tones.length];
            samples[i + countFrames] = .35 * Math.sin(2 * Math.PI * 440 * 2 ** ((midi - 69) / 12) * t);
          }
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
  const phone = process.env.SIGHT_QA_THEME !== 'dark';
  const context = await browser.newContext({
    locale: phone ? 'zh-CN' : 'en-US', colorScheme: phone ? 'light' : 'dark', hasTouch: phone,
    viewport: phone ? {width:390,height:844} : {width:1270,height:1050}, permissions:['microphone'],
  });
  const page = await context.newPage();
  const errors = [], api = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) api.push(request.url()); });
  await page.addInitScript(installCapture);
  await page.goto(origin);
  assert.equal((await (await context.request.get(origin+'/build.json')).json()).buildId, product);
  await page.getByRole('button',{name:/四声部练唱/}).click();
  await page.getByRole('combobox',{name:phone?'我要唱的声部':'Part to sing'}).selectOption({label:'Alto'});
  await expect(page.locator('.challenge-notation-note[data-track="1"][data-midi="64"]').first()).toBeVisible();
  await page.getByRole('button',{name:phone?'开始唱':'Start singing',exact:true}).click();
  const monitor = page.locator('.challenge-pitch-details');
  await monitor.locator('summary').click();
  const graph = monitor.locator('figure');
  const legend = graph.locator('.challenge-graph-legend [data-kind=voice], .challenge-graph-legend span:last-child').last();
  const name = phone ? 'phone' : 'desktop';
  const inspect = () => graph.evaluate(el => {
    const canvas = el.querySelector('canvas');
    const scroll = el.querySelector('.challenge-pitch-scroll');
    return {width:canvas.clientWidth,height:canvas.clientHeight, viewTop:scroll?.scrollTop, viewHeight:scroll?.clientHeight,
      voice:window.qaTrace, targets:window.qaTarget, guides:window.qaGuides, marker:window.qaMarker,
      labels:[...el.querySelectorAll('.challenge-pitch-axis span')].map(label=>label.textContent)};
  });
  await expect(legend).toContainText('E3', {timeout:6000});
  const low = await inspect();
  await graph.screenshot({path:output+'/'+name+'-sing-low.png'});
  await expect(legend).toContainText('F5', {timeout:24000});
  const high = await inspect();
  await graph.screenshot({path:output+'/'+name+'-sing-high.png'});
  await expect(page.getByText(phone?'100 分':'100 points',{exact:true}).first()).toBeVisible({timeout:9000});
  const audio = page.locator('.challenge-run audio');
  await expect(audio).toBeAttached();
  await audio.evaluate(el=>{el.currentTime=7.53;});
  await expect.poll(()=>page.locator('.challenge-replay-timeline input').inputValue()).toBe('7.53');
  const eighth = page.locator('.challenge-notation-note[data-track="1"][data-bar="7"]').first();
  const fourth = page.locator('.challenge-notation-note[data-track="1"][data-bar="3"]').first();
  const staffAt = hit => hit.evaluate(element => {
    const holder = element.closest('.challenge-notation');
    const x = parseFloat(element.style.left);
    const y = parseFloat(element.style.top);
    const points = [...holder.querySelector('.challenge-staff-trace-curve').getAttribute('d').matchAll(/([ML])([0-9.]+) ([0-9.]+)/g)]
      .map(([,verb,px,py])=>[verb,Number(px),Number(py)]);
    const window = points.flatMap((point, index) => {
      if (Math.abs(point[1]-x)>25 || Math.abs(point[2]-y)>45) return [];
      return [[point,points[index-1]??point]];
    });
    return {x,y,window};
  });
  const bar4 = await staffAt(fourth);
  await audio.evaluate(el=>{el.currentTime=17.53;});
  await expect.poll(()=>page.locator('.challenge-replay-timeline input').inputValue()).toBe('17.53');
  const bar8 = await staffAt(eighth);
  const longJumps = bar => bar.window.filter(([p,q])=>p[0]==='L' && Math.abs(p[2]-q[2])>13 && Math.abs(p[1]-q[1])<22);
  const summary = {product, score:100, lowTop:low.viewTop, highTop:high.viewTop, bar4Jumps:longJumps(bar4),bar8Jumps:longJumps(bar8)};
  const notation = page.locator('.challenge-notation');
  await notation.screenshot({path:output+'/'+name+'-staff.png'});
  if (mode === 'baseline') {
    await writeFile(output+'/'+name+'.json', JSON.stringify({summary, bar4, bar8, low, high},null,2));
    console.log(JSON.stringify(summary));
    assert.equal(summary.bar4Jumps.length+summary.bar8Jumps.length,0,'Break false staff connections at the phrase boundaries');
    assert.ok(high.viewTop+160<low.viewTop,'Use a local vertical window that follows the sung register');
  } else {
    const view = graph.locator('.challenge-pitch-scroll');
    const follow = graph.getByRole('button',{name:phone?'跟随音高':'Follow pitch'});
    await expect(follow).toHaveAttribute('aria-pressed','true');
    const replay = graph.locator('.challenge-graph-legend [data-kind=voice]');
    await page.getByRole('button',{name:phone?'回听演唱与钢琴答案':'Play recording with piano',exact:true}).click();
    await expect(replay).toContainText('F5');
    const replayHigh = await inspect();
    await page.getByRole('button',{name:phone?'暂停回听':'Pause playback',exact:true}).click();
    await view.focus();
    const highTop = await view.evaluate(el=>el.scrollTop);
    await view.press('PageDown');
    await expect(follow).toHaveAttribute('aria-pressed','false');
    assert.ok(await view.evaluate(el=>el.scrollTop)>highTop+50);
    await follow.click();
    await expect(follow).toHaveAttribute('aria-pressed','true');
    assert.ok(await view.evaluate(el=>el.scrollTop)<highTop+55);
    assert.ok(low.viewTop>high.viewTop+180);
    assert.ok(0 < high.marker[1] && high.marker[1] < high.viewHeight);
    assert.ok(0 < low.marker[1] && low.marker[1] < low.viewHeight);
    assert.ok(replayHigh.viewTop < low.viewTop-160);
    assert.ok(low.guides.some(([p,x,y])=>p==='M' && x<14 && Math.abs(y-low.marker[1])<5));
    const maxStrokeRise = draw => draw.slice(1).reduce((largest, [cmd,,y], index) =>
      cmd === 'L' ? Math.max(largest, Math.abs(y - draw[index][2])) : largest, 0);
    assert.ok(maxStrokeRise(high.voice) < 48.1, 'Large jumps must begin separate segments');
    if (phone) {
      await view.scrollIntoViewIfNeeded();
      const start = await view.evaluate(el => el.scrollTop);
      const box = await view.boundingBox();
      const cdp = await context.newCDPSession(page);
      const x = Math.round(box.x + box.width / 2);
      const y = Math.round(box.y + box.height - 28);
      await cdp.send('Input.dispatchTouchEvent', {type:'touchStart', touchPoints:[{x,y}]});
      for (const dy of [18, 42, 66, 90]) {
        await cdp.send('Input.dispatchTouchEvent', {type:'touchMove', touchPoints:[{x,y:y-dy}]});
        await page.waitForTimeout(30);
      }
      await cdp.send('Input.dispatchTouchEvent', {type:'touchEnd', touchPoints:[]});
      await expect(follow).toHaveAttribute('aria-pressed','false');
      assert.ok(await view.evaluate(el=>el.scrollTop)>start+40);
      await graph.screenshot({path:output+'/'+name+'-manual.png'});
      await follow.click();
      await expect(follow).toHaveAttribute('aria-pressed','true');
    }
    assert.equal(summary.bar4Jumps.length+summary.bar8Jumps.length,0);
    assert.deepEqual(errors, []);
    assert.deepEqual(api, []);
    await graph.screenshot({path:output+'/'+name+'-review.png'});
    await writeFile(output+'/'+name+'.json',JSON.stringify({...summary,viewHeight:high.viewHeight,replayTop:replayHigh.viewTop,largestTraceStroke:maxStrokeRise(high.voice),staffBoundaries:{bar4,bar8}},null,2));
    console.log(JSON.stringify(summary));
  }
} finally { await browser.close(); }
