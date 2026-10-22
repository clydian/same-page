# 文件链接 CI：分离原生输入与跨窗口 PDF 启动

对应 [#535](https://github.com/clydian/same-page/issues/535)。固定 main 基线为 `52b2cbf7b05a9b5ef0a4e27ece0921fa027af32d`，包含 #534；本次只改测试与文档，不改产品、权限、文件或数据格式。

## 处置与边界

历史 CI 红例在真实修饰键新标签里发生：目标 URL 正确，PDF canvas 五秒内未出现；已有记录包含 React 挂载前空白、0 KB 和完整 PDF 返回后仍无 canvas，尚未证实同根。最新 main 原 `file-touch-links` 本地一次回放 Chromium/WebKit 2/2 通过，不能把它当作根因修复。

这次依据用户“允许删除没有必要的检查”的要求，收敛门禁职责：

- 删除 `visual-report/modifier-tab-readiness.test.mjs`：它用纯 HTML 连续开 60 次标签，不执行 Same Page、Worker、存储或 PDF。原生浏览器压力验证不是应用自身的发布责任；没有改为定时门禁或 skip。
- 文件链接回归从每引擎三次新标签加完整 PDF 渲染，改为一次真实修饰键激活，校验浏览器确实创建标签、链接目标正确、原页不跳转。仍使用真实 ControlOrMeta、真实 Page 事件与原五秒上限，没有伪造默认打开或 Page。
- 原生 Ctrl 标签里的 PDF 渲染不再充当触摸组件门禁。另用同一账户/context 中受控 context.newPage + goto 打开阅读器一次，保留真实 SW、Worker、存储和非空 PDF 像素校验，不在原生标签里强制导航或伪造 Page。保留正常触摸、返回、从本机存储 Enter 打开后的真实 PDF 像素验证；离线重启、编解码、权限、进度与取消由各自测试负责。
- 删除已无调用者的专属 `ctrl-target-observer.mjs`。文件链接测试改用现有 `withBrowserEvidence`：成功保持安静，失败保留去凭据的 action trace、遮盖输入的截图与页面错误位置；不在正常 CI 上传全量 DOM/源码或 CDP runtime 正文。

**独立风险与边界**：跨窗口 PDF 冷启动确有独立产品风险，不与普通打开完全等价。因此保留上述受控新页面的实际启动证明，仅移除三次原生交接与冷启动耦合的混合门禁。context.newPage 是真实浏览器新页面，但并非原生 Ctrl 标签初始化的等价替身；[加载停滞 #490](https://github.com/clydian/same-page/issues/490) 继续开放，原生路径是否同根仍未确认。没有在原生标签里再 goto/reload 掩盖首导航，也不能以绿色宣称根因修复。

## 保留的风险与验证层

| 独立风险 | 保留保障 |
| --- | --- |
| 触摸按住、移动、双指误打开或启动离线准备 | file-open-link / prepared-score-link 组件测试；真实 Chromium CDP 触摸与 WebKit 应用事件接线 |
| Ctrl/Meta 被触摸取消状态吞掉，或在原页开始准备、导航 | FileOpenLink 事件取消与路由断言；PreparedScoreLink 原页无 shell 查询/准备/导航；两引擎各一次真实新标签目标与原页断言 |
| 右键被错误取消、菜单/Escape 焦点丢失 | file-touch-links 原生输入与来源矩阵；组件事件状态测试 |
| 同一身份跨窗口、普通点按或本机 Enter 打不开实际乐谱 | file-touch-links 保留受控新页面启动及两条正常入口，使用真实 SW/Worker/存储与 PDF 像素，拒绝空白/错误填充 |
| 文件与离线副本不完整、重启后读不到 | storage-smoke、offline-entry-smoke、pdf-codecs-smoke（真实 SW/IndexedDB/decoder/Worker） |
| 进度 100% 就过早撤下 loading，销毁后接收旧结果 | reader-opening、pdf-document、reader-document-cache（受控引擎/网络边界） |

## 验证

- 原基线：`node --test --test-concurrency=1 browser-tests/file-touch-links.test.mjs`，两引擎 2/2 通过；未把这次绿色当作历史超时解释。
- 保留受控跨窗口冷启动后：相同命令两引擎 2/2 通过。file-open-link、prepared-score-link、reader-opening、pdf-document、reader-document-cache 五文件 50 项通过。
- 注入“应用取消 Ctrl/Meta 激活”用于证明保留断言不是空转：组件 2 项按预期变红；同一错误注入真实构建后，Chromium 在原五秒 Page 事件断言处按预期变红。临时改动已移除，产品源码与 main 无差异，还原构建通过。

Node 单元 290 项通过；客户端固定四 worker 全量 1168 项通过。首次本地默认全量有 4 项既有短等待超时，没有放宽超时、改变全局并发或加入重试；最终 Linux 默认命令结果在 PR 中确认。lint、typecheck 与真实构建/precache 检查通过。

未增加自动重试、全局超时、浏览器压力矩阵或替代性定时任务。最终 Linux CI、Standards/Spec review 与更完整的验证结果以 PR 记录为准；未合并、部署或作实体手机验收。
