# 连续翻页交接逐帧证据 · PR #692

修前为 main `7858ad72db83847da8806d0a9a798455a0e60441`（已包含 #689），修后为 `63c736167844339700538a9b27ef4569a60fdabd`。

同一 Chromium 156 headless、同一真实阅读器路由 `/choirs/visual-choir/scores/visual-score`、本地 Worker、合成 API 及六页着色 PDF，PDF.js 实际渲染。390×844、834×1100、1194×834，deviceScaleFactor=1、hasTouch=true、service worker 禁用。CDP Input.dispatchTouchEvent 原生输入：第一笔从 80% 宽度向左滑 42%，6 步；释放后 55ms 开始第二笔，第一步 12px，其余按 14%~42% 宽度滑动，每步等待 animation frame，最后等待 1500ms。两笔均从第 1 页前翻到第 3 页。MP4 由 CDP Page.screencastFrame 原始 PNG 和实际时间间隔编码成 30fps，未人为补造画面。

`pager-pixels.json` 以屏幕上绿色第 2 页的边界追踪逐帧像素：390 在 y=400、834/1194 在 y=100，G > R+25 且 G > B+25。修前第 12→13 帧反向回跳分别 19、58、148px；修后相同三组未检出超过 2px 的反向回跳。这里报告真实画面，不把异步 DOM 前后采样误说成手指的精确 12px 对应位移。`pager-comparison.png` 为 1194 视口第 12、13 帧，等比缩小一半的 2×2 对照；原始坐标见 JSON。

DOM rAF 记录同时包含页码、phase、纸面矩形和活动 canvas。全程保持已绘制的入场页；本场景的闪动属于几何交接和动画采样，不是 canvas 空白重绘。

附加替代验证：1194×834，交替 600×840 / 1000×600 页，受控延迟第 3 页 render promise 完成 1000ms；前翻两笔到第 3 页，连续回翻两笔到第 1 页，双击为 2×、再双击恢复 1×。通过拦截本地 Vite 的 pdf-page 模块，仅延迟 pageNumber===3 的真实 render promise 完成，不修改产品源代码。此运行是集成冒烟检查，未将它量化为逐帧消闪收益。

复现：把本分支的 `reproduce-pager.mjs` 放在对应产品 checkout 根目录，`npm ci --ignore-scripts`、`npm run build:player`、`npx playwright install chromium` 后运行 `node reproduce-pager.mjs /tmp/pager-out`。脚本默认 1194 视口，修改 widths 可复核其余两个视口；`MIXED=1 DELAY=1` 打开上述附加条件。证据脚本只在本分支，不进入产品分支/main。

线上检查：默认 stable target 为 e566a695cb8a1e146ecfcd36436db4bfdcf8ab69，不含 #689；beta target/backend 为 7858ad72db83847da8806d0a9a798455a0e60441，包含 #689。用户实际所选通道及正在运行的旧客户端版本未知。本问题是在包含 #689 的最新 main 上独立复现。

没有 iOS/iPadOS 真机验证，没有大型真实 PDF、真实网络延迟或设备低性能结论。不合并、不部署。
