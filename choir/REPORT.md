# #701 合唱视唱验证

候选提交 `ab3b4e327c2a2aef1a69a5cb613bf74bc5b4abb9`。

## 浏览器对照

使用生产版构建、隔离云盘 fixture 和合成双声部乐谱。管理员创建并发布一题，只填写名称、乐谱和小节。独立浏览器会话中的普通成员可打开题目，选择 Alto，开启持续 C3 和 Soprano 伴奏。演唱中有 Stop、当前小节、候选音与测到的音高。以 390×844 手机和 1200×1030 桌面视口各测两种语言和两种主题的组合。

合成谱的 Alto 第一个事件为 C4／E4 同时发声，第二个事件为 D4。Soprano 在同两段发声 G5 与 A5。注入浏览器输入节点的合成演唱依次为 E4 +35 音分、D4 准确，保留真实 AudioWorklet、Pitchy、逐音反馈和 WAV 回听处理。结果为 E4 偏高、D4 准确，总分 50。伴奏只输出 C3、G5、A5，前两音在试唱起点，后一音在 1.0 秒，使用和录音相同的 AudioContext 样本时钟。

勾选钢琴对照后读取本机混合 WAV。文件采样率及长度不变。减去衰减后的原录音，首段 E4 的相关幅度超过 C4 的 8 倍，第二段检测到 D4，验证输出确实采用本次评分比较的答案。点第二音回听时，播放从 1 秒开始，反馈行随播放高亮。重新载入后练习记录仍可展开查看，包含声部、伴奏、分数、题目版本与逐音结果。历史记录没有音频元素。浏览器通过路由拦截阻止访问示例服务器以外的域名。

浏览器发布场景使用 fixture。真实权限、隔离和版本冲突由仓库的 Worker／D1 集成用例覆盖，包括成员读取、非成员拒绝、编辑权限、源文件版本验证、同请求重试和过期更新。全部是本地合成数据。真机 iPad Safari／主屏幕版的同时录音与播放、耳机路由和麦克风串音仍需确认。

## 重跑

把本目录 `verify.mjs` 下载到临时目录。切到上述提交，在合谱 checkout 安装依赖和 Playwright Chromium 后运行：

```sh
npm ci
npx playwright install chromium
node /path/to/verify.mjs /tmp/sight-choral-frames
npm run test:worker:integration -- worker/attachments-flow.test.ts -t 'publishes voice-neutral'
```

截图来自上述实际浏览器构建，素材为测试中的合成谱面。脚本动态生成合成声源，证据仅含截图、脚本和文本。
