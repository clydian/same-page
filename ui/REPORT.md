# #701 练习页重排与音高轨迹

对照提交 `ab3b4e327c2a2aef1a69a5cb613bf74bc5b4abb9`，候选提交 `deaed2b78372097808bc137e7f1c0cd267ebeeb9`。

## 界面

采用同一份合成三声部 MusicXML。覆盖 390×844 的中英文手机和 1200×1030 的中英文桌面，包含浅色和深色。`before` 和 `after` 都是真实浏览器运行结果。

- 打开题目先呈现谱面，紧接起音、示范、当前声部与设置、开始唱。390×844 的手机视口内同时看到谱与开唱按钮。两组手机的谱面上缘从 483／665 px 提到 80／79 px，谱面区域由 171 px 增至 245 px。选段使用页面标题下的一行字，说明文字留在相关状态。
- 设置采用用户主动打开的原生对话框，手机贴底。可以点击任一声部。开启持续主音或伴奏后才出现耳机提示，关闭两项后提示消失。键盘 Enter、Esc 和焦点返回均在 Chromium 验证。
- 伴奏开启后自动播放除当前演唱声部以外的所有其他声部，切换演唱声部时即时重算。在无法完整播放其他声部的片段中禁用该项并说明。单声部仍可使用持续主音。
- 演唱时保留谱面，将音高图放在其下。纵轴标音名及八度，横轴标时间，目标画成音高横条，检测到的演唱画成连续曲线。未检测到音高的间隙断开。和弦目标保留多个候选音，图上同时标出当前测到的音。

## 对照验证

浏览器复用发布、成员打开题目、试听录音、评分、回听与练习记录的本地 fixture。切换 Alto → Tenor → Alto，设置中自动排除当前声部。开启伴奏后，实际 Web Audio 调度只含 C3 持续主音和其余两声部的 8 个音。四个组合的评分结果一致，首个 C4／E4 和弦反馈 E4 偏高 35 音分，随后 D4、F4、G4 准确，得 75 分。回放混合 WAV 与原录音保持 48 kHz 和相同长度，在第一段检测到被评分选中的 E4 钢琴答案。历史仍可重开，未保存录音。`before/metrics.ndjson` 和 `after/metrics.ndjson` 记录首屏布局及音频调度。

Ella 公开演示中，谱面从准备持续到试唱和成绩阶段。App Store 上的 PitchMonitor – Vocal Visual 的麦克风和分析截图使用带八度的音名作纵轴，显示实时轨迹。合谱采用自己的主题色和排版，并保留谱面、目标音与逐音反馈之间的对应。 [Ella 官方演示](https://www.ensemble-education.com/apps/ella/top.mp4) · [PitchMonitor 截图](https://apps.apple.com/us/app/pitchmonitor-vocal-visual/id6751228637)

另在 Linux WebKit 中对四组视口验证了打开题目、谱面与开唱按钮首屏可达、设置选择与关闭。`webkit.ndjson` 记录位置。浏览器录音测试使用合成输入与本地测试云盘，仍需在 iPad Safari 和主屏幕入口实测真人录音及伴奏串音。

## 重跑

从合谱 checkout 安装依赖和 Playwright Chromium，然后运行下面的脚本。基线使用第一条命令，候选使用第二条。

```sh
SIGHT_UI_BEFORE=1 node /path/to/verify.mjs /tmp/sight-before
node /path/to/verify.mjs /tmp/sight-after
```
