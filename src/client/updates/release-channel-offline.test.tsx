import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ReleaseChannelBadge } from './release-channel-picker';
import { releaseContract } from '../../shared/release-channels';

vi.mock('../../shared/build',()=>({buildId:'b'.repeat(40)}));
afterEach(()=>vi.unstubAllGlobals());

it('shows the running beta badge on an offline cold start using only its permitted receipt',async()=>{
 vi.stubGlobal('__SAME_PAGE_RELEASE_CHANNELS__',true);
 const beta={channel:'beta',intent:'confirmed-beta',revision:1,target:'b'.repeat(40),backend:'a'.repeat(40),contract:releaseContract};
 const match=vi.fn(async()=>Response.json({permitted:beta}));
 vi.stubGlobal('caches',{open:async()=>({match})});
 const fetcher=vi.fn(async()=>{throw new TypeError('Offline');});vi.stubGlobal('fetch',fetcher);
 Object.defineProperty(navigator,'onLine',{configurable:true,value:false});
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_name:string,fn:()=>Promise<void>)=>fn()}});
 render(<ReleaseChannelBadge/>);
 expect(await screen.findByText('测试版')).toBeVisible();
 await waitFor(()=>expect(fetcher).toHaveBeenCalledOnce());
 expect(match).toHaveBeenCalledOnce();
 expect(fetcher.mock.calls[0]).not.toContainEqual(expect.objectContaining({method:'POST'}));
});
