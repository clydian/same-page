import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {PracticeSetting} from './practice-setting';
afterEach(cleanup);
it('opens feature help without toggling and closes it with Escape',async()=>{
 const change=vi.fn();render(<PracticeSetting title="首调数字" help="按当前调号标注，不改变混音。" selected={false} onChange={change} />);
 fireEvent.click(screen.getByRole('button',{name:'首调数字说明'}));
 expect(await screen.findByRole('dialog',{name:'首调数字说明'})).toHaveTextContent('按当前调号标注');expect(change).not.toHaveBeenCalled();
 fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('switch',{name:'首调数字'}));expect(change).toHaveBeenCalledWith(true);
});
