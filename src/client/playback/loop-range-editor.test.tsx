import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { PlayerSession, PlayerState } from '@same-page/player';
import { LoopRangeEditor } from './loop-range-editor';

afterEach(cleanup);
function setup() {
  const state: PlayerState = { status:'ready', message:'', playing:false, parts:[], measures:Array.from({length:8},(_,index)=>({index,label:`第 ${index + 1} 小节`,startTick:index*100,endTick:(index+1)*100})),measure:2,speed:1,notationScale:.6,focus:null,loop:{start:2,end:4} };
  const session: PlayerSession = { playPause:vi.fn(),pause:vi.fn(),seek:vi.fn(),seekAt:vi.fn(),previewMeasure:vi.fn(),speed:vi.fn(),mix:vi.fn(),notationScale:vi.fn(),solfege:vi.fn(),focus:vi.fn(),focusOther:vi.fn(),follow:vi.fn(),suspendFollow:vi.fn(),loop:vi.fn(),getSnapshot:()=>state,subscribe:()=>()=>{},dispose:vi.fn() };
  const fading=vi.fn();
  const result=render(<LoopRangeEditor session={session} state={state} ready onPreview={vi.fn()} onPreviewingChange={fading} />);
  return {...result,session,fading};
}
it('keeps the applied range visible and previews a draft outside it before applying',()=>{
 const {session,fading}=setup();
 expect(screen.getByRole('status')).toHaveTextContent('第 3 小节 至 第 5 小节');
 fireEvent.click(screen.getByRole('button',{name:'调整范围'}));
 const end=screen.getByRole('slider',{name:/循环终点/});
 expect(end).toHaveAttribute('aria-valuetext','第 5 小节');
 fireEvent.pointerDown(end);expect(fading).toHaveBeenLastCalledWith(true);
 fireEvent.change(end,{target:{value:'7'}});
 expect(session.previewMeasure).toHaveBeenLastCalledWith(7);expect(session.loop).not.toHaveBeenCalled();
 expect(end).toHaveAttribute('aria-valuetext','第 8 小节');
 fireEvent.pointerUp(end);expect(fading).toHaveBeenLastCalledWith(false);
 fireEvent.click(screen.getByRole('button',{name:'应用范围'}));expect(session.loop).toHaveBeenCalledExactlyOnceWith(2,7);
});
it('pointer cancellation and unmount cancel preview without changing the applied loop',()=>{
 const {session,fading,unmount}=setup();
 fireEvent.click(screen.getByRole('button',{name:'调整范围'}));
 fireEvent.pointerDown(screen.getByRole('slider',{name:/循环起点/}));
 fireEvent.pointerCancel(screen.getByRole('slider',{name:/循环起点/}));
 expect(session.previewMeasure).toHaveBeenLastCalledWith(null);expect(fading).toHaveBeenLastCalledWith(false);expect(session.loop).not.toHaveBeenCalled();
 expect(screen.queryByRole('slider')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'调整范围'}));unmount();expect(session.previewMeasure).toHaveBeenLastCalledWith(null);
});
it('Escape discards keyboard edits and window blur releases the preview',()=>{
 const {session}=setup();
 fireEvent.click(screen.getByRole('button',{name:'调整范围'}));
 fireEvent.keyDown(screen.getByRole('slider',{name:/循环起点/}),{key:'Escape'});
 expect(screen.queryByRole('slider')).not.toBeInTheDocument();expect(session.loop).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'调整范围'}));fireEvent.blur(window);expect(session.previewMeasure).toHaveBeenLastCalledWith(null);
});
