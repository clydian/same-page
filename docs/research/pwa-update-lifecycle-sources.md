# PWA 更新生命周期与缓存保留调研

调研日期：2026-10-21。用途：为 Android 旧版更新失败选择可实施的长期方案。本文是研究记录，不代表已采纳 ADR；112 MiB 临时提案已撤回。

## 结论

当前问题不是浏览器规定只能保存 28 MiB，也不是 PWA 要逐版升级。项目把自己的全量版本缓存预算设为 4 × 7 MiB，又同时保护最近 24 小时全部已激活版本；密集发布会使两条规则互相锁死。单纯改成 16 份只延后相同故障。建议把“准备新版”和“切换当前页面”分开；缓存清理围绕实际依赖和一个回退版本进行，容量管理由按角色及时回收和单版本大小门禁承担，不能因为旧保护对象合计超标就永久阻止安装。真实写入失败仍须完整保留现有可用版本。

24 小时是项目为了历史页面采用的启发式，不是 Service Worker 的强制规则。完全取消它之前，需要明确浏览器冻结历史页面的恢复路径，尤其不能把 `clients.matchAll()` 当作全部历史文档清单。Chrome 的现实现已为这条路径提供了很强的简化基础；其他浏览器及已经发布的旧页面仍需迁移验证。

## 平台事实与证据边界

### 更新可跨多个版本，安装失败不替换当前版本

