# PDF 连续横滑翻页验证

修前 main：`6dda75766797ba19917eb442bd2b48163b710648`。修后：`716befad7b88c6407963847273f0f431cdca31e6`。

本地 Vite/Worker 中打开真实阅读器路由 `/choirs/visual-choir/scores/visual-score`，API 使用仓库 `visual-report/fixtures.mjs` 合成响应，PDF.js 实际渲染由仓库两页合成 PDF 扩成的六页文件。无生产用户、真实访问凭证或云端笔记。Chromium 触控视口，CDP `Input.dispatchTouchEvent`；不是页面状态注入、动画模拟或真机视频。

操作：第一笔前翻释放后约 40ms 立即开始第二笔；先移动 12px，再用约 180ms 完成第二笔短滑。390px 视口第二笔共 70px，834px 视口共 150px，均超过新阈值且低于旧阈值；接着同样连续回翻，最后双击放大。短录屏只裁去前面的加载等待，保留真实动作时序。

- [修前手机录屏](before-390.mp4)：两笔前翻后只到第 2 页；第二笔仍为 settling，没有接管。
- [修后手机录屏](after-390.mp4)：两笔前翻到第 3 页，两笔回翻到第 1 页，双击变为 2×。
- [修后平板录屏](after-834.mp4)：834×1100，同样到第 3 页再回第 1 页，双击 2×。

JSON 记录接管时实际谱面 bounding rect（同一 pointermove 前后，MutationObserver 读取可见位置），手机和平板正反方向均随 12px 手指位移连续移动约 12px。视频可见谱面连续移动，无空白闪动；并非逐帧性能测量或所有 PDF 的保证。

限制：未覆盖 iOS/WebKit 真机触控、实际网络延迟、大型真实 PDF、原生键盘；慢渲染与本机准入由确定性状态机测试覆盖，不以固定浏览器等待时间作 CI 门禁。证据独立于产品分支。
