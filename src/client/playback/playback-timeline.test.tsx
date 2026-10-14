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