浏览器比较当前下载的 Service Worker 脚本与已有脚本，尝试安装新版本。新安装成功后通常进入 waiting，旧版本仍控制现有页面；安装阶段拒绝会丢弃候选，新旧切换不是“依次执行每个历史版本”。官方特意提醒激活逻辑的来源可能是很久以前的版本。因此所有 schema/API 迁移必须兼容直接跨度升级，不能依赖用户曾打开每个中间版。[web.dev 生命周期](https://web.dev/articles/service-worker-lifecycle)、[PWA 更新](https://web.dev/learn/pwa/update)

`skipWaiting()` 跳过等待，但不跳过安装；它会让旧 HTML/JS 页面后续请求由新 Worker 处理。`clients.claim()` 还可能接管原先没有受控的页面。它们并非禁止使用，但不得作为不检查页面状态的自动更新惯例。[web.dev 生命周期](https://web.dev/articles/service-worker-lifecycle)

官方 Workbox 建议：预缓存大量 HTML 的应用应提供更新提示；用户同意后向 waiting Worker 发送切换消息，在 controllerchange 后重载。该方案支持明确、安全的交互时点，不代表能替应用保证未落盘编辑已保存。[Workbox 更新交互](https://developer.chrome.com/docs/workbox/handling-service-worker-updates)

### matchAll 不是 BFCache 文档清单

`includeUncontrolled: true` 扩展的是同源客户端范围，不能理解为“包含全部冻结历史页面”。W3C 项目维护者在 2021 年 WPT 讨论中记录：Chrome、Firefox、Safari 的 matchAll 都不包含 BFCache 页面，恢复后才出现；当时 claim 在 Chrome 中驱逐 BFCache，而 Firefox/Safari 忽略它。此处是有测试支持的历史实现观察，不是跨浏览器、跨版本的永久规范保证。[MDN matchAll](https://developer.mozilla.org/en-US/docs/Web/API/Clients/matchAll)、[W3C ServiceWorker #1594](https://github.com/w3c/ServiceWorker/issues/1594)

普通后台冻结与 BFCache 也不能混为一谈。Chrome 官方说明冻结会暂停可冻结任务，计时器和 fetch 回调不再正常执行。因此“750 ms 内不回消息”不能推出窗口已经不用旧资源，按存活心跳超时直接删除资源不可靠。[Chrome 页面生命周期](https://developer.chrome.com/docs/web-platform/page-lifecycle-api)

### Chrome 会因 Worker 切换驱逐 BFCache

检索 Chromium 当前 main 的源码，得到比“历史页面可能存在”更具体的结论：

- `ServiceWorkerRegistration::ActivateWaitingVersion()` 在替换已有 active Worker 时调用 `exiting_version->EvictBackForwardCachedControllees(kServiceWorkerVersionActivation)`。
- `ClaimClients()` 明确包含 BFCache 客户端，以便在需要时驱逐。
- `ServiceWorkerVersion::PostMessageToClient()` 若目标仍在 BFCache，调用驱逐后返回，不让冻结页面处理消息。

来源：[Chromium registration 实现](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/browser/service_worker/service_worker_registration.cc)、[Chromium version 实现](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/browser/service_worker/service_worker_version.cc)、[Chromium client 实现](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/browser/service_worker/service_worker_client.cc)。源码读取于调研当日，main 会变化；实际发布测试还应记录所测 Chrome 版本。

MDN 也列出 serviceworker-version-activated、serviceworker-claimed、serviceworker-postmessage 等浏览器特有的 BFCache 失效原因。这些原因支持上述实现，但其存在不证明所有浏览器都采用相同策略。[MDN BFCache 失效原因](https://developer.mozilla.org/en-US/docs/Web/API/Performance_API/Monitoring_bfcache_blocking_reasons)

**工程推论**：对于这条 Chrome 实现，若页面确实来自当前 shell，旧 active Worker 未切换时保留该 shell 即覆盖这些页面；切换 active 时旧 Worker 控制的 BFCache 页面会被驱逐，返回历史记录会重新导航。本项目旧 fallback 可能曾展示别的完整版本，因此不能进一步推成“保留当前 shell 即可覆盖所有旧页面”；这也是固定 legacy 集合必须包含旧完整候选的原因。无需为每次历史激活都保留一整天全量 shell。不能据此保证 Safari/Firefox 的旧版页面同样安全；新页面的 pageshow/resume 检查也无法追溯添加到已发布页面。

### 存储预算是估计，写入才决定是否成功

`navigator.storage.estimate()` 的 usage/quota 是整个 origin 的近似值，可能包含压缩、去重、隐私扰动；不是为下次安装预留空间的凭证。不能因为估计足够就保证成功，也不应因为保守估计不足就直接断言浏览器已满。[MDN estimate](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/estimate)

真实超额 Cache API 写入会拒绝并可能抛出 `QuotaExceededError`。默认 best-effort 存储可能在压力下被浏览器驱逐；业务 IndexedDB 与应用资源都可能处于同一 origin 配额内。可申请持久存储，但这不是更新方案的必要门槛，也不免除应用控制公共资源缓存的责任。[web.dev Web 存储](https://web.dev/articles/storage-for-the-web)、[MDN 配额与驱逐](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)

Workbox 常规做法是 install 添加新资源、activate 清除旧清单中不再需要的资源。它验证了“按版本依赖清理”是正常做法，但其默认清理不能直接套到本项目：本项目有并存安装者、旧页面哈希资源及独立版本目录，需要保留自身已经建立的隔离和完整性校验。[Workbox precaching](https://developer.chrome.com/docs/workbox/modules/workbox-precaching)

## 三种可行方案

| 方案 | 修改与收益 | 代价 / 保证边界 |
| --- | --- | --- |
| A：删除总量硬准入，保留现有 24h 与引用 GC | 最小兼容修复；最新安装者不再被旧 Worker 的人为预算锁死；沿用已上线旧页面保护；真实 quota 失败仍保留旧版 | 最近一天发布越多空间越大；未响应窗口可能长期阻止清理；需要后续 GC 触发，不能称资源严格有界 |
| B：准备/切换分离，实际引用 + 一个回退，按角色清理 | 推荐长期方案；不按全部 activated 时间保护；保留 active/waiting/installing、仍使用的页面版本、一个已验证回退；安全闲置或用户主动更新时、所有当前窗口可安全切换才激活 | 必须验证 BFCache、隐藏窗口、更新期间新开窗口，以及已发布旧页面迁移；目标是常态少量版本，不是假装所有情况下只有两份 |
| C：回到普通 Workbox 单份清单与自然 waiting | 生命周期简单，依照浏览器自然退出旧窗口后激活 | 已有证据表明旧 waiting Worker 与并行安装曾污染共享预缓存；直接回退此方案会重开已修复竞态，也会令常开 PWA 的更新不直观；不推荐本轮重写 |

B 不需要引入内容寻址共享存储、永久窗口租约服务、每页心跳或复杂数据库。保留现有不可变 shell 格式、完整性验证和生命周期锁即可；不要借本次修复重写资源层。

## 推荐落地与旧版过渡

1. **先保证最新版可被准备。** 删除“已保护 shell 总和大于固定阈值便拒绝安装”的死锁条件；保持单版本构建大小门禁与候选总下载超时。安装前请求当前 owner 清理无引用对象；安装后/激活后继续 GC。软预算超出时记录原因和保护数量，不能静默换一个更大的硬上限。
2. **切换独立进行安全判断。** 下载和校验允许后台进行。按用户在 2026-10-21 确认的产品偏好，安全场景允许自动发起切换；保留手动更新及多窗口未保存写入 veto，不无条件 skipWaiting。切换成功 controllerchange 后只重载已准备好的安全窗口。无法回应的活窗口不能当成已安全保存。
3. **清理依据依赖。** active/waiting/installing 必留；当前页面版本必留；另保留一个完整回退。锁内固定候选快照、删除前复查引用，保持现有并行安装防护。只删本产品拥有的公共 shell/播放资源，不碰 PDF、草稿、笔记或业务 IndexedDB。
4. **新页面具备恢复能力。** pageshow（特别 persisted）/恢复前台时核验自身版本资源是否仍可用；不存在时先确认编辑写入完成，再重载到已准备版。不要每次恢复都强制重载；不能自动刷新未持久化编辑。浏览器可随时驱逐缓存，本来就需要可恢复的缺失资源路径。
5. **旧页面过渡必须测试。** 已发布旧页面没有新恢复逻辑。一个不依赖魔法 TTL 的有限过渡策略是：首次升级时已存在、无法证明从未展示的旧保留协议 shell 作为固定 legacy 集合保留；因为现有 fallback 可展示未 activated 的完整候选，旧集合必须包含这些 `complete` 记录，不能只包含 activated 记录。新 shell 使用新保留协议，不再逐版本累积 24h 保护。旧集合不随新发布增长，可留到浏览器自行驱逐，无需为回收这一次性空间新增复杂协调器。原 28 MiB 准入约束能约束当时的 owned shell 集合，但不涵盖独立 Workbox/业务缓存，不能声称整个 origin 只多 28 MiB。若要立刻回收旧集合，必须补 Safari/Firefox 真 BFCache 验证或明确弱化兼容承诺。另一选择是先采用 A 过渡，待协议覆盖后采用 B；成本是过渡期仍有时间窗口增长。不能宣称只靠一次 matchAll 就对全部旧浏览器保证丝滑。保留原 24h 规则只是与现有保证相当，24h 后仍非永久保护。
6. **真配额失败有界重试。** 在现有锁和引用复查下再清理一次能证明无用的公共资源，然后只重试一次候选写入；若无可删对象则给具体空间错误，保留当前版及已有 waiting 版。不要调用全 origin clear / unregister / 删除业务数据库作为自动“修复”。

### unknown 窗口不应导致候选无限积累

unknown 窗口需要阻止危险的切换和旧已激活页面资源清理，但不应阻止下载。只要切换仍受阻，就不会不断产生新的已激活历史版本；主要增长源是反复安装后被取代、从未激活的候选。

**本项目现有实现存在重要反例**：`ShellRuntime.navigation()` 的降级会遍历所有 `complete` 且非 current 的记录，没有要求曾 activated；`readyBuild` 也可能验证这些记录。因此旧元数据中的“从未 activated”不能推出“从未展示”，不能直接据此绕过 unknown 客户端保护删除旧候选。

推荐同时收紧新协议：导航回退只选择曾激活或明确记录已经展示、且验证完整的记录。只有在这条新不变量成立后，新协议中“仍带候选专用持久标记、当前没有 active/waiting/installing 角色、也没有有效安装租期”的 abandoned candidate 才能独立回收，而不受 unknown 客户端全局 veto。仍需持锁并在删除前复查角色与状态。

新规则下，unknown 老页面不能凭自身旧 HTML 引用从未展示的新候选特有资源；其中与旧页面同 hash 的公共 bytes 仍应存在于被保留的旧 shell。旧格式现有 `complete` 记录无法追溯证明没有通过旧 fallback 展示过，应纳入固定 legacy 兼容集合，不应只保留旧 activated 记录。相比新增窗口心跳/超时租约，这条可验证的导航与回收不变量更简单，但必须和 fallback 修改一起实施并测试，不能只改 GC 判断。

未知窗口长期存在的体验应是“新版已准备，需先结束其他窗口的编辑”，不能虚报“没有新版”或因为公共缓存清理暂停而永久停止准备更新。

## 必须验证的场景

- 从线上旧版直接安装最新候选，不依赖任何中间版本，旧版预算不能继续封锁候选。
- 单日连续二十次小发布，常态能持续准备最新版本，清理后数量不随发布次数增长；不要只测试第五次变成可用。
- A active、B waiting、C installing 的竞争、安装中断、真实 quota 拒绝：A/B 与草稿保持可用。
- 可见窗口、后台冻结窗口、未保存窗口、新开窗口竞争；用户拒绝更新时可继续使用。
- Chrome 与 WebKit 的真实前进/后退 BFCache：不能用普通 goto 或单元 mock 冒充；记录 persisted 或 notRestoredReasons，并验证旧异步 chunk 请求、离线返回、切换前后返回。
- 旧页面无新恢复协议、新页面有协议两种；保存失败不得自动 reload。
- 缓存被浏览器驱逐或缺失元数据；缺失降级不能变成完整站点数据清理。

本节为调研时的验收要求；实现结果以 PR 验证记录为准。

## 本轮建议采用的具体方案

选择 B，在同一发布中完成安装、回收、恢复及旧客户端兼容；不发布 112 MiB 中间补丁，也不要求手机先安装过渡版本。

### 保留集合与删除规则

以 `active ∪ waiting ∪ installing ∪ 当前可枚举页面使用的版本 ∪ 一个完整历史回滚版 ∪ 固定 legacy 集合` 为保留集合。回滚可由集合内已有历史版本承担，不为了“额外一个”再堆一份。正常稳态为当前版和上一完整版本；等待更新时多一份，安装竞争、仍打开的旧窗口及一次性 legacy 集合可以暂时更多，不能强制删成固定两份。

取消新协议中的逐版 24 小时保护和所有版本合计的 byte 准入门槛；单版本 7 MiB 构建门禁继续保留，安装器也校验自身清单大小。存储估算用于反馈和排查，不当作可写空间预留或硬性拒绝条件。容量管理依靠可证无用版本的及时回收，而非每次发布增加固定保留时长。收集时机为安装前、激活后和前台恢复重试，沿用现有生命周期锁与删除前复查。

### 不响应窗口与废弃候选

未响应窗口阻止危险的切换，并暂缓不能证明安全的历史清理；不阻止新版本下载。新协议同时收紧 fallback：只允许当前版和经过确认的已展示历史完整版，不能随意显示任意 `complete` 候选。在这个前提下，已被后续更新替代、没有任何 registration role、从未激活或展示的新协议候选可独立回收，避免后台窗口让每次下载都积累一份。并发出现新 role、安装或页面引用时放弃本次删除，稍后再做。

### 一次性旧版兼容

对升级前旧协议中可能已经展示的 owned shell（至少所有旧 `complete` 记录）不进行激进回收，保持原缓存地址、不复制内容，作为固定 legacy 集合。后续新版本以 v2 命名空间标识新保留协议，不再加入 legacy 集合；中断重试、页面重新打开也不能把新版本重新归入旧集合。现有旧 owned shell 受 28 MiB 原预算约束，现场约 26.4 MB；这是一次性、不会随新发布增长的兼容成本，不是新用户的永久额外预留。旧 Workbox 缓存继续保持既有不接管删除的边界。

不为回收这一次性的二十几 MB 引入定时迁移、心跳租约、跨客户端确认系统或新的历史资源服务器。浏览器自行驱逐并非恢复机制或草稿安全保证；始终保留缓存缺失后的恢复路径。如果未来需要主动回收 legacy 集合，另以真机数据证明可以安全回收后再处理，不在本轮静默扩大删除权限。

### 恢复和交互

准备完成与切换完成分开显示。按用户确认的产品偏好，采用“安全场景自动应用；不安全时继续旧版、待安全后自动重新评估；保留手动入口”，不要求每次更新都让用户点击。

自动应用沿用现有安全场景：页面在首页、云盘列表、云盘文件库或关于页；前台可见、联网；沿用至少 3 秒无输入、点击、滚动等交互的条件；无聚焦输入框、弹窗、菜单，也无编辑、上传、导出、播放等阻止更新的任务；最新版已完整准备。多窗口均须确认可安全切换，切换前复查新窗口及任务状态，不能以一次空闲计时作为充分条件。阅读器、练习播放、编辑页不自动重载；后台窗口不主动唤醒刷新；仍能回应且无操作的后台文件库可以确认控制权交接，但保留旧资源并等前台再安全重载。冻结或忙碌窗口不响应不视为同意。回到前台重新开始空闲判断。

用户手动更新可以跳过空闲计时，但不能跳过写入、任务和多窗口保护。已在本机可靠保存但尚未云同步的草稿不要求先上传完，也不因更新删除。若安全条件消失，本轮停止切换并保留已准备候选，待操作结束、路由变化或恢复前台后重新评估，不反复提示。

现有代码已经有 `canApplyUpdate` 安全场景和已开始交接后的自动完成；当前定时器明确不会仅因空闲而主动发起更新。实现应保留这些能力，并将安全自动发起和手动发起统一到同一切换路径，不把现有部分自动行为误记为已实现所有上述要求。关于与更新同时显示当前运行版与已准备版，独立诊断仍作为旧版救援入口。

新页面在真实 `pageshow.persisted` 和必要的前台恢复时检查自身 shell 是否仍可服务，处理 Vite `vite:preloadError`（[Vite 官方加载错误处理](https://vite.dev/guide/build.html#load-error-handling)）。若资源确实缺失，先走现有编辑持久化完成与更新安全检查，再切换到本机已验证完整版本；已存本机但尚未上传云端的草稿不能因此删除，也不要求先全部云同步。没有可用完整版、保存失败或离线无法补全时保留当前页面与编辑状态，明确提示恢复条件，不进行 reload 循环。不能用这个新处理器宣称已修补历史旧页面。

真实 `QuotaExceededError` 仅允许在清理掉可证无用公共资源后再尝试一次；无法腾挪或仍失败则保留当前/既有 waiting 版本和全部业务数据，报告真实容量错误。安装失败清理新候选自身，绝不全站清除或自动重装。

### 范围和验收门槛

实现集中于现有 shell runtime、SW 消息、新旧页面恢复和更新状态、诊断 schema；不修改业务 IndexedDB schema，不重写 PDF/笔记层，不新建共享资源存储、心跳服务或后台任务系统。同步修订 ADR-0020，把角色保留、旧协议兼容集合和 fallback 限制作为同一个决策。

发布前至少通过：

1. 线上旧 `fcb9631` 四份缓存直接准备当前最新版，跳过中间发布；旧 PWA 与独立入口两条路径都验证，准备成功和真正激活后运行版分开断言。
2. 连续 20 次更新：固定 legacy 字节不增长，新协议已激活稳态不按发布次数增长；unknown 页面存在时连续替换 waiting 候选也不能无限增长。
3. 当前/等待/安装三角色交叠、失败候选回收、回滚验证、缓存损坏与真实配额拒绝，旧可用版和未同步草稿保持完整。
4. 浏览器真实 BFCache 与后台冻结/恢复，分别测试旧页面无 guard、新页面有 guard；进入 BFCache 需有 persisted 或对应浏览器证据，不能以普通重载替代。Chromium/WebKit 自动化与 Android 原机验收分别记录。
5. 安全页面闲置后自动应用；输入、滚动、菜单、弹窗、阅读、播放、上传、本机保存中不自动应用；操作结束再评估。手动操作不越过保存与多窗口保护。正在编辑、本机保存失败、离线返回、动态 chunk 缺失时均无强制丢编辑和无限刷新。恢复成功后版本、草稿、云盘均可再次核实。
6. 本地全量门禁及既有 CI；只通过 main CI 发布，使用原始封存产物独立验证生产，再由原手机报告确认更新已完成。

用户已确认本轮方案及安全场景自动更新偏好，实现采用 v2 缓存命名空间隔离新候选与旧 v1 worker（旧 worker 不会通过 fallback 展示 v2 候选）；发布和原机验收结果分别记录在 #523 对应 PR。原始“数据库超时、重启后恢复”的阻塞来源仍需独立追踪，不能把缓存策略修复当作它的根因修复。


### 实现中的持久化边界

v2 候选在公共注册表持有独立的候选专用标记；激活或首次服务页面前删除它。
这避免将“激活时间写入因 quota 失败”误判成“从未展示”。缺少该标记时按可能已展示处理，
不以缺少 activated 时间戳作安全删除依据。标记只涉及公共程序缓存，不涉及业务数据库。

浏览器连续发布测试直接编译实际 SW 与恢复模块，不另写一套模拟更新逻辑；使用小型完整性清单
完成 20 次 waiting 候选替换和 20 次真实激活。BFCache 需以 persisted 事件作证：Chromium
真实恢复与激活后的返回均测试；本机 Playwright WebKit 未观察到真实 BFCache，因此其结果
只记普通返回与生命周期覆盖，不冒充 Safari 真机后退恢复。旧版固定兼容集合仍保留。
