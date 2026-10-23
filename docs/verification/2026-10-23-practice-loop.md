# 练习谱循环选段与定位验证 · #567

## 问题与修复

基线 `521b3469` 中，循环为第 3–5 小节时，`seek(7)` 与 `seekAt()` 都可传入第 8 小节的 tick；普通谱面点击还可清除引擎范围，界面却继续显示循环。会话回归先明确失败（700 !== 400），再统一实际定位边界；普通与放大点击均由宿主命中后进入会话，不再由引擎自行划选／取消范围。

草稿预览暂停但不移动音频位置，可超出旧循环；双端点采用 React Aria Slider，支持单小节、经过次数标签、键盘和触摸逐小节微调。拖动只保留清晰范围条和端点位置，其他设置与背景淡出；释放恢复面板，应用后从 A 开始，取消／关闭恢复原范围、浏览位置和原播放状态。底栏与定位面板使用生效区间，范围外点击吸附最近边界小节。

## 本地验证

环境为 macOS、Node 24、仓库锁定的 alphaTab 与 Playwright Chromium/WebKit。构建包含类型检查、precache 预算及发布契约校验。

- `npm run lint`、`npm run build`。
- `npm run test:player`：342 项。
- `npm run test:unit`：326 项。
- `npm run test:client -- --maxWorkers=2`：148 个文件、1273 项。
- `node --test --test-concurrency=1 browser-tests/playback-ux.test.mjs browser-tests/practice-measure-labels.test.mjs browser-tests/musicxml-playback.test.mjs browser-tests/practice-loop.test.mjs`：四个文件共 11 个测试，分别已运行通过。包含真实音频输出／PDF 切换、混音和首调数字、反复经过标签与第二次经过点击、普通／放大点击、前后定位、Home/End、单小节循环、播放中取消恢复、透视拖动、有效小节高亮和取消保留旧范围。

全套客户端首轮采用默认并发且与浏览器检查同时运行，出现三处非播放器页面的等待失败（AppRoutes、Home Entry、ReaderPage）。限制客户端 worker 数为 2 后全套通过；未放宽业务超时或修改这三处测试。此记录不将一次重跑通过当作已证明根因。

## 独立 review

规范与 Spec 两轴分别进行。发现并修复：

1. 原生范围高亮遇到一个整小节长音／休止符会清空；改为实际小节 bounds 标记，浏览器断言非零尺寸可见标记。
2. 原生 `getBeatStart` 只返回首次经过；现在按循环内对应经过次数选择位置，再加相对拍偏移。会话测试明确断言第二次经过 tick 620，而非吸附到 A 的 tick 400，浏览器也点击第二次经过片段中的终点小节。
3. 仅靠键盘不足以在长曲上精确触摸选段；增加 A/B 选择与有边界的 −/+。
4. 手动浏览后的重排 anchor 分支会漏更新预览标记，并可能覆盖端点定位；真实合唱谱还暴露出宿主工具栏避让会持续拉回旧音频游标。预览现在优先于旧 anchor，使用实际小节坐标，并显式暂停原生跟随和宿主游标避让。回归先复现标记宽度 100px !== 150px 及错误滚动坐标，再修复；真实谱断言目标完整进入视口（顶部约 140px，目标高约 323px），不能仅检查 DOM 可见。

恢复播放使用明确 `play()`，避免 Worker 暂停尚未回传时再次 toggle。取消、失焦、pointercancel 与卸载均释放预览；销毁后的清理不重新播放。

## 视觉与数据边界

测试夹具截图保存在 `artifacts/verification/practice-loop/`；另用已有四声部、71 小节的《Os Justi》检查桌面 1024×768、平板 820×1180、手机 390×844 的设置和拖动透视效果。真实谱源文件及截图不加入 PR。

没有更改源谱、数据库、云 API、访问权限或持久偏好格式。本地浏览器模拟不替代 iPhone/iPad/Android 真机触摸验收。PR 提交不代表合并或部署。
