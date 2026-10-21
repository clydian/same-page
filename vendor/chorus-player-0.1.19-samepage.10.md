# player 0.1.19-samepage.10 / native 1.8.4-samepage.11

处理实际校谱发现的六项问题：按音乐时点保留小节内/末的谱号与调号（#508/#513），八度线只作用于指定谱表（#510），波音保留 source whole/half/unison（#512），和弦主音跳音缩短未连音成员且显式延音链优先（#516），支持范围内的双音组震音交替播放、共用原生符干几何并绘制连接音梁（#515）。仅调式变化、升降号相同的调号保留调性上下文而不重复绘制。原谱保持不变，没有展开震音音符去掩盖播放器问题。

来源 [Chorus PR25](https://github.com/clydian/chorus-score-studio/pull/25)，reviewed head `01b15d39907c4735e11e6db7678db8686dc1222b`，已合并 main `500b10d49d054e36d7e52cd9b3e38ba00f3bf396`；native source `4c0a1229d84919a006dc5839a77883fad44244dd`。native 643 个制品文件、90 份完整修改源码、player 47 个文件均独立核对；player JS 与前版逐字节相同，版本/peer 和 README 改变。字体及音色 13 文件保持。历史公开源码档案保留，新增源码、manifest 与 MPL 通知；没有 schema、云端权限或本机数据迁移。

独立空目录正常 peer 安装两个 tarball，11 项实际 engine/Piano hook/Worker JSON/原生 SVG 检查通过。旧包 10 项失败、1 项显式延音控制通过，新包全部通过。Chorus 全部 402 项测试、21 份谱库校验及 build/PWA 通过；既有 advisory 保留。源码阶段 35 份冻结输入保护及 33 份旧 Worker JSON 的两种布局保护，与最终安装制品的实际浏览器结果分开记录。

支持范围有限：不包含跨谱表/跨小节震音、相反显式符干、全音符浮动震音、复杂弯音/滑音/延音交互，或仅由显式 beams 描述的零笔画震音。小节内拍号/移调和非传统调号也不在本版范围。没有把源码测试、包验证或局部数值检查当成整谱校订、真人听审、部署成功或成员验收。

Same Page 本地接入另通过 lint/typecheck、250 项 Node、1128 项客户端测试、完整构建及 5 项实际双浏览器 built-host 检查（准备 Worker 协议、练习谱/PDF 切换和公开源码）。宿主原有 40 份公开源码文件逐字节保留，新增 4 份到 44。CI、部署和生产成员回读仍独立验证。
