# player 0.1.19-samepage.7 / native 1.8.4-samepage.8

修复 #501：合法 `font-family="serif"` 导致整个声部的 source words 退回旧路径，同刻的 `SOLO or Div.` 与 `gently` 只剩后一条。现在六个 CSS generic 字族及其有序列表保留在 typed metadata、prepared structuredClone、原生 SourceText 与 Worker JSON 中，分别绘制两条文字。省略字族保持旧默认，字号/粗斜体/音乐锚点不变。

命名字体、引号字族、rotation、enclosure 和其它不支持内容仍采用保守整声部回退；本次没有扩大任意 CSS 或自定义字体支持，未改源 XML 以迎合显示。既有 #498 单符头多 outgoing slur 限制独立保留。

来源为 [Chorus PR22](https://github.com/clydian/chorus-score-studio/pull/22)，head `47be1df4b8f1789450f3170e8047c6715e7592c2`、squash main `903f400608723ce04629abd07dd903249e8301f7`。Native source `bdd07a6b2a0e17f99dcd44697867f605549f900a`，完整 modified source、可重放 patch、MPL 与通知随包并公开复制。精确制品 SHA 见同名 manifest；原有28份公开源码/许可证文件保持。

源验证包括 native typecheck/full build、35 SourceText/Wedge tests，Chorus383tests/21谱校验/full build，正式两 tar 独立安装后的实际 Sun65 Chromium/WebKit prepare/render Worker 两词 serif 显示。旧 native.7 与新 native 的省略字族三组 Page/Horizontal SVG 共六例逐字节相同，含字号/粗斜体覆盖；36冻结谱全部 MIDI 字段、小节边界和声部网格精确不变。宿主新增 installed-package 与真实 built Worker/UI 两词回归。

以上不等于人工耳听、生产成员访问或所有乐谱源内容认证。未改变用户数据、API、缓存协议或谱目发布状态。
