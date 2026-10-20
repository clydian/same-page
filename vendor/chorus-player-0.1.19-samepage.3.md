# 原谱独立渐变线与文字方向（#486 / #487）

开发中的精确组合：player `0.1.19-samepage.3` / native `1.8.4-samepage.4`。
本地制品不向上游scope发布。基线为当前生产6c7bd020的player samepage.2与native samepage.3，
保留练习交互扩展和AudioWorklet初始化取消修复。

原生改动使用公开Bar.sourceWedges与Bar.sourceTexts、Worker JSON及真正原生effect bands。
独立时间声明不制造beat、不修改源notes/tempo/velocity，也不使用DOM overlay。
渐变线按源声明而非按声部重复绘制；合法重叠声明保留独立lane，并按完整跨bar链稳定分配。
文字按源每项保留上下位置和多行，常规字号/italic/bold可携带；暂不支持字体族、旋转、
文字enclosure等复杂排版时，整part保留旧文字路径。没有metadata的旧prepared数据保留legacy。

播放器从精确现行包SHA `7d51d40634864959276e8619333d7332331792cab33e63f0fa92885c4ea91e12`
应用本目录patch。用Node24运行：

```sh
node scripts/package-source-directions-player.mjs --output /new/empty/output
```

原生包仍使用scripts/package-native-alphatab.mjs从已审完整提交独立clone/build；
保留完整修改源、上游patch、MPL许可和不可覆盖的历史公开源码快照。
原生完整提交 `0bf4e52d89140dbfbcfdc2cceb0a37bc8d234214`（基线 `a67e8a34112faeaccf1fc2b019cf7b580ada73de`）。
Native tarball SHA-256: `bbf528a73e555467b9c53dcd07d8bd4a7164caf9684d339edd2b90820ee7a856`。
完整源档案 SHA-256: `62ca8557d669a78d7dc3ffa28527ff5b8a02ca0d175b4e5603bc2b31bf969dc4`。
Player tarball SHA-256: `10e25024ae05cc6198d6583902b6ad3ac6de63fc1d396669fe0fad0bb3b7b5f9`。
各制品manifest固定输入、patch、source tree及Node24工具链；旧源码快照不删除。

本地验收：原生12相关套件123测试、workspace类型检查及ESM/UMD构建；其中跨bar重叠线
先真实red后green。宿主干净npmci、类型、ESLint、41播放测试、8制品/兼容测试及build/PWA预算通过。
当前实际包两个最小red（上下wedge相同图、multiple words丢首项）在新干净安装包均green；
实际Come62bar/21SVG、望春风75bar和舟中98bar完整原生SVG生成，相关新图实际查看。
33个冻结样本的全部148095 MIDI事件、边界与音符时间网格完全保持；另Come v37的7300事件、
Sun原名Keyboard reduction样本的122事件逐字段不变。Sun既有名称识别范围和跨voice tie错误仍在，
不计作此次通过的音乐验收。没有metadata的旧prepared及无方向owned样本全部SVG字节保持。

舟中86的四条原印dim及一条钢琴文字位置修订另存独立CLI候选，不随代码PR改生产谱子。
自由段网格、框形/波浪线、源文字复杂字体族/旋转/enclosure、人工耳听和成员入口验收不在此次
显示修复的完成声明内；复杂words保守回旧路径。最终CI、部署和发布状态另核，此文件不是部署证明。
