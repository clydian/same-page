import { readReleaseReceipt } from "../../shared/release-receipt";
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ReleaseChannelPicker } from './release-channel-picker';
import { releaseContract } from '../../shared/release-channels';
afterEach(()=>{vi.unstubAllGlobals();localStorage.clear();});
it('persists explicit intent, confirms Cookie readback and prepares an update without reloading',async()=>{
  vi.stubGlobal('__SAME_PAGE_RELEASE_CHANNELS__',true);
  const target={channel:'stable',intent:'default',revision:1,target:'a'.repeat(40),backend:'b'.repeat(40),contract:releaseContract};
  const records=new Map();vi.stubGlobal('caches',{open:async()=>({match:async (k: string)=>records.get(k)?.clone(),put:async(k: string,r: Response)=>records.set(k,r.clone())})});
  const post=vi.fn();const check=vi.fn();window.addEventListener('same-page-check-update',check);
  vi.stubGlobal('fetch',vi.fn(async(_url,options)=>{
    if(options?.method==='POST'){post(JSON.parse(options.body));Object.assign(target,JSON.parse(options.body),{target:'c'.repeat(40)});return new Response(null,{status:204})}
    return Response.json(target);
  }));
  Object.defineProperty(navigator,'onLine',{configurable:true,value:true});
  Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_name:string,fn:()=>Promise<void>)=>fn()}});
  render(<ReleaseChannelPicker/>);await screen.findByRole('combobox',{name:'发布通道'});
  await act(async()=>fireEvent.change(screen.getByRole('combobox'),{target:{value:'beta'}}));
  await waitFor(()=>expect(post).toHaveBeenCalledWith(expect.objectContaining({channel:'beta'})));
  expect((await readReleaseReceipt(location.origin)).confirmed?.channel).toBe('beta');expect(check).toHaveBeenCalled();
  expect(screen.getByRole('combobox')).toHaveValue('beta');window.removeEventListener('same-page-check-update',check);
});

it('does not query channel authority before the controlled bridge is enabled',()=>{
  vi.stubGlobal('__SAME_PAGE_RELEASE_CHANNELS__',false);
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  render(<ReleaseChannelPicker/>);
  expect(screen.queryByRole('combobox',{name:'发布通道'})).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
