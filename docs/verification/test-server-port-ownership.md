# 测试服务器端口所有权与 workerd 启动竞态

基线为 main `b3db24b9c2858952386cb1c43fbcfb2caeb44054`。只修改测试启动器及其回归；不改应用、依赖版本、CI/部署配置，不重跑旧失败，不合并或部署此修正。

## 原始失败与证据等级

[run39378715350 / visual(4) job118482674316](https://github.com/clydian/same-page/actions/runs/39378715350/job/118482674316) 于2026-10-20 06:10:17 UTC在globalSetup退出7。Vite严格绑定43175失败，报`Port 43175 is already in use`，同时有workerd Cap'n Proto `incoming RPC message exceeds size limit`。尚未开始浏览器用例，没有trace/artifact。最终verify失败、deploy跳过。不是浏览器断言失败或6分钟分片超时。

确定的代码缺陷：`availablePort()`以`listen(0)`探测后立即close，再进行配置/fixture准备、spawn npm/Vite；HTTP端口在这整个期间没有所有者。安装的Cloudflare插件在configureServer中先启动Miniflare，后绑定Vite HTTP；Miniflare启用dev registry时给workerd传`--debug-port=127.0.0.1:0`。因此该启动流程自己的RPC监听也可能占用刚释放的端口，不必假定是外部runner或遗留进程。

受控实验使用原Vite/workerd二进制，只通过`MINIFLARE_WORKERD_PATH`包装器控制一次端口选择：若原目标端口仍空闲，就让debug socket选择它，否则保持原`0`。这模拟内核允许的端口选择，不改二进制、测试断言或超时。

- 修前：目标41003可绑定，真正workerd PID35731在41003监听，`ss -ltnp`确认所有者。随后的就绪HTTP轮询触发同类Cap'n Proto RPC超限，Vite最终报端口占用。捕获的是同一个本地启动流程内的监听者与错误链。
- 修后：同一选择规则在目标40897得到EADDRINUSE/errno98，因为父进程持续持有它；workerd保持debug端口0，Vite正常启动，最终HTTP200且run-id匹配。停止后两个实验端口均无监听。
- 同一永久回归在临时还原基线启动器时确定失败：准备阶段另一个监听者能成功绑定，实际值undefined而合同要求EADDRINUSE；恢复修正后通过。临时替换在finally中恢复。

原CI没有保存43175的历史PID/端口快照，不能事后唯一证明占用者就是workerd，也不能估计发生频率。证据确定了可复现、与原始双重症状一致的内部冲突机制；修正消除对所有竞争者都开放的端口释放窗口，不依赖猜中历史进程。版本与精简快照见[证据JSON](../operations/ci-port-ownership/evidence.json)。原日志及完整本地控制程序/输出另保留在`artifacts/verification/port-collision/`。

## 修正与边界

测试父进程直接`listen(port ?? 0)`并持续持有对外TCP监听，先确定fixture/认证origin。Vite用`--port 0 --strictPort`独立原子绑定；从它打印的完整loopback Local URL读取实际后端地址。对外监听只在地址明确后转发原始TCP字节，原有run-id响应头仍是就绪判据。没有检查后释放、重启重试、重新seed或绕过断言。

使用TCP而非HTTP重写，保留Host、cookie、请求/响应body、流式传输和升级协议；支持请求侧FIN之后的响应。停止时只关闭本启动器持有的连接、监听和原有子进程组，保留其他fixture。显式指定已占端口仍会明确失败，不悄悄换端口或干扰占用者。

新增的一层loopback转发有本地连接成本；它换取跨平台持续端口所有权，不依赖私有Vite API、继承文件描述符或系统端口范围。Vite升级如果改变Local URL格式，会明确无法就绪；集成CI验证dev和preview两条真实路径，而不是信任某个任意服务的200。

失败时在清理前写`artifacts/verification/server-startup/<run-id>.json`，记录父/子PID、已知地址、`ss`端口所有者、仅本子进程组的进程名/监听及有限启动日志；进程快照不记录argv或环境变量，也不收集请求内容。没有ps/ss或写证据失败不覆盖原错误；关键所有权事实也附到原失败日志，globalSetup失败仍有可读依据。

## 验证

`npx vitest run --config vitest.node.config.ts scripts/vite-server.test.js scripts/process-lifecycle.test.js`覆盖准备/启动期间持续占用、停止释放、并行隔离、显式冲突不伤及所有者、真实子进程错误17及清理前证据、HTTP/cookie/128KiB数据/单向FIN/升级二进制与连接清理。

全量Node196项、lint、构建/typecheck/precache本地通过。系统Chromium154的真实Worker/D1/R2浏览器重启离线、已认证笔记保存与离线/在途编辑，以及通过与CI相同globalSetup运行的隐私页pending/handoff/原footer三条路径通过。固定Chromium151/WebKit及全套负载以draft PR最终head CI为准，不以本地154替代。

修正只针对已证明的端口分配竞态，不宣称消除了所有外部runner资源故障或其他独立测试波动。原main失败run保持原样；恢复线上发布不在此draft修正的授权范围内。
