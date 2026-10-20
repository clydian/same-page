# player 0.1.19-samepage.5 / native 1.8.4-samepage.6

修复 MusicXML phrase-slur 明确 `placement=above|below` 被导入器丢失。真实 Let Tenor48→49 的原谱弧在上方，旧产品却画在下方；新原生模型保留单弧 side 并经 clone/JSON/Worker 绘制，默认自动布局与 pitch ties 不变。

- Native source：`d0fb909fd80d180761a4a7e22dccc87c735424c5`（786826e代码修复后仅增加#498边界文档），独立packager fullclone/Node24/npmci/ESM+UMD+Vite+Webpack。
- Player source：[Chorus PR20](https://github.com/clydian/chorus-score-studio/pull/20)，受审head `4d25948bb6b06e16742de0d6675f54a759b08b02`；所有22 runtimeJS与当前.4逐字节相同，仅exactpeer/版本/README变化。精确哈希见相邻manifest。
- 源码 archive 含公开上游、完整modifiedfiles、patch/tree/hash、MPL许可/通知，由现有copyhelper校验并复制到含commit/hash的公开路径；旧包和旧下载不删除。
- Native有效5红/2绿→11绿；132相关测试、全workspace typecheck/lint绿。本包真独立两tar npmci、Chorus356 tests/build/typecheck/PWA、21内置XML校验通过，原有advisory保留。
- 33冻结输入完整MIDI字段/网格/小节边界exact；Let完整v4 SHA402910a2c18da9ba4f5390fb3ce33529f2cbb1bbdc7a19c947a1a677ba2396e0的4253MIDIevents/52bounds exact。真正prepareWorker→native renderWorker的Page/Horizontal各52seek无error，100个非默认side字段保留；正式包10/7SVG全集与实际查看源码修复图逐字节相同，音符根字体36px。

范围：现有每head单outgoing短句模型。双outgoing源弧仍缺，#498独立记录且新旧均红。自定义orientation、S-shaped/Bezier与通用碰撞避让不包含。本版不是整谱高质量完成证明，未声称耳听。源音乐/字词/上下属性没有改写来求绿。
