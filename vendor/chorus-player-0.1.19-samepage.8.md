# player 0.1.19-samepage.8 / native 1.8.4-samepage.9

原谱 direction bracket 的有限同谱表 solid/wavy 显示经过公开 Bar.sourceBrackets、Worker JSON 和原生 layout/glyph 保留。该显示子集不加入音符、颤音、反复或时序解释；未知属性/样式整 span 拒绝，未实现颜色、箭头、虚线、continue 和跨谱表外大框。

来源为 [Chorus PR23](https://github.com/clydian/chorus-score-studio/pull/23)，head `aebb9bf48e7507c54114ff393fed8b45ee997275`、squash main `af15eee67cde5fd86ffc5d1efbe2a127fb18b972`，两者 source tree 完全相同。Native source `a7f67663591fc6cea104b44e1f331d27143089da`，完整 63 个 modified source、patch、MPL 与通知随包并公开复制。旧32份SamePage源码/许可证文件原位保留，不用Chorus的旧28文件目录覆盖。

正式两个tar在独立宿主实际安装，player47/native642文件逐字节校验；player全部44个dist文件与前版字节相同，native audio/MIDI/synth源码不变。35冻结输入158073MIDI事件全部字段、顺序、网格和边界精确保护；33省略bracket控件在双布局的完整SVG和几何相同。Chromium/WebKit实际prepare/renderWorker在Page/Horizontal通过owned和完整舟中98slot，逐个seek/边界、5声部与11图形segment验证，85–86截图实际检查。SamePage还加入installed JSON/MIDI/无图形控件及builtWorker/UI回归。

舟中22“此处有坑”框注含义、85无符干音群时值、86跨谱表外大框和自由演奏解释仍未认证。实验v47源XML未发布。本次不是全谱源内容、人工耳听或生产成员验收；不改用户数据、API、缓存协议或发布指针。
