# 独立音高图显示实际八度

使用两小节合成 MusicXML 及 48 kHz 音频，Chromium 走实际 AudioWorklet 和 Pitchy。Alto 依次唱 E3、D4、F5、G4。手机中文浅色、桌面英文深色均验证演唱和复盘。

- 修复前的 `3da052c09336550adf0860da09cf6f3e036ecec3` 会把 E3 画在 E4 的高度、把 F5 画在 F4 的高度。现场图例虽显示 F5，曲线仍落在 F4。
- 修复后的 `6da366507d089fc3ad729f6f0f6a60b5ce8c6c14` 把 E3 画在原谱 E4 下方，把 F5 画在原谱 F4 上方。同八度的 D4 和 G4 仍贴着对应轨迹。
- 本组输入两次都是 100 分。修复后，轨迹在五线谱上仍贴着实际符头。
- 此轮未用真人麦克风或 iPad 验证。

`verify.mjs` 在产品工作区运行。设 `SIGHT_QA_URL` 为待测静态构建，`SIGHT_QA_BUILD` 为完整产品提交。设 `SIGHT_QA_THEME=dark` 可复查英文桌面深色。
