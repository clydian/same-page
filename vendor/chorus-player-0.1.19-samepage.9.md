# player 0.1.19-samepage.9 / native 1.8.4-samepage.10

修复 MusicXML 正确的降 B 在没有重复 accidental 时被重拼成升 A 的显示问题（#507）。Native 导入保留 integral alter -2…2 的现有 spelling mode；显式 accidental 覆盖规则、调号与小节内重复符号抑制保持。音高、时值及播放不变，不扩展微分音支持。

来源 [Chorus PR24](https://github.com/clydian/chorus-score-studio/pull/24)，head e071f82bcbf9b9b1172ac4a79c02aaf69b61c254/main398383d88bd110acce53d853df528b6ce589326b；native source65c37242b8833a66f1bc5a752e99b5550dd29061。完整65 modified source与MPL通知公开复制，SamePage既有36份公开文件逐字节保留后增4到40，不用Chorus旧目录覆盖。

独立源审查、117native相关测试、391Chorus测试、21谱目校验/build/PWA通过。正式两tar空宿主安装，player47/native642文件逐字节核对；player全部dist与前版相同。38冻结输入187290 MIDI事件全部字段/顺序/网格/边界精确保护（包含Piano hook）。实际Chromium/WebKit×Page/Horizontal prepare/render Worker共8case，owned源降号glyph与Arirang17全部seek/bounds通过，截图实际检查。

该包不修#508小节内/末谱号或#510跨谱表八度线；不代表全谱源验收、耳听或成员产品验证。部署及成员回读分别记录。
