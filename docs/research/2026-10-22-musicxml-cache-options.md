# MusicXML 缓存与离线准备优化选项（2026-10-22）

> 本文保留实施前的研究基准与决策依据；其中“当前”指该研究版本，不代表 #551 合入后的行为。产品实现和可执行回归见 [实施验证记录](../verification/2026-10-22-musicxml-startup.md)。原始诊断脚本留在研究工作区；本仓库仅收录不含谱文的摘要。

这是性能方案研究，不是已实施的行为变更。产品源码、API、数据库和 ADR 均未修改。基于当前代码和 [上一轮生产 bundle 诊断](2026-10-22-musicxml-startup-baseline.md)；上一轮排除了鉴权、原文网络、Service Worker、IndexedDB 和后台离线准备，因此不能把缓存侧建议的收益直接加进引擎实验值。

## 已核实事实

| 事实 | 代码依据 | 对方案的含义 |
| --- | --- | --- |
| 联网先读取附件 metadata，确认 revision 和非回收站，再查内存；内存缺失就请求原文。离线/网络错误/5xx 才读持久副本；明确 401/403/404 不回退。 | `src/client/playback/musicxml-player.tsx:38-59` | 可以减少原文请求，但当前权限和修订检查必须留在原文选择之前。 |
| mount 的 lifetime verify 和原文初始化分别请求相同 metadata。 | `src/client/playback/use-playback-lifetime.ts:18-25`；`musicxml-player.tsx:39` | 可以合并同一次开谱正在进行的请求；不等于设置长效鉴权 TTL。focus 仍需重新核实。 |
| 持久原文 key 含 owner/drive/score/attachment/revision；记录含 Blob 和对原文的本机 SHA。保存时保留旧版直到新版写入成功。 | `src/client/playback/offline-musicxml.ts:12-35` | 不需要为联网复用新增数据库版本。当前 SHA 是完整性校验，不是服务端签发的新权限凭证。 |
| `readOfflineMusicXml` 同时检查附件目录、已验证 retained PDF/annotation authority、匹配的完整播放器资源和壳，再读 XML、核对 size/SHA。 | `src/client/playback/offline-musicxml.ts:37-52` | 这个函数是“可离线使用”的组合操作，不适合直接成为所有联网打开的快速文件读取。 |
| 原文写入捕获 navigation、workspace session、目录撤权、清理文件 fence，事务内再检查 logout。 | `src/client/playback/offline-musicxml.ts:18-34`；`src/client/platform/local-workspace.ts:92-132` | 拆模块时要保留这些条件；不能只凭相同 key 读取后立即展示或迟到写回。 |
| prepared 内存缓存最多 4 项、32 MiB，写入后固定 5 分钟；读取只更新 LRU，不延长到期。size 只计原文与 prepared.bytes，不计元数据对象。 | `src/client/playback/playback-preparation.ts:4-36` | 一次练习超过 5 分钟，结束时缓存可能已消失；现有 32 MiB 不是完整堆内存上限。 |
| prepared 包含归一化 XML 和方向/速度等元数据，不包含声音实例、MIDI、排版结果；主线程仍从 prepared 导入 Score。 | `packages/player/src/musicxml-direction-timing.ts:29-40`；`engine.ts:22-70`；`session.ts:175-210` | 延长现有 prepared TTL 不能消除主要的模型导入成本。 |
| 音色、字体 URL 含 build ID；manifest 逐项声明 size/SHA。每个 build 独立 public cache，旧包随对应 shell 的安全退休而清理。 | `scripts/playback-assets.ts:8-41`；`src/shared/playback-assets.ts:2-23`；`service-worker/shell-runtime.ts:264-295` | 同一 build 内跨谱共用文件；跨 build 即使文件内容相同，仍是不同 URL/存储命名。 |
| 齐包情况下，一次成功的 `prepareOfflineMusicXml` 会经过三轮公共依赖逐项校验：prepare 循环、prepare 末尾 readiness、保存原文后的 offline read readiness。 | `src/client/playback/offline-player-assets.ts:20-47`；`offline-musicxml.ts:64-67` | 有具体的重复 I/O/SHA 路径；还没有实体手机 trace 证明争用时长。不能称它是前台 await 的串行等待。 |
| SW 提供每个 public 资源响应时还会校验其 size/SHA。 | `service-worker/sw.ts:69-87`；`src/shared/playback-assets.ts:7-15` | 不宜把同一次准备各层校验的成本只归因给一次 SHA 调用。 |

