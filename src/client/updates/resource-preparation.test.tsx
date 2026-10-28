import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it } from 'vitest';
import { ResourcePreparation } from './resource-preparation';
import { setUpdateStatus } from './update-status';

it('does not confuse adding a desktop icon or checking for updates with offline readiness',()=>{
  setUpdateStatus({phase:'current',message:'检查完成，当前版本继续运行'});
  render(<MemoryRouter><ResourcePreparation install /></MemoryRouter>);
  expect(screen.getByText(/添加桌面图标与离线资源准备分别进行/)).toBeInTheDocument();
  expect(screen.queryByText(/应用和播放器资源已准备好/)).not.toBeInTheDocument();
  act(()=>setUpdateStatus({phase:'preparing',message:'preparing',initialInstall:true}));
  expect(screen.getByRole('progressbar',{name:'离线资源准备进度'})).not.toHaveAttribute('value');
  const progress={buildId:'abc1234',sequence:1,stage:'ready' as const,totalBytes:100,preparedBytes:100,reusedBytes:0,downloadedBytes:100};
  act(()=>setUpdateStatus({phase:'preparing',message:'preparing',initialInstall:true,progress}));
  expect(screen.queryByText(/应用和播放器资源已准备好/)).not.toBeInTheDocument();
  expect(screen.getByRole('progressbar')).not.toHaveAttribute('value');
  act(()=>setUpdateStatus({phase:'current',message:'installed',initialInstall:true,progress}));
  expect(screen.getByText(/应用和播放器资源已准备好。乐谱仍需另行保存到本机/)).toBeInTheDocument();
});
