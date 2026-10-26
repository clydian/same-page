import { useSyncExternalStore } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { PlayerSession, PlayerState } from '@same-page/player';
import { LoopRangeEditor } from './loop-range-editor';

afterEach(cleanup);
function setup(initialLoop: PlayerState['loop'] = {start:2,end:4}) {
 let state: PlayerState = {status:'ready',message:'',playing:false,parts:[],measures:Array.from({length:8},(_,index)=>({index,label:`第 ${index+1} 小节`,startTick:index*100,endTick:(index+1)*100})),measure:2,speed:1,notationScale:.6,focus:null,loop:initialLoop};
 const listeners=new Set<()=>void>();
 const session: PlayerSession = {rhythm:vi.fn(),playPause:vi.fn(),pause:vi.fn(),seek:vi.fn(),seekAt:vi.fn(),previewMeasure:vi.fn(),speed:vi.fn(),mix:vi.fn(),notationScale:vi.fn(),solfege:vi.fn(),focus:vi.fn(),focusOther:vi.fn(),follow:vi.fn(),suspendFollow:vi.fn(),loop:vi.fn((start,end)=>{state={...state,loop:start===null?null:{start,end:end!}};listeners.forEach(listener=>listener());}),getSnapshot:()=>state,subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},dispose:vi.fn()};
 const fading=vi.fn(); let rememberedRange: number[] | null = null;
 const remember=(range:number[])=>{rememberedRange=range;};
 function Harness(){const snapshot=useSyncExternalStore(session.subscribe,session.getSnapshot);return <LoopRangeEditor rememberedRange={rememberedRange} onRememberRange={remember} session={session} state={snapshot} ready onPreview={vi.fn()} onPreviewingChange={fading} />;}
 const result=render(<Harness />);return {...result,session,fading,Harness};
}
it('enables a default range immediately and uses only the switch to stop it',()=>{
 const {session}=setup(null);fireEvent.click(screen.getByRole('switch',{name:'片段循环'}));
 expect(session.loop).toHaveBeenLastCalledWith(0,7);expect(screen.getByRole('switch')).toBeChecked();
 expect(screen.queryByRole('button',{name:/应用范围|取消调整|调整范围/})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('switch'));expect(session.loop).toHaveBeenLastCalledWith(null);expect(screen.queryByRole('slider')).not.toBeInTheDocument();
});
it('previews a drag and commits on release without an extra action',()=>{
 const {session,fading}=setup();const end=screen.getByRole('slider',{name:/循环终点/});
 fireEvent.pointerDown(end);expect(fading).toHaveBeenLastCalledWith(true);
 fireEvent.change(end,{target:{value:'7'}});expect(session.previewMeasure).toHaveBeenLastCalledWith(7,{start:2,end:7});expect(session.loop).not.toHaveBeenCalled();
 fireEvent.pointerUp(end);expect(session.loop).toHaveBeenCalledExactlyOnceWith(2,7);expect(fading).toHaveBeenLastCalledWith(false);
 expect(screen.getByRole('status')).toHaveTextContent('第 3 小节 至 第 8 小节');
});
it('pointer cancellation, Escape and blur discard only the unfinished drag',()=>{
 const {session}=setup();const end=screen.getByRole('slider',{name:/循环终点/});
 for(const stop of [()=>fireEvent.pointerCancel(end),()=>fireEvent.keyDown(end,{key:'Escape'}),()=>fireEvent.blur(window)]){
  fireEvent.change(end,{target:{value:'7'}});stop();expect(session.loop).not.toHaveBeenCalled();expect(session.previewMeasure).toHaveBeenLastCalledWith(null);expect(end).toHaveValue('4');expect(screen.getByRole('switch')).toBeChecked();
 }
});
it('applies fine adjustments immediately and prevents crossed endpoints',()=>{
 const {session}=setup();fireEvent.click(screen.getByRole('button',{name:'终点 B'}));
 fireEvent.click(screen.getByRole('button',{name:'循环终点前一小节'}));expect(session.loop).toHaveBeenLastCalledWith(2,3);
 fireEvent.click(screen.getByRole('button',{name:'循环终点前一小节'}));expect(session.loop).toHaveBeenLastCalledWith(2,2);expect(screen.getByRole('button',{name:'循环终点前一小节'})).toBeDisabled();
});
it('retains the last range across panel remounts and releases previews on unmount',()=>{
 const {session,unmount,Harness}=setup();fireEvent.click(screen.getByRole('switch'));unmount();expect(session.previewMeasure).toHaveBeenLastCalledWith(null);
 render(<Harness />);fireEvent.click(screen.getByRole('switch'));expect(session.loop).toHaveBeenLastCalledWith(2,4);expect(screen.getByRole('slider',{name:/循环终点/})).toHaveValue('4');
});

it('previews the pressed endpoint and clears keyboard fading even at a boundary',()=>{
 const {session,fading}=setup();const end=screen.getByRole('slider',{name:/循环终点/});
 fireEvent.pointerDown(end);expect(session.previewMeasure).toHaveBeenLastCalledWith(4,{start:2,end:4});fireEvent.pointerUp(end);
 fireEvent.keyDown(end,{key:'End'});
 fireEvent.keyUp(end,{key:'End'});expect(fading).toHaveBeenLastCalledWith(false);
});
