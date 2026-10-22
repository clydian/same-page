import { readReleaseReceipt, writeReleaseReceipt } from "../../shared/release-receipt";
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ReleaseChannelPicker } from './release-channel-picker';
import { releaseContract, type ReleaseTarget } from '../../shared/release-channels';
import { UpdateDetails } from '../components/reload-prompt';
import { setUpdateStatus } from './update-status';
vi.mock('../../shared/build',async importOriginal=>({...await importOriginal<typeof import('../../shared/build')>(),buildId:'a'.repeat(40),buildVersion:'v26.10.22.1600'}));
afterEach(()=>{vi.unstubAllGlobals();localStorage.clear();});
it('persists explicit intent, confirms Cookie readback and prepares an update without reloading',async()=>{
  vi.stubGlobal('__SAME_PAGE_RELEASE_CHANNELS__',true);
  const target: ReleaseTarget={channel:'stable',intent:'default',revision:1,target:'a'.repeat(40),backend:'b'.repeat(40),contract:releaseContract};
  const records=new Map();vi.stubGlobal('caches',{open:async()=>({match:async (k: string)=>records.get(k)?.clone(),put:async(k: string,r: Response)=>records.set(k,r.clone())})});
  await writeReleaseReceipt(location.origin,{permitted:{...target}});
  const post=vi.fn();const check=vi.fn();window.addEventListener('same-page-check-update',check);
  vi.stubGlobal('fetch',vi.fn(async(_url,options)=>{
    if(options?.method==='POST'){post(JSON.parse(options.body));Object.assign(target,JSON.parse(options.body),{target:'c'.repeat(40)});return new Response(null,{status:204})}
    return Response.json(target);
  }));
  Object.defineProperty(navigator,'onLine',{configurable:true,value:true});
  Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_name:string,fn:()=>Promise<void>)=>fn()}});
  setUpdateStatus({phase:'current',message:'检查完成，当前版本继续运行'});
  render(<UpdateDetails/>);
  const beta=await screen.findByRole('button',{name:/测试版.*提前体验/});
  await waitFor(()=>expect(beta).toBeEnabled());
  expect(screen.getByRole('heading',{name:'应用版本'})).toBeVisible();
  await act(async()=>fireEvent.click(beta));
  await waitFor(()=>expect(post).toHaveBeenCalledWith(expect.objectContaining({channel:'beta'})));
  expect((await readReleaseReceipt(location.origin)).confirmed?.channel).toBe('beta');expect(check).toHaveBeenCalled();
  expect(beta).toHaveAttribute('aria-pressed','true');
  expect(screen.getByRole('status')).toHaveTextContent('当前仍运行稳定版');
  act(()=>setUpdateStatus({phase:'ready',message:'更新已准备好'}));
  expect(screen.getByRole('heading',{name:'等待切换到测试版'})).toBeVisible();
  expect(screen.getByRole('button',{name:'切换到测试版'})).toBeEnabled();
  for (const phase of ['preparing','applying'] as const) {
    act(()=>setUpdateStatus({phase,message:'版本交接中'}));
    expect(beta).toBeDisabled();
  }
  act(()=>setUpdateStatus({phase:'current',message:'检查完成'}));
  expect(beta).toBeEnabled();
  window.removeEventListener('same-page-check-update',check);
});

it('does not query channel authority before the controlled bridge is enabled',()=>{
  vi.stubGlobal('__SAME_PAGE_RELEASE_CHANNELS__',false);
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  render(<ReleaseChannelPicker/>);
  expect(screen.queryByRole('group',{name:'更新通道'})).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

it('keeps channel controls and a retry visible when channel information is unavailable',async()=>{
  vi.stubGlobal('__SAME_PAGE_RELEASE_CHANNELS__',true);
  vi.stubGlobal('fetch',vi.fn(async()=>{throw new TypeError('Network failed');}));
  const records=new Map();vi.stubGlobal('caches',{open:async()=>({match:async(k:string)=>records.get(k)?.clone(),put:async(k:string,r:Response)=>records.set(k,r.clone())})});
  render(<ReleaseChannelPicker/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('版本信息暂不可用');
  expect(screen.getByRole('group',{name:'更新通道'})).toBeVisible();
  expect(screen.getByRole('button',{name:'重试版本信息'})).toBeEnabled();
});

it('keeps normal update wording when a newer build belongs to the running channel', async () => {
  vi.stubGlobal('__SAME_PAGE_RELEASE_CHANNELS__', true);
  const current: ReleaseTarget = { channel: 'stable', intent: 'default', revision: 1, target: 'a'.repeat(40), backend: 'b'.repeat(40), contract: releaseContract };
  const records = new Map();
  vi.stubGlobal('caches', { open: async () => ({ match: async (key: string) => records.get(key)?.clone(), put: async (key: string, response: Response) => records.set(key, response.clone()) }) });
  await writeReleaseReceipt(location.origin, { permitted: current });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...current, target: 'c'.repeat(40), revision: 2 })));
  setUpdateStatus({ phase: 'ready', message: '更新已准备好' });
  render(<UpdateDetails />);
  await waitFor(() => expect(screen.getByRole('button', { name: /稳定版.*日常推荐/ })).toHaveAttribute('aria-pressed', 'true'));
  expect(screen.getByRole('heading', { name: '新版本已准备好' })).toBeVisible();
  expect(screen.getByRole('button', { name: '重新加载并更新' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: '切换到稳定版' })).toBeNull();
  act(() => setUpdateStatus({ phase: 'current', message: '检查完成，当前版本继续运行' }));
  expect(screen.getByRole('status')).not.toHaveTextContent('选择已保存');
});
