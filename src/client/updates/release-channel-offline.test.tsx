import { render, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ReleaseChannelMonitor } from './release-channel-picker';
import { useReleaseChannel } from './release-channel';
import { releaseContract } from '../../shared/release-channels';

vi.mock('../../shared/build',()=>({buildId:'b'.repeat(40)}));
afterEach(()=>vi.unstubAllGlobals());

it('restores the running beta offline without a global badge using only its permitted receipt',async()=>{
 vi.stubGlobal('__SAME_PAGE_RELEASE_CHANNELS__',true);
 const beta={channel:'beta',intent:'confirmed-beta',revision:1,target:'b'.repeat(40),backend:'a'.repeat(40),contract:releaseContract};
 const match=vi.fn(async()=>Response.json({permitted:beta}));
 vi.stubGlobal('caches',{open:async()=>({match})});
 const fetcher=vi.fn(async()=>{throw new TypeError('Offline');});vi.stubGlobal('fetch',fetcher);
 Object.defineProperty(navigator,'onLine',{configurable:true,value:false});
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_name:string,fn:()=>Promise<void>)=>fn()}});
 const view=render(<ReleaseChannelMonitor/>);
 const state=renderHook(()=>useReleaseChannel());
 await waitFor(()=>expect(state.result.current.runningChannel).toBe('beta'));
 expect(view.container).toBeEmptyDOMElement();
 await waitFor(()=>expect(fetcher).toHaveBeenCalledOnce());
 expect(match).toHaveBeenCalledOnce();
 expect(fetcher.mock.calls[0]).not.toContainEqual(expect.objectContaining({method:'POST'}));
});
