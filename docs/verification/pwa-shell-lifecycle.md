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

性能复核确认旧版导航每次串行审核约6.5MB，安装请求也串行。以bc72313构建为
调整前基准，本地Chromium每个安装响应延迟200ms、导航CPU限速4倍，安装约
28.5s→9.7s；5次热导航首字节中位数408ms→14ms，5次终止worker后的冷导航
322ms→31ms。调整后数据来自提交前工作树；这是共享容器上的受控基准，不能
代表手机或生产延迟。安装峰值并发1→3（上限4），120项资源均完成。
重跑：先build，再执行 `node scripts/benchmark-shell-lifecycle.mjs`；可设置
SHELL_RTT（每响应延迟ms）、SHELL_BUILD、SHELL_BENCH_OUTPUT。默认产物放在
artifacts/verification/shell-lifecycle/performance.json。单测另覆盖唤醒不在HTML
首字节前读取全部资产、完整后台审核、必需资源缺失、已激活壳registry配额失败、
读取与驱逐竞争，以及有界并发安装。

CodeQL两条提示位于测试夹具：解析明确Workbox缓存名中的scope URL并精确比较；
本地旧版重定向改为常量 `/`。实际产品worker的query保留断言继续存在；没有把
动态重定向放进生产，也没有以“测试代码”为由忽略告警。

修复后的离线损坏壳[重试页面](../evidence/pwa-shell-lifecycle/after-offline-retry.png)
及[重连恢复](../evidence/pwa-shell-lifecycle/after-reconnect.png)留作人工审阅证据。
本地完整视觉回归中，系统Chromium策略拒绝既有drive-navigation测试的data:
前置文档（ERR_BLOCKED_BY_ADMINISTRATOR）；该子测试及父测试失败，其他187项
通过。未更改浏览器策略或测试以绕过限制；标准Playwright浏览器交由CI验证。
