# MusicXML 格式与浏览器播放：实施证据

核实日期：2026-09-15。核实 MusicXML 官方规范、浏览器厂商资料，以及本地 Chorus（`../music-ocr`）安装的 alphaTab 1.8.4 源码。本文是方案依据，没有进行设备性能或音乐保真度实测。

## 结论

建议首版同时接受 `.musicxml`、历史 `.xml` 和标准压缩 `.mxl`；保留上传原文件作为权威附件，播放时在浏览器做有资源上限的解包、解码和预处理。推荐用户导出 `.mxl`，但不要求用户手动转换，不为统一格式覆盖原文件。压缩是传输与存储选择，不改变播放语义；XML 解析、建模与音色加载仍然存在，不能从压缩率推导首次可播放时间。

这是产品设计建议。关键事实是：**alphaTab 1.8.4 已支持 MXL，当前限制来自 Chorus 自己的入口与 XML 预处理流程。** 不能把“不支持 MXL”解释为底层引擎缺陷。

## 格式契约

- `.mxl` 是标准 ZIP 容器，包含 `META-INF/container.xml`；入口由其 `rootfile full-path` 指定，不能任意选择 ZIP 中第一个 XML。规范使用 DEFLATE，文件名 UTF-8；MIME 为 `application/vnd.recordare.musicxml`，未压缩 XML 为 `application/vnd.recordare.musicxml+xml`。新写出的 MXL 应以未压缩、不加密的 `mimetype` 文件开头；读取时要兼容没有此文件的旧 MXL。`.musicxml` 是推荐扩展名，`.xml` 是兼容扩展名。[MusicXML container 规范](https://www.w3.org/2021/06/musicxml40/container-reference/elements/container/)
- 第一个 `rootfile` 必须指向 MusicXML；入口可以是 `score-partwise`、`score-timewise` 或 `opus`，容器也可以有其它顶层文件。[rootfile 规范](https://www.w3.org/2021/06/musicxml40/container-reference/elements/rootfile/) 产品首版建议承诺单个 `score-partwise`；当前 Chorus 音乐预处理对 timewise 的覆盖不齐全，应先明确拒绝，或在经过验证的 timewise→partwise 归一化后走同一条链。对 `opus` 明确提示当前不支持乐谱集合，不静默取错曲目。容器格式支持和音乐语义支持是两项独立契约。
- XML 不限于 UTF-8：XML 处理器的基础编码要求包含 UTF-8 与 UTF-16。建议导入至少正确处理 UTF-8、带 BOM 的 UTF-16 LE/BE，对声明与字节矛盾、其它不支持的编码给出明确错误，内部派生文本统一 UTF-8。[XML 字符编码规范](https://www.w3.org/TR/xml/#charencoding)

## 已核实的本地实现

- [alphaTab package.json](/Users/siahuat0727/Documents/music-ocr/node_modules/@coderline/alphatab/package.json:3) 安装版本是 1.8.4。
- [MusicXmlImporter](/Users/siahuat0727/Documents/music-ocr/node_modules/@coderline/alphatab/dist/alphaTab.core.mjs:22313) 尝试读取 ZIP，查 `META-INF/container.xml`，取第一个 `rootfile`，解码入口，并支持 partwise/timewise 根节点。官方当前文档也列明 MXL 与两种根结构受支持，但不能由此承诺所有 MusicXML 音乐元素和排版都完整兼容。[alphaTab MusicXML 支持表](https://www.alphatab.net/docs/formats/musicxml)
- [ZipReader](/Users/siahuat0727/Documents/music-ocr/node_modules/@coderline/alphatab/dist/alphaTab.core.mjs:16346) 遍历并解压所有条目，按条目检查 `maxDecodingBufferSize`；默认值是 128,000,000 字节（[设置](/Users/siahuat0727/Documents/music-ocr/node_modules/@coderline/alphatab/dist/alphaTab.core.mjs:28479)）。该路径未提供应用级总解压量和条目数预算，不能把默认配置直接当作上传安全策略。
- [IOHelper.toString](/Users/siahuat0727/Documents/music-ocr/node_modules/@coderline/alphatab/dist/alphaTab.core.mjs:9937) 根据 BOM 检测 UTF-16，默认 UTF-8。相比之下，[Chorus 校验](/Users/siahuat0727/Documents/music-ocr/src/player-score.ts:62) 拒绝 `.mxl` 和 PK 文件头，强制 UTF-8，根节点检查目前是正则判断。
- [Chorus 加载流程](/Users/siahuat0727/Documents/music-ocr/src/main.ts:2120) 在 `ScoreLoader.loadScoreFromBytes` 前调用 `prepareMusicXmlForAlphaTabBytes`。因此不能只删 MXL 后缀限制，把 ZIP 直接送给当前预处理；应先产生解包和解码后的 XML，再保留已有时序与力度修正。
- [Chorus 预处理](/Users/siahuat0727/Documents/music-ocr/src/musicxml-direction-timing.ts) 按 `score-partwise` 寻找乐谱；入口校验正则虽然接受 timewise，不能因此认定 timewise 获得相同时序/力度处理。alphaTab 本身的 `_parseTimewise` 确实有实现，这是库能力与产品承诺必须区分的具体实例。

## 建议执行方式

1. 服务端保留原始 bytes、原名、实际格式、字节数和内容 hash，复用附件权限。客户端校验只是 UX，不能替代服务端大小、权限和资源策略。
2. 浏览器的统一导入入口识别实际内容，校验容器并只取声明的乐谱入口，解码为文本，解析真实 XML 根节点，再进入现有音乐预处理与 alphaTab 导入。不要用后缀或正则作为最终格式验证。
3. 若复用 alphaTab 解包，必须补齐应用级资源控制；若采用 ZIP 库，选择受维护、支持限制与选择性解压的实现。不能调用其未公开的内部 ZipReader 作为长期接口。优先 Worker 中执行有界解包；XML/alphaTab 模型处理如何移出主线程需结合现有 DOM 预处理和序列化接口做验证，不能承诺“开 Worker 就全部异步”。
4. 为压缩输入、单入口解压量、总解压量、条目数、处理时间设置明确预算；拒绝加密、异常路径、重复入口、损坏容器。具体数值由真实合唱谱语料与目标 iPad 测量确定。外部 DTD/实体不得触发网络请求，外部图片/音频不在首版自动读取。
5. 原文件保持不变；预处理产生的 bytes 或模型属于可丢弃派生物。需要持久化缓存时用原文件 hash、导入器版本和预处理版本作键。首版没有必要主动把所有 XML 重写成 MXL，之后只有测得存储/流量收益值得才增加压缩派生物。

以上是工程建议，资源上限不是 MusicXML 标准要求；不应把尚未选型、实测的值写成已经验证的产品能力。

## 浏览器音频边界

- 播放必须由明确用户操作启动或恢复。Chrome 官方要求被自动播放策略挂起的 AudioContext 在用户交互后 `resume()`；WebKit 的媒体政策也要求围绕用户手势设计有声播放。界面应区分“谱面准备完成”和“音频可播放”，处理被阻止状态。[Chrome Web Audio policy](https://developer.chrome.com/blog/web-audio-autoplay)、[WebKit media policy](https://webkit.org/blog/6784/new-video-policies-for-ios/)
- iOS 后台行为有历史限制和回归；WebKit 官方缺陷记录包含页面进入后台时 AudioContext 被挂起。该记录是风险证据，不证明当前所有 iOS 版本仍有同一问题。[WebKit 237878](https://bugs.webkit.org/show_bug.cgi?id=237878)
- 因而首版应承诺前台练习播放与中断后可恢复，不提前承诺锁屏持续播放。真机验收需覆盖 Safari/PWA、锁屏、切应用、电话/音频打断和恢复；Media Session 控件本身不构成后台运行保证。关闭播放器应停止声音并释放 worker、监听和音频资源，切换文件防止迟到结果覆盖新文件。

## 验收重点

准备等价 XML/MXL、UTF-16、旧 MXL 无 mimetype、timewise、错误容器、损坏 ZIP、解压超限、opus，以及实际 MuseScore/Sibelius/Finale/Dorico 合唱导出样本。格式测试之外，还应人工听验反复、跳房子、弱起、速度变化、延音线、移调、多个 voice/staff 与声部控制。最终性能结论需要测冷缓存/热缓存、首次可听声音、主线程卡顿及关闭后内存，本文没有提供这些实测结果。