## 建议一：把原文字节存储与离线使用资格分开

建议保持当前离线语义，抽出更窄的“带归属与修订的完整原文存储”。联网已成功授权时，它不依赖主 PDF 是否已下载、不依赖整包离线就绪；离线使用仍由原来的组合门槛认证。这样不会因缺少可离线 PDF 或公共包而放弃已经存在的 XML 文件，也不会为了查一份 XML 串行审计整份 PDF 与公共包。

建议接口轮廓（示意，不是需要直接复制的实现）：

```ts
// 私有构造，调用者不能从本地目录或传入的 source 伪造。
type AuthorizedMusicXml = {
  source: PlaybackSource;
  fresh: ScoreAttachment;
  assertCurrent(): Promise<void>;
  // 包含本次开谱的 navigation/session、logout/denial/cleanup 生命周期。
};

authorizeMusicXml(source, signal): Promise<AuthorizedMusicXml>;
readStoredMusicXml(access, signal): Promise<RawHit | null>;
readOfflineEligibleMusicXml(source, signal): Promise<RawHit | null>;
resolveMusicXmlSource(source, signal): Promise<ResolvedMusicXml>;
```

`resolveMusicXmlSource` 作为唯一来源选择入口，承担以下顺序：

1. 捕获本次开谱与写入的生命周期；发起一次 metadata 请求，使用当前会话鉴权。核对 id/scoreId/kind/revision/size/非回收站，成功后生成本次开谱有效的 access。更新或不匹配保持明确失败，绝不选择旧修订。
2. 成功联网授权后，依次选择匹配的内存 artifact、匹配的持久原文、原文 HTTP 请求。前两者都只能使用这个当前 access。持久读需核对 owner/drive/score/attachment/revision、size/SHA，读取结束再核对 lifecycle；读取失败或副本损坏作为缓存未命中处理，允许网络路径继续。
3. 给本地 Blob 读取一个有界等待：不能用“本地先读”让失常存储阻断快网络。具体预算取实际设备 Blob 读取分位数，再记录回退原因；开始网络后，迟到的本地读不能替换已经选中的来源。
4. 原文 HTTP 请求锁定预期 revision，并核对响应的 `X-Attachment-Revision`（当前服务端已支持 `?revision=` 与该响应头，见 `worker/attachments/routes.ts:120-128`）。静态代码显示自动生成练习版可以原附件身份更新字节和 revision（`worker/attachments/storage.ts:75-78,114-119`），所以不应假设 XML 永远不可变；这项一致性约束应与 source resolver 一起完成。当前客户端仅给 Markdown URL 加 revision，XML 请求未锁定修订；这是需要覆盖的并发竞态，尚未做并发网络复现。
5. 网络错误/5xx 进入 `readOfflineEligibleMusicXml`，保留已验证 retained-score authority、目录、当前完整 shell/public bundle、原文校验。401/403/404 撤权并清理，schema 错误、revision 不匹配等不走旧内容回退。
6. 返回的 bytes 可以立即进入播放器；原文持久化与离线准备在前台可用之后完成。原文写入事务仍要检查 captured cleanup/denial/session/logout fences，不能因拆分而让退出后的任务重新保存文件。

这里的 `assertCurrent()` 不能只看 `navigator.onLine`，也不能把当前本机 owner 等同于云端能力。它验证的是本次成功权限读取仍属于正在使用的生命周期。附件的 focus 复核不应以旧成功 token 跳过。

同次 mount metadata 的两次读取可做 single-flight：复用仍在进行、同 owner/effective session/target/generation 的 Promise；结束后移除。取消某个消费者不必伤及仍有效的另一个消费者，但最后一个消费者退出要取消，迟到拒绝只影响其所属 generation。不要建立跨次开谱的“最近授权所以直接播放”缓存。

### 兼容与回退

