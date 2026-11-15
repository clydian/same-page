# 练习控制收展与音频简化证据

本次修改把 XML 的上下工具和对照字号统一到现有底部收展入口，收起后顶部仅留结束；音频移除总音量及没有内容可调的设置入口。结束按钮固定在右上安全区，上下浮动工具使用相同圆角、表面与边框语言。

代价是上下控制不再独立收展；用户仍可在收起时播放/暂停、打开 XML 练习设置，且可由底部唯一收展按钮恢复视图、字号、速度、进度与全屏/专注退出。没有增加计时或谱面点击自动隐藏。

## 截图条件

修改前为 `a7d7a7a` main 的干净生产构建，修改后为基于相同 main、带本 PR 运行时代码的本地生产构建。图片均由实际运行界面原样截取，没有拼接或修改像素。视口：竖屏 390×844、横屏 844×390 CSS px；无头 Chromium、触控条件、中文 locale。合成 PDF / 四声部 MusicXML 与仓库 `practice-tone.mp3`，截图接口采用隔离的本地 mock；没有访问用户谱面或生产云盘。

这些是浏览器模拟，不是手机真机、系统状态栏、真实刘海或已安装 PWA 截图。安全区测试另使用 CSS / CDP 注入；不把模拟器通过当作 iOS/Android 验收。

## 前后对比

相同尺寸、相同操作状态。MP3 设置对比的“后”明确展示已移除入口的看谱界面，不伪造一个不存在的面板。

| 场景 | 修改前 | 修改后 |
| --- | --- | --- |
| XML：竖屏收起 | ![前：仅底栏收起，顶部常显](before-xml-collapsed-portrait.png) | ![后：顶部只留结束，底部可恢复全部控制](after-xml-collapsed-portrait.png) |
| 对照：横屏收起 | ![前：顶部与 XML 字号仍显示](before-xml-compare-landscape.png) | ![后：顶部与对照字号一并收起](after-xml-compare-landscape.png) |
| MP3：看谱设置 | ![前：总音量与说明面板](before-mp3-settings-portrait.png) | ![后：移除总音量及空设置入口](after-mp3-settings-portrait.png) |
| MP3：横屏收起 | ![前：文件名、全屏与空设置入口仍常显](before-mp3-collapsed-landscape.png) | ![后：保留播放、展开与结束](after-mp3-collapsed-landscape.png) |

## 验证与审查

- `npm run lint`、`npm run typecheck`、`SAME_PAGE_RELEASE_CHANNELS=1 npm run build` 通过；`npm run test:ci` 的 31 项通过。
- 完整客户端：167 个测试文件、1450 项通过。focus/clearance 的 8 项 hook 测试通过。
- 复用并更新 `visual-report/practice-focus.test.mjs`，覆盖横竖屏初始状态、旋转保留、320px、模拟安全区、上下统一恢复、对照字号隐藏、键盘 Enter/Space 与焦点、全屏/专注回退、MP3 连续播放与结束释放；没有为每种组合新增一套重复测试。
- 真实本地 Worker/D1/R2 的 `practice-reader-layout`、`practice-panel-safe-area`、`practice-unified-controls`、`practice-compare` 通过。另补验 `musicxml-startup / hidden-notation` 和 `preview-notes-smoke / signed-in-musicxml`，保持准备中切视图、编辑后进入练习及体验笔记隔离路径。
- 自审和独立只读 review 完成。修正了两个横屏调用测试需要先展开的问题、对照几何测试误把透明头部空白当实体障碍的问题；音频 focus hook 保留在看谱子组件，维持离开看谱时原有的全屏所有权生命周期。
- 首轮真实后端检查中，对照旧几何断言失败，另两个场景缺默认 Chromium；修正断言、安装浏览器后，三项后续检查通过。首次记录未被当成成功。

首次本机验证时，WebKit 虽已下载但宿主环境缺少 GTK4 等动态库，未宣称其通过；后续固定 CI 镜像补验见下节。仍未执行手机真机、VoiceOver/TalkBack 或已安装 PWA 验收。没有改存储、权限、原音频/XML、manifest、设备设置或发布通道，没有合并、部署或推进稳定版。

具体条件与检查状态见 [evidence.json](evidence.json)。

## #660 扩展 CI 后续诊断

原 head `f83c933` 的 required CI 成功，但 [扩展验证 visual (1)](https://github.com/clydian/same-page/actions/runs/43656576559/job/132636544641) 为 83/84 通过：WebKit 已完成 XML、全屏与恢复步骤，随后在新增音频阶段等待“2 个附件”30 秒超时。CI 检出的 merge `e874f2a` 与 head 的 Git tree 相同，不能用提交 SHA 不同解释为另一份产品代码。

用相同固定 Playwright Noble 镜像 digest、Node 24.22.2、Playwright 1.64.1、WebKit 27.2、libsoup 3.6.6 对照：

| 运行 | Chromium | WebKit |
| --- | --- | --- |
| 未修改的 head 用例 | 通过 | 在“2 个附件”处失败 |
| 原 main `a7d7a7a` 产品，仅追加相同音频入口阶段 | 通过 | 同位置失败 |
| head 仅设置 `serviceWorkers: 'block'` | 完整双引擎通过 | 完整双引擎通过 |

独立的取证运行再次复现 WebKit 失败：导航后显示空的本机目录，mock 未收到该页的认证或 bootstrap 请求；不是按钮需要更久才出现。[失败快照（本地同镜像、合成数据）](webkit-library-mock-failure.png)。快速打开 PDF 后立即导航的缩减对照中，允许或阻止 worker 均通过。进一步去掉全部播放器步骤，只等待 `navigator.serviceWorker.ready` 后导航：main 与 head 都出现同样超时；导航后的 worker controller 存在，`navigator.onLine` 和可见性均正常，但认证请求未命中 mock 而返回 500，且 mock 未收到 bootstrap。阻止 worker 时，认证及 bootstrap 均为合成 200，附件入口可用。这把故障缩减到“worker 就绪后导航与 page.route 的边界”，而不是音量、收展、XML 引擎或网络离线。

该 UI 套件的业务 API 全由 `page.route` 合成，原来却允许生产 Service Worker 注册并在后续导航参与请求。依据上述 main/head 对照及单变量阻止 worker 的结果，将其判为新增 mock 流程的隔离缺口，而非本 PR 播放器产品代码独有的回归。[Playwright 官方网络说明](https://playwright.dev/docs/network#missing-network-events-and-service-workers) 也明确提示 Service Worker 可能使请求绕过路由拦截。

修正只给本套件页面上下文增加 `serviceWorkers: 'block'` 和注释；音频入口、实例连续性、上下收展、焦点、全屏、安全区等断言全部保留，超时、重试及预期均未放宽。真实 Service Worker 生命周期由原有 PWA/离线测试继续覆盖，未在产品或全局 CI 里禁用。自审与独立只读复核通过，完整固定镜像双引擎 2/2 通过，lint 与 diff 检查通过。

这是测试隔离层面的定位，不宣称已查明 WebKit 网络进程的内部根因，也不代替手机真机验收。首次失败并未通过重跑改写为成功；修正 head 的远端 CI 另行核对。
