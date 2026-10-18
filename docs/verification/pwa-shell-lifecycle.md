# 应用壳更新竞态验证

受控历史源码重建实验中，A=8e9f83d、B=4eb296e、C=6975f25：B等待、C安装且
一个HTTP资源暂缓时，关闭A会使B正常激活并删除共享precache中C已写入的index。
C继续安装并激活后缺少index，导航联网跟随/index.html的307，得到原生ERR_FAILED。
旧worker自己发起的删除与时间戳见 ../evidence/pwa-shell-lifecycle/before-prune.json，
原生错误截图同目录 before-native-error.png。并未人工删缓存；这证明缺陷存在，
不代表已证明用户手机当时满足该时序。原始生产ZIP因环境下载代理403未能落地，
历史A/B是对应提交与锁文件重建，不能称生产字节逐字节复现。

修复采用独立且旧worker清理规则无法匹配的缓存名称，完整manifest与精确SHA-256
校验、规范根壳、受保护回收及配额保留策略，见ADR-0020。产品数据数据库未改。
检查更新界面保持#456布局；仅保留旧waiting的更新入口，并区分资源不可用与窗口否决。

`npm run test:pwa-update` 包含原双版本/多窗口安全交接和动画场景，以及
`verify-shell-lifecycle.mjs` 的旧Workbox A/B→新C交错回归。每次审核完整120项
清单而非只检查index；包含API排除、Back、规范index URL、在线修复、离线冷JS
刷新、离线损坏壳的可重试503、重连、真实Chromium quota override失败和重试。
故障注入的缓存缺失与配额场景单独标注，不冒充自然更新复现。

Chromium覆盖自动和明确激活B；WebKit不提供后台worker执行上下文，最后C通过
真实明确安全交接协议完成。桌面WebKit不等于真实iOS/Safari/PWA验收。

可用 SAME_PAGE_LEGACY_A / SAME_PAGE_LEGACY_B 指向历史客户端构建目录重跑
相同迁移流程；CI默认生成使用同版Workbox 7.4.1共享缓存规则的最小旧客户端，
避免每次重新下载和编译历史播放器依赖。SAME_PAGE_BROWSER=chromium仅供本地
明确单引擎诊断；默认CI仍运行两引擎。构建目录与产物只含合成数据。

完整运行截图/JSON由CI platform制品保留在 artifacts/verification/shell-lifecycle。
真实手机、用户此次事件的clientBuild/SW/cache现场，以及长时间后台系统驱逐仍需
独立验收。此PR不合并、不发布，也不修改VPN或生产配置。

本地容器PID 1不及时回收已死亡子进程，既有process-lifecycle测试的kill(pid,0)
不能区分活进程和zombie；仅调整该测试以严格接受Linux Z状态或ESRCH/ENOENT，
不放宽终止信号错误或修改产品进程清理逻辑。