- 沿用当前 `offline-musicxml` 命名空间与 `{ sha256 } + blob` 记录；无需 upgrade Dexie version，也不要求给所有旧记录批量重写。
- 可以增加可选字段，例如 record format、已知长度或算法版本；旧记录仍按 size/SHA 验证读取。新字段缺失不删除现有数据。将来若服务端提供内容版本/hash，也先做可选字段并保留旧客户端路径。
- 继续使用 attachment revision 作精确 key。当前 binary 的路径不携带 revision，metadata 列表也不暴露内容 SHA；不要凭名字、相同字节长度或作品名去重不同用户的受保护 XML。见 `src/client/score-library/attachments/api.ts:5-17`、`src/shared/attachments.ts:34-40`。
- 本期无需为重命名优化引入 content ID；当前重命名也增加 revision（`worker/attachments/routes.ts:139-140`），保守失效是正确性的可接受成本。若未来细分 metadata revision/content identity，需独立设计 API/旧客户端兼容。

## 建议二：prepared 由“固定五分钟”改为明确的活跃与闲置生命周期

建议先与引擎优化统一 artifact 责任，再调整缓存生命周期。否则只扩大当前 XML 缓存会提升命中率，却仍保留重复的主线程归一化、Score 导入和 MIDI 生成。

- 活跃练习持有自己的 artifact lease；活跃对象不会因缓存固定时钟过期而在结束练习时立刻消失。lease 释放时才进入闲置 LRU。所有新练习状态仍从头初始化，不保存位置、速度、混音或声部关注。
- 闲置 artifact 采用容量约束加闲置时间淘汰。不要预先承诺“十首”“三十分钟”作为最终值。先测代表性长短谱的实际峰值工作集、保留增量、克隆/恢复成本、换谱累积与退出回收，再定预算。需要同时约束“当前会话峰值 + 新 artifact 构建峰值 + 闲置 artifact”，仅限制缓存自身不够。
- 扩展 size 计量：原文、归一化 XML、元数据、序列化模型/索引/MIDI 的 ArrayBuffer 均要计入；对象图堆开销用实测校准。当前 `entry.bytes.byteLength + prepared.bytes.byteLength` 只能作为下界。
- 与引擎方约定 artifact schema/version，涵盖 player/native/预处理算法版本与影响导入的 settings。旧 artifact 不匹配就重建，不能作为新模型直接使用。内存内也不能把会被 render/mix/seek 改写的同一个 alphaTab Score 实例交给多个新会话。
- 默认保留更紧凑的不可变 artifact，必要时每次恢复独立模型。完整 Score 图或声音引擎池另行测收益；本方案不建议把可变 renderer、AudioContext、synth 当作跨谱缓存直接常驻。
- owner/effective session、退出登录、已确认失权、attachment revision、navigation reset 等失效条件仍清除相应条目并拒绝迟到保存。不要跨用户按内容 hash 共享受保护 prepared 对象。刷新或 OS 回收后可以失去内存缓存，用户数据仍在持久原文中。

## 建议三：公共包跨发布先复制已验证的相同字节

优先保持 build-specific URL/cache 与既有 shell GC 协议：准备新 build 的缺失资源时，先在已知 public playback 缓存中找 size/SHA 相同的候选，按**目标 manifest** 和安全 MIME 检查 Response，复制到当前 build 自己的地址；没有合格候选才下载。SHA 相同才可复用，文件名相同不够。捕获到的 Response 可被完整验证再写入，即使旧包随后退休，也不依赖旧 cache 继续存在。

这复用的是相同的公共字节，不共享旧 build 的 readiness 标记或 cache ownership。新包仍需拥有完整匹配清单，旧客户端继续使用自己的包。可参考主 shell 已有 `obtain` 的“复制响应、保留新 owner bookkeeping”方式（`service-worker/shell-runtime.ts:102-117`），但播放器目标 URL 含 build ID，不能只按同 URL 查找；需要按新 manifest 的 digest 映射候选并验证。

这能减少“小更新却重取同一个字体/音色”的流量与准备成本，不能省掉新 synth 解析 SF2 的时间，也不能解决模型导入与排版。不要把预计节省流量等同于首屏收益。

本期不推荐新的全局 content-addressed cache/refcount：它会牵动旧 worker、shell 引用与公共包回收，且与 ADR-0004 明确的 build-scoped font/soundfont 规则需要重新决策。先复制安全、易回退。未来若磁盘重复占用确实成为主要问题，再单独论证稳定内容 URL 和保留/回收协议。

## 建议四：后台离线准备避免与首屏抢工作，但保持完整认证

