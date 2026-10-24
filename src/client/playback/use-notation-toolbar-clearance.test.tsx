import { useRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { PlayerState } from '@same-page/player';
import { useNotationToolbarClearance } from './use-notation-toolbar-clearance';

afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
it('does not pull endpoint preview back to the audio cursor, then resumes clearance on cancellation',()=>{
 const frames: FrameRequestCallback[]=[];
 vi.spyOn(window,'requestAnimationFrame').mockImplementation(fn=>{frames.push(fn);return frames.length;});
 vi.spyOn(window,'cancelAnimationFrame').mockImplementation(()=>{});
 vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
 vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){
  if(this.classList.contains('practice-header'))return new DOMRect(0,0,320,80);
  if(this.classList.contains('at-cursor-bar'))return new DOMRect(0,-500,300,100);
  return new DOMRect(0,0,400,700);
 });
 let state: PlayerState={status:'ready',message:'',playing:false,parts:[],measures:[],measure:0,speed:1,notationScale:.6,focus:null,loop:null,following:true,previewing:true};
 const session={getSnapshot:()=>state,subscribe:()=>()=>{}};
 function Harness(){const ref=useRef<HTMLDivElement>(null);useNotationToolbarClearance(ref,session,true);return <><div className="practice-header" data-floating /><div ref={ref} data-testid="viewport"><div className="at-cursor-bar" /></div></>;}
 render(<Harness />);const viewport=screen.getByTestId('viewport');viewport.scrollTop=500;
 act(()=>frames.splice(0).forEach(fn=>fn(0)));expect(viewport.scrollTop).toBe(500);
 state={...state,previewing:false};fireEvent.scroll(viewport);
 act(()=>frames.splice(0).forEach(fn=>fn(0)));expect(viewport.scrollTop).toBe(0);
});
