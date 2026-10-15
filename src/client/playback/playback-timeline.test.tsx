import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PlaybackTimeline } from './playback-timeline';
afterEach(cleanup);
it('previews pointer scrubbing and seeks once on release',()=>{
 const seek=vi.fn();render(<PlaybackTimeline timeline={{value:0,max:10,disabled:false,label:String,seek}} />);
 const input=screen.getByRole('slider');fireEvent.pointerDown(input);fireEvent.change(input,{target:{value:'4'}});expect(seek).not.toHaveBeenCalled();fireEvent.pointerUp(input);expect(seek).toHaveBeenCalledExactlyOnceWith(4);
});
it('assistive changes without pointer or keyboard events seek immediately',()=>{
 const seek=vi.fn();render(<PlaybackTimeline timeline={{value:0,max:10,disabled:false,label:String,seek}} />);
 fireEvent.change(screen.getByRole('slider'),{target:{value:'3'}});expect(seek).toHaveBeenCalledExactlyOnceWith(3);
});
it('shows the target label during scrubbing and cancels without seeking',()=>{
 const seek=vi.fn();render(<PlaybackTimeline timeline={{value:0,max:10,disabled:false,label:value=>`第 ${value+1} 小节`,seek}} />);
 const input=screen.getByRole('slider');fireEvent.pointerDown(input);fireEvent.change(input,{target:{value:'8'}});
 expect(screen.getByRole('status')).toHaveTextContent('第 9 小节');expect(input).toHaveAttribute('aria-valuetext','第 9 小节');
 fireEvent.pointerCancel(window);fireEvent.pointerUp(window);
 expect(seek).not.toHaveBeenCalled();expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
it('commits a release outside the slider only once and uses the latest seek',()=>{
 const first=vi.fn(),second=vi.fn();const props={value:0,max:10,disabled:false,label:String,seek:first};
 const {rerender}=render(<PlaybackTimeline timeline={props} />);const input=screen.getByRole('slider');
 fireEvent.pointerDown(input);fireEvent.change(input,{target:{value:'7'}});
 rerender(<PlaybackTimeline timeline={{...props,seek:second}} />);fireEvent.pointerUp(window);fireEvent.blur(input);
 expect(first).not.toHaveBeenCalled();expect(second).toHaveBeenCalledExactlyOnceWith(7);
});
it('previews keyboard movement and Escape restores the playing position',()=>{
 const seek=vi.fn();render(<PlaybackTimeline timeline={{value:2,max:10,disabled:false,label:String,seek}} />);const input=screen.getByRole('slider');
 fireEvent.keyDown(input,{key:'ArrowRight'});fireEvent.change(input,{target:{value:'3'}});expect(seek).not.toHaveBeenCalled();
 fireEvent.keyUp(input,{key:'ArrowRight'});expect(seek).toHaveBeenCalledExactlyOnceWith(3);
 seek.mockClear();fireEvent.keyDown(input,{key:'ArrowRight'});fireEvent.change(input,{target:{value:'4'}});fireEvent.keyDown(input,{key:'Escape'});fireEvent.keyUp(input,{key:'ArrowRight'});
 expect(seek).not.toHaveBeenCalled();expect(input).toHaveValue('2');
});
