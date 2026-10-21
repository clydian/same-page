# player 0.1.19-samepage.11 / native 1.8.4-samepage.12

修复原谱校订中复现的四项问题：望春风同 part 跨谱表短句弧缺失；舟中晓望显式隐藏的连音数字与无符干音符仍被绘出（#521、#524）；Arirang 单音组震音的二分/全音符速度及延音末端错误（#522）。源谱不靠展开音符或删弧绕过问题。跨谱表端点仅在唯一且可确定时关联；复杂吉他 slide/bend 震音延音沿用旧行为。

来源 [Chorus PR26](https://github.com/clydian/chorus-score-studio/pull/26)，固定 player 源提交 `bca8a0a5a1fe022dac0d3f323ce1c29af8deebd3`。Chorus 416 项测试及 21 份谱库校验通过。native 完整源提交 `62ca99c370271b74b0454bcbf02ea0341d2cfb43`，制品 SHA-256 `dc5b422aaa491f92bcc57841d2123194332e1ffedaa695ab11b2dac5c531bc21`；完整修改源码档案 SHA-256 `5bcdc416f3987b1a9c6e19a289fa70b9d78de3c368daffb55c8feeea0ea7c633`。player SHA-256 `364ef1359ab825b87738d2ae8bf40018460ea0a3e6c8f59c6b614a446cc06510`，精确 peer `1.8.4-samepage.12`。player 除 README、版本与 peer 外的 45 个文件保持字节一致；没有修改 session、权限、schema 或用户数据。

独立空宿主正常安装两个 tarball，643 个 native 文件、47 个 player 文件与制品逐字节一致，102 份完整修改源码与 Git 一致，字体/音色 13 文件保持。native 组合 133 项测试、类型检查、构建通过；35 份冻结输入的 158073 个 MIDI 事件及边界保护通过，33 份旧 Worker JSON 的 Page/Horizontal 完整 SVG 保持。

Same Page 接入通过 14 项新包回归、269 项 Node 测试（含新增包回归）、1133 项客户端测试、构建及双浏览器真实产品练习谱入口检查。另修正三项测试前提：首页等待 memberships 结果而非请求开始；释放 reader 前等待待决请求实际创建；已确认版本的测试明确预置 library summary，避免合法冷启动先走通用 PDF 地址的竞态。没有放宽产品断言或改变产品加载策略。

正式包实际 prepare/render Workers 在 Chromium/WebKit 的 Page/Horizontal 验证：望春风 75 个定位及 16 条跨谱表弧；舟中晓望 98 个经过定位、30 个无符干字段和隐藏连音数字；Arirang 钢琴 148 次经过映射到 142 个源小节及 8 组震音 JSON。钢琴 1–138 小节起奏与源表一致，末段 292 次震音起奏经独立核对。这些不是全谱人工听审或成员端发布验收。旧公开源码 44 文件保持，新增 4 文件到 48。

仍有限制：无符干仅控制原生符干，不重新设计共享音梁；嵌套或跨小节连音、复杂多端点短句弧没有新增支持。Arirang 全组件中的第二遍限定声部与未知打击乐音色另行处理，不包含在本包验收声明中。CI、合并、生产部署与谱目发布须独立核实。
