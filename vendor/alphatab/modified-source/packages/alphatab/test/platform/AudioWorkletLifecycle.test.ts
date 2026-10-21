import { AlphaSynthAudioWorkletOutput } from '@coderline/alphatab/platform/javascript/AlphaSynthAudioWorkletOutput';
import { WebAudioHelper } from '@coderline/alphatab/platform/javascript/AlphaSynthWebAudioOutputBase';
import { BrowserUiFacade } from '@coderline/alphatab/platform/javascript/BrowserUiFacade';
import { Settings } from '@coderline/alphatab/Settings';
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalCreateWorklet = BrowserUiFacade.createAlphaSynthAudioWorklet;
afterEach(() => {
    BrowserUiFacade.createAlphaSynthAudioWorklet = originalCreateWorklet;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

function fixture() {
    const sources: {
        start: ReturnType<typeof vi.fn>;
        stop: ReturnType<typeof vi.fn>;
        disconnect: ReturnType<typeof vi.fn>;
        connect: ReturnType<typeof vi.fn>;
    }[] = [];
    const contexts = {
        state: 'running',
        sampleRate: 44100,
        destination: {},
        close: vi.fn(),
        createBuffer: vi.fn(() => ({})),
        createBufferSource: vi.fn(() => {
            let started = false;
            const source = {
                start: vi.fn(() => {
                    started = true;
                }),
                stop: vi.fn(() => {
                    if (!started) {
                        throw new DOMException('cannot call stop without calling start first.', 'InvalidStateError');
                    }
                }),
                connect: vi.fn(),
                disconnect: vi.fn()
            };
            sources.push(source);
            return source;
        })
    };
    vi.stubGlobal('navigator', { userAgent: 'test' });
    vi.stubGlobal('document', { body: { addEventListener: vi.fn(), removeEventListener: vi.fn() } });
    vi.spyOn(WebAudioHelper, 'createAudioContext').mockReturnValue(contexts as unknown as AudioContext);
    const pending: (() => void)[] = [];
    BrowserUiFacade.createAlphaSynthAudioWorklet = () => new Promise(resolve => pending.push(resolve));
    const nodes: {
        port: { postMessage: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };
        disconnect: ReturnType<typeof vi.fn>;
    }[] = [];
    vi.stubGlobal(
        'AudioWorkletNode',
        class {
            port = { addEventListener: vi.fn(), removeEventListener: vi.fn(), start: vi.fn(), postMessage: vi.fn() };
            connect = vi.fn();
            disconnect = vi.fn();
            constructor() {
                nodes.push(this);
            }
        }
    );
    const output = new AlphaSynthAudioWorkletOutput(new Settings());
    output.open(500);
    return { output, sources, contexts, pending, nodes };
}

describe('AudioWorklet playback lifetime', () => {
    it('pauses safely before initialization and ignores the late completion', async () => {
        const f = fixture();
        f.output.play();
        expect(() => f.output.pause()).not.toThrow();
        expect(f.sources[0].stop).toHaveBeenCalledOnce();
        expect(f.sources[0].disconnect).toHaveBeenCalledOnce();
        f.pending[0]();
        await Promise.resolve();
        expect(f.nodes).toHaveLength(0);
        expect(f.sources[0].connect).not.toHaveBeenCalled();
    });

    it('can destroy the output during initialization without resurrecting audio', async () => {
        const f = fixture();
        f.output.play();
        expect(() => f.output.destroy()).not.toThrow();
        expect(f.contexts.close).toHaveBeenCalledOnce();
        f.pending[0]();
        await Promise.resolve();
        expect(f.nodes).toHaveLength(0);
    });

    it.each([true, false])('isolates pause/play completions when old resolves first: %s', async oldFirst => {
        const f = fixture();
        f.output.play();
        f.output.addSamples(new Float32Array([1]));
        f.output.pause();
        f.output.play();
        f.output.resetSamples();
        f.output.addSamples(new Float32Array([2]));
        if (oldFirst) {
            f.pending[0]();
            await Promise.resolve();
            expect(f.nodes).toHaveLength(0);
        }
        f.pending[1]();
        await Promise.resolve();
        if (!oldFirst) {
            f.pending[0]();
            await Promise.resolve();
        }
        expect(f.nodes).toHaveLength(1);
        expect(f.sources[0].connect).not.toHaveBeenCalled();
        expect(f.sources[1].connect).toHaveBeenCalledWith(f.nodes[0]);
        expect(f.sources[1].start).toHaveBeenCalledOnce();
        expect(f.nodes[0].port.postMessage.mock.calls.map(call => call[0].cmd)).toEqual([
            'alphaSynth.output.resetSamples',
            'alphaSynth.output.addSamples'
        ]);
        expect(f.nodes[0].port.postMessage.mock.calls[1][0].samples).toEqual(new Float32Array([2]));
        f.output.destroy();
    });

    it('retains ordinary playback, queued samples, pause and idempotent cleanup', async () => {
        const f = fixture();
        f.output.play();
        f.output.addSamples(new Float32Array([3, 4]));
        f.pending[0]();
        await Promise.resolve();
        expect(f.sources[0].start).toHaveBeenCalledOnce();
        expect(f.nodes).toHaveLength(1);
        expect(f.nodes[0].port.postMessage).toHaveBeenCalledOnce();
        f.output.pause();
        f.output.pause();
        f.output.destroy();
        expect(f.sources[0].stop).toHaveBeenCalledOnce();
        expect(f.nodes[0].disconnect).toHaveBeenCalledOnce();
        expect(f.nodes[0].port.removeEventListener).toHaveBeenCalledOnce();
        const calls = f.nodes[0].port.postMessage.mock.calls;
        expect(calls[calls.length - 1][0]).toEqual({ cmd: 'alphaSynth.output.stop' });
    });
});
