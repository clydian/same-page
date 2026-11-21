import json,subprocess
from pathlib import Path
root=Path('/workspace/same-page/artifacts/verification/follow-explore');out=Path('/tmp/system-follow-transition-evidence/review');out.mkdir(exist_ok=True)
def clip(name,label,width,height,startOffset,duration):
 selected=root.parent/'follow-explore-baseline' if name.endswith('-instant') else root;d=json.load(open(selected/f'{name}.json'));target=out/f'{name}.mp4';vf=f"crop={width}:{height}:0:0,pad={width}:{height+32}:0:32:black,drawtext=text='{label}':x=12:y=8:fontcolor=white:fontsize=18"
 subprocess.run(['ffmpeg','-v','error','-y','-ss',str(d['clipStart']+startOffset if '-1.5-' in name else d['clipStart']+(next(x['time'] for x in d['frames'] if x['measure']==d['targetIndex'])-d['frames'][0]['time'])/1000-1.8),'-i',str(selected/'all.webm'),'-t',str(duration),'-vf',vf,'-an','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',str(target)],check=True)
 return target
for width,height in [(390,640),(768,900)]:
 for speed in [1,1.5]:
  offset=1.2 if speed==1 else -.15;duration=5.2 if speed==1 else 5
  files=[]
  for mode in ['instant','boundary','pre']:
   name=f'{width}-{speed}-{mode}';files.append(clip(name,f'{"baseline 684" if mode=="instant" else mode} / 72 BPM / {speed}x',width,height,offset,duration))
  pairs=[(0,1,'instant-boundary'),(1,2,'boundary-pre')]
  for a,b,label in pairs:
   subprocess.run(['ffmpeg','-v','error','-y','-i',str(files[a]),'-i',str(files[b]),'-filter_complex','[0:v][1:v]hstack=inputs=2[v]','-map','[v]','-an','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',str(out/f'{width}-{speed}-{label}.mp4')],check=True)
