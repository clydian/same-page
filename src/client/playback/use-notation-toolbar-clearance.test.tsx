import { useRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useNotationToolbarClearance } from './use-notation-toolbar-clearance';

afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
it('publishes stable viewport clearance without scrolling or following cursor mutations',async()=>{
 const frames: FrameRequestCallback[]=[];
 vi.spyOn(window,'requestAnimationFrame').mockImplementation(fn=>{frames.push(fn);return frames.length;});
 vi.spyOn(window,'cancelAnimationFrame').mockImplementation(()=>{});
 let resized=()=>{};
 vi.stubGlobal('ResizeObserver',class{constructor(fn:()=>void){resized=fn;}observe(){}disconnect(){}});
 let height=80;
 vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){
  if(this.classList.contains('practice-header'))return new DOMRect(0,0,320,height);
  return new DOMRect(0,0,400,700);
 });
 const session={getSnapshot:vi.fn(),subscribe:vi.fn(()=>()=>{})};
 function Harness(){const ref=useRef<HTMLDivElement>(null);useNotationToolbarClearance(ref,session,true);return <><div className="practice-header" data-floating/><div ref={ref} data-testid="viewport"><div className="at-cursor-bar" /></div></>;}
 render(<Harness />);const viewport=screen.getByTestId('viewport'),changed=vi.fn();viewport.addEventListener('samepage:notation-clearance',changed);viewport.scrollTop=500;
 act(()=>frames.splice(0).forEach(fn=>fn(0)));
 expect(viewport.style.scrollPaddingTop).toBe('92px');expect(viewport.scrollTop).toBe(500);expect(changed).toHaveBeenCalledTimes(1);
 await act(async()=>{viewport.querySelector<HTMLElement>('.at-cursor-bar')!.style.left='380px';});fireEvent.scroll(viewport);
 act(()=>frames.splice(0).forEach(fn=>fn(0)));
 expect(viewport.style.scrollPaddingTop).toBe('92px');expect(changed).toHaveBeenCalledTimes(1);
 height=100;act(()=>{resized();frames.splice(0).forEach(fn=>fn(0));});
 expect(viewport.style.scrollPaddingTop).toBe('112px');expect(viewport.scrollTop).toBe(500);expect(changed).toHaveBeenCalledTimes(2);
});
