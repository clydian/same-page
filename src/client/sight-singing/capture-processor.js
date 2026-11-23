/* global AudioWorkletProcessor, registerProcessor, currentFrame */

// The input stream is routed into a silent node. Sample counts determine both
// the countdown and recording boundaries, independent of UI scheduling.
class SightSingingCapture extends AudioWorkletProcessor {
  constructor({ processorOptions: { beatFrames, beats, durationFrames, chunkFrames, startFrame } }) {
    super();
    this.beatFrames = beatFrames;
    this.beats = beats;
    this.durationFrames = durationFrames;
    this.position = -beatFrames * beats;
    this.startFrame = startFrame;
    this.count = 0;
    this.chunkFrames = chunkFrames;
    this.chunk = new Float32Array(chunkFrames);
    this.used = 0;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    const offset = this.startFrame === undefined ? 0 : Math.max(0, this.startFrame - currentFrame);
    for (let index = offset; index < input.length; index++) {
      const sample = input[index];
      if (this.position < 0) {
        const count = Math.ceil(-this.position / this.beatFrames);
        if (count !== this.count) {
          this.count = count;
          this.port.postMessage({ count });
        }
      } else {
        this.chunk[this.used++] = sample;
        const done = this.position + 1 >= this.durationFrames;
        if (this.used === this.chunk.length || done) {
          const samples = this.used === this.chunk.length ? this.chunk : this.chunk.slice(0, this.used);
          this.port.postMessage({ samples, done }, [samples.buffer]);
          if (done) return false;
          this.chunk = new Float32Array(this.chunkFrames);
          this.used = 0;
        }
      }
      this.position++;
    }
    return true;
  }
}

registerProcessor('sight-singing-capture', SightSingingCapture);
