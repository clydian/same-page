# 合并后失败定位与测试精简（#619）

用户要求查根因，不用重试变绿结案，并允许删除不合理或重复测试。
基线 `f2da2b4`。本轮不修改产品行为、等待期限、重试或 PDF 内容判定。

## 失败链条

| 运行 | 独立失败 | 连带状态 |
| --- | --- | --- |
| [main CI 40685015078](https://github.com/clydian/same-page/actions/runs/40685015078) | update-controller 的一秒空闲边界断言 | verify 随之失败，deploy 正常跳过 |
| [上一版扩展 40682043871](https://github.com/clydian/same-page/actions/runs/40682043871) | Chromium file-touch-links 的 reader-and-local-entry | report 成功写入 failure/changed=1 后执行 `test "$RESULT" = success`，再次标红 |

两次失败分属 #616 合并后的主 CI 与 #615 发布后的扩展检查。没有证据指向 #616 的线路回归。
主 CI 的浏览器、Worker、构建和 PWA 已通过；不把多个红色 job 数当作独立产品缺陷数。

## 受控定位

### 真实/虚拟时钟混用

控制器测试 beforeEach 先执行 setUpdateRoute，以真实 Date.now 记交互时间；
用例中才启用假时钟。初始化相差至少 1ms，随后推进 999ms 就可能已经满足 1000ms。
临时只将该用例假时钟起点设为 `Date.now()+10`，稳定复现同一行错误；恢复原文件后再修。
不是产品违反一秒规则，也不是线路读取恢复触发提前刷新。

整组测试现先设置固定假时钟，再初始化交互与控制器，删除分散的重复启用代码。
精确 999/1000ms 边界移到 update-safety 的聚焦测试，以两个绝对时间起点检查，保留交互后
重新计时；控制器仍验证真实交接消息、忙碌/输入/阅读/隐藏限制及手动操作。

### 文件链接测试跨越了独立 PDF 引擎初始化

CI action trace 表明：新阅读器直接 goto 后即进入五秒 canvas 等待，尚未通过文件链接
打开它；失败截图停在“正在准备阅读器”。因此该失败不能证明文件链接损坏。
证据另有两个无源位置 SecurityError，无法据此确定其具体来源，不归因给业务。
后台可见性假设本机未复现，未采用为结论。

受控探针以相同应用/真实阅读器、禁用 SW 来可控拦截引擎 chunk，暂停引擎请求：原五秒
断言稳定失败；放行后同一次打开成功画出真实非空 PDF，无刷新、重试或再次导航。
这证明该断言混入了与文件链接无关的启动耗时；不声称已从 CI 的有限证据还原引擎为何
超过五秒。临时探针已撤销，不提交注入或放宽超时。

## 删除与保留

| 删除/收敛 | 原因 | 保留的保障 |
| --- | --- | --- |
| 控制器内精确 999/1000ms 的 UI 集成用例 | 混用时钟；精确策略无需 React/Worker 模拟 | 单一时钟的 update-safety 边界测试；控制器交接集成仍在 |
| 两引擎 reader-and-local-entry 整段 | 混合跨窗口引擎启动、PDF 解码、缓存副本、返回、本机存储与链接测试 | 核心 offline-entry-smoke 的离线重开、真实非空 bitmap、编辑/联网及失权；Reader/PDF 专项测试 |
| WebKit 合成 pointer 长按场景及 helper 分支 | DOM dispatch 重复 file-open-link 组件测试，不能证明 iPhone 原生长按 | Chromium CDP 的真实触摸/滚动/多指；两引擎真实原生修饰点击与 Enter 导航 |
| WebKit 不再使用的参考附件及十份 PDF 准备 | 只为已删除的滚动/触摸路径准备数据 | Chromium 真实滚动路径继续准备；WebKit 使用原始种子乐谱 |
| 汇总记录后的 `test RESULT=success` | 已成功记录失败，却使报告步骤看似又失败 | 原 smoke/visual job 失败仍令 workflow 失败；D1 继续写真实 failure，记录错误仍失败 |

文件链接场景从两引擎各三项（共六项）收敛到 Chromium 两项、WebKit 一项（共三项），
浏览器 profile 数从六个减为三个，WebKit 额外少十一次真实 API 准备写入。
不按测试数量裁剪权限、身份隔离、草稿、离线数据或 PDF bitmap 保障。

保留 pageerror 的严格检查。测试初始化只在 HTTP(S) 文档写入引导偏好，避免对 opaque
about:blank 的测试脚本进行无意义的 localStorage 访问；没有捕获并吞掉应用错误。

## 验证

- 受控时钟偏差与引擎请求暂停分别复现，不通过 CI rerun 选取成功样本。
- 聚焦更新控制器/安全策略、PDF background、FileOpenLink 共 61 项通过。
- 精简后的真实 Chromium/WebKit 文件链接共 3 个场景通过（TAP 含父测试计 5 项）。
- 另核对 release-verification、浏览器选择及 CI 门禁原有回归；完整 main/PR 检查另行记录。

这些删除针对本次失败区域，不宣称已经完成全仓测试审计；剩余测试也不以“没有再失败”
作为永久保留理由。后续审计沿相同规则记录独立风险、最小验证层与重复覆盖。