当前后台 effect 与 `createPlayerSession` 几乎同时开始（`musicxml-player.tsx:62-85`）。它不是播放器创建的 await，仍可能在手机上竞争存储、CPU 和 worker。先添加对应计时/任务标识，测主线程长任务、Blob/SHA 字节量、公共包检查与首屏/ready 重叠，再决定收益；不要仅凭代码路径断言它是主要瓶颈。

建议调度：

1. 前台优先完成 source、模型、首屏和可播放。自动离线任务到首屏与可播放后再开始；若它们失败，自动任务不应自顾自继续大量计算。显式重试离线准备可以主动开始并显示原有准备状态。
2. 同一 tab/build 合并 public bundle 准备；同一 owner/session/attachment/revision 合并原文保存/离线认证。按照消费者持有任务，避免快速关开每次创建一套重复准备。
3. 同一个准备任务内，共享已经捕获的 Response/bytes 的验证结果，减少“齐包三轮逐项 SHA”的重复。不同时间重新从磁盘拿到的 Response 不能继承旧校验；缓存驱逐、损坏替换、资源写入、worker/controller/build 改变都要重新检查。
4. 最终“可离线”仍要求匹配壳、全部所需资源、原文与原有离线权限验证；不以“用户看过”或“上次 ready”永久代替校验。可以把内部 API 改成返回本任务的 `VerifiedBundleSnapshot` 并由最终认证消费它，避免仅为返回 boolean 而再读相同不可变响应；snapshot 的作用域不能超出这次任务或被当作未来磁盘内容的永久凭证。
5. 后台任务支持低并发、取消和退避；先使用已有可中止任务机制和实测时机，不依赖移动端一定支持 idle callback/内存压力事件。页面退出/身份切换/清理文件后仍按 fence 阻止迟到写入；不承诺关闭 app 后继续完成。

在没有新完整性策略证明前，不建议删除磁盘读取的 SHA 校验。减少同一任务对相同已捕获字节的重复工作，与把所有未来读取都视为已校验，是两个不同改动。

## 验证与分期

建议先将前台引擎去重、原文 resolver、后台调度分别可回退地交付；公共包跨 build 复制放在稍后。每一项都与相同真实谱、相同 build、冷/热状态对照测量，不把多项可能重叠的节省相加。

性能场景至少包括：首次安装后首次 XML、同谱立即重开、练习超过原 TTL 后重开、A→B→A、PWA 冷启动、已存原文但未完成离线 PDF/公共包、稳定网络/弱网络/离线。实体 iPhone/iPad 安装版和 Android 安装版分别记录 metadata、source、prepare、Score、MIDI、音色、首屏、可播放与首次听到声音。桌面节流只做可重复的回归比较，不能替代手机验收。

正确性测试重点：

- 已授权同修订从本地复用；无持久副本、旧格式、size/hash 错、读取挂起都能回退联网；新来源已经选定后忽略迟到本地结果。
- mount 只发一次在途 metadata；focus 重新请求；401/403/404、修订不匹配或 schema 错误绝不回退旧 bytes；metadata 后更新自动生成练习版时，原文请求不能把新内容保存在旧 revision key 下。
- metadata await、Blob/SHA await、worker 计算、写事务前后分别插入切用户、退出、离谱、撤权、清文件，均不得显示他人内容或重新写回已清理文件；换回同用户仍拒绝旧 session 任务。
- 长时间练习再结束后能复用 artifact，有限内存下按实际成本淘汰；大谱不造成累积未释放，结束会话播放状态重置。
- public 资源跨 build 复制只接受目标 manifest 的 hash/size，MIME 按目标类型允许列表校验；相同名不同内容拒绝；部分包/损坏/配额失败保留既有可用包；旧 worker/旧窗口仍可使用自身资源，既有 shell GC 不受影响。
- 后台准备失败不阻断已可用播放器、不提前显示可离线；同任务合并与消费者取消不导致失权任务写入。

尚未解决的量化问题：实体移动端的 metadata RTT、持久 Blob 读取与 SHA 分位数、后台资源审计占比、当前 prepared metadata 堆内存和更完整 artifact 的增量内存/恢复成本、设备在锁屏/回前台后的资源保留情况。这些未知应进入第一轮基线，不应以固定 TTL、容量或收益百分比代替。
