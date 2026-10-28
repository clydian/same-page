# 固定版本资源的双线路读取与更新恢复

需求：[GitHub #603](https://github.com/clydian/same-page/issues/603)。正式域名、共同后端、发布通道和业务数据协议保持现状。

## 模块与覆盖范围

`src/shared/read-transport.ts` 集中定义读取线路顺序、可重试网络错误、有界且可取消的读取尝试，以及固定版本公开资源的完整读取。API 的 `ConnectionController` 复用线路顺序和错误分类，保留既有凭证准备、同一会话校验、冷却和写操作规则；API 返回响应头后，其响应体仍由原业务读取流程管理。

`public-asset-fetch.ts` 统一页面与 Service Worker 的构建配置。只对已配置主机上的 `/_releases/<40 位 SHA>/...` 允许跨线路；其他路径保持当前 origin。页面公共下载尊重手动线路选项；自动模式下每个读取器优先继续使用自己已成功的线路。Service Worker 独立自动选路，不依赖页面登录身份或 localStorage，不把公开资源连通性当成私人 API 的身份凭证。

公开读取无 Cookie、无 Authorization、不跟随重定向；网络断开、读取响应体失败或超时才尝试下一线路。连接阶段每次最多四秒，整次文件读取及验证每线路最多六十秒，另受调用方总预算限制。HTTP 错误、内容校验失败不通过切线掩盖。调用者取消后立即停止，不再尝试备用。

Worker 仅为固定版本公开资源、GET/HEAD、配置中的 Origin 添加 CORS；不开放凭证、发布通道接口、动态 HTML 或 `/sw.js` 的跨域读取。`Vary: Origin` 同时覆盖未携带 Origin 的响应，防止中间缓存混用响应头。已有前后端连接开关继续生效。

调用者负责提供版本绑定的验证规则：应用壳使用内嵌清单的 SHA-256/MIME 和 HTML build ID；播放器清单核对 build ID、发布前缀与音色／字体内部目录的版本绑定，文件核对字节数、SHA-256 和类型。两条线路只能完成同一个版本，不拼装不同发布。缓存键仍是当前 origin 的原始 URL，不写入备用 origin 的 CacheStorage 或业务 IndexedDB。

## 更新与缓存生命周期

1. 主域名 `/sw.js` 和发布通道确认保持原流程。不能从备用域名推断主域名的稳定版／测试版选择。
2. 安装时先保护当前候选的安装租约，再请求活跃 worker 回收其他无引用缓存。租约覆盖五分钟安装预算及收尾余量。
3. 每个文件优先复用并重新校验已有字节，缺失部分由公共读取器下载；最多四项并行。
4. 网络失败留下已经验证的候选资源，记录保持 `complete=false`、candidate-only，移除安装租约；下次同一版本安装重新校验后补齐。不是单个文件的字节级续传。
5. 修复无效／缺失条目时先删除失效记录再写入；实际 WebKit 失败安装回归中，单独 put 可能返回成功但后续校验仍缺失，显式 delete 后修复可通过。WebKit 也可能在拒绝安装后丢掉该候选缓存的已写入内容，此时按缺失资源重新下载，不能承诺每种浏览器都保留进度。非网络错误沿用原新候选清理规则；浏览器配额故障仍只在回收确有收益时重试一次。未完成候选不授予显示权限。
6. 全量校验、在线版本授权确认和注册表提交完成后才准备就绪；激活、跨窗口两轮确认、安全路由和草稿保护继续走原流程。

失败候选属于既有应用壳回收规则：在没有安装／等待／活跃 worker 引用且租约结束后可被回收。恢复是可复用已保留资源，不保证浏览器或既有回收器永远保留每次失败进度。旧 v1/v2 名称、业务数据库与离线授权协议不迁移。

播放器公共资源准备以及 Service Worker 从已保存播放器清单修复资源，也使用同一个公共读取器。未取得可校验清单的任意动态脚本请求继续使用原路径；不为没有版本校验依据的文件推测资源或放宽校验。

## 明确边界

首次 HTML、浏览器自身获取 `/sw.js`、主域名的发布通道确认仍依赖主线路；应用层无法透明替换这些请求。两路共用后端，不能防护共同后端故障。保存／上传不新增盲目重放。旧客户端继续使用原路径；新客户端备用 CORS 尚不可用时更新失败仍保留当前可用版本。本变更不修改生产 DNS、ESA、证书或部署开关；真实大陆网络收益仍需发布后的设备与运营商观察。

## 验证

- `npx vitest run --config vitest.node.config.ts src/shared/read-transport.test.ts scripts/shell-runtime.test.js`
- `npx vitest run --config vitest.client.config.ts src/client/connection/controller.test.ts src/client/playback/offline-player-assets.test.ts`
- `npx vitest run --config vitest.worker.config.ts worker/releases/releases.test.ts worker/connection/connection.test.ts`
- `node --test browser-tests/resilient-update.test.mjs`
- `npm run typecheck`、`npm run lint`、`npm run build`、`npm run test:pwa-update`

新浏览器测试默认进入 PR 与发布前的阻塞组，使用实际 `service-worker/sw.ts`，仅注入小型固定版本清单并关闭发布通道来隔离线路行为；原 PWA 矩阵继续覆盖真实发布授权与多窗口交接。Chromium / WebKit 分别验证断连接、响应体中断、连接挂起、双线失败后恢复、错误内容与 CORS 拒绝，并验证可选播放器资源的备用修复与完整性拒绝（共 14 个用例）。测试站点仅为本机两个随机端口，不访问真实用户数据。
