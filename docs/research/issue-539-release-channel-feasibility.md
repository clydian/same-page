# #539：前端资源托管与通道路由可行性

研究日期：2026-10-22。代码基线 `685a0eaf0b95a05f90ea38e927889033afce69ab`。
只读源代码／官方规范，加隔离的 localhost 浏览器及本地 workerd 探针；未实施产品功能、未连接生产、未访问用户数据。

## 结论与选定路线

方案可进入实现准备。采用 **同一正式域名、同一根 scope 的 `/sw.js`、设备通道 Cookie、R2 不可变前端产物、D1 通道指针**。继续运行一套兼容后端。不采用两个子域、不按请求随机灰度、不依赖 Cloudflare 已部署版本的历史资源作为产品版本库。

数据库结论见 [独立实证](issue-539-database-channel-feasibility.md)。数据库补充探针在 Chromium 通过 Blob 往返，WebKit 的普通记录与 schema 行为也验证成功，但该 WebKit 运行时的 ephemeral context 原生 Blob 首写失败；后续全新临时 persistent context 的原生及实际数据库 Blob 均通过。真实 Safari／iOS 产品实机回切仍为上线门槛，详见独立数据库研究补充。

本次只证明所需平台原语和路由机制可行；实际应用改造、实际 stable/candidate 矩阵、实机验收仍是 #539 的实施工作。

## 仓库事实

- `wrangler.jsonc` 将 Worker、`ASSETS` 与当前静态目录绑定；当前 `run_worker_first` 只含 API 和部分资源目录，不覆盖全部 HTML／SW。仅新增 Hono 路由不会让所有入口经过通道解析。
- `vite.config.ts` 当前未设置资源 base，安装 `start_url=/`，SW 由 `virtual:pwa-register/react` 注册；`service-worker/sw.ts` 和 `shell-runtime.ts` 将根 `/` 作为 canonical shell，用固定 buildId 和 manifest SHA-256 校验。
- `ShellRuntime.obtain()` 当前直接 fetch manifest entry；对于 canonical `/`，若通道或最新版本改变，请求可能取得另一份 HTML。必须把网络获取地址与 canonical cache key 分开。
- `scripts/release-artifact.mjs` 已封存全部 dist 文件及 migration 的摘要，`build.json` 仅记录脚本；前端完整上传目录应基于 `release.json` 中 `dist/client/` 的完整清单，不能仅上传 `build.json.scripts` 或 SW precache。
- `scripts/playback-assets.ts`、`src/shared/playback-assets.ts`、`src/shared/pdfjs-assets.ts`、各 public 路径和 `public/update-coordination.js` 需要检查。播放器有明确的根路径重写与 manifest URL 正则；只设置 Vite base 不能覆盖这些手写 URL。
- 当前本地已有 dist 为旧 build `bbd51e0ab5a98dd04766d7b5f72c91f228c26bc7`，共 240 文件、34,751,381 字节（33.14 MiB）。仅用于估算单份产物量级，**不是本次代码构建、不是线上发布证明**。

## 托管与发布顺序（设计，待实施）

1. 新建专用私有前端发布 R2 bucket，不与用户谱面、APK 或其生命周期规则混放。用户只经同域 Worker 访问白名单前端资源；禁止上传 Worker bundle、锁文件、环境配置或 migration。
2. 使用 `/_releases/<buildId>/<path>` 和对应 `releases/<buildId>/<path>`。一期保留现有 full source SHA 作为 buildId，必须规定 **一个 buildId 只允许一份封存产物**；先 first-write 条件创建 buildId 归属记录，绑定完整产物清单摘要，再上传资源；sealed/ready 清单自身也 first-write 且必须匹配该摘要。重复上传仅接受同摘要；并发不同产物必须明确失败，不能各上传部分后覆盖 seal。同 SHA 重跑产生不同时间戳／文件字节时拒绝覆盖，复用原始产物，或使用新 commit 重新发布。不能再认为相同 SHA 一定字节相同。
3. Vite `base=/_releases/<buildId>/` 处理构建资源；应用路由仍保持 `/`，不把 React Router basename 改为发布目录。手写资源 URL、worker/worklet、播放器 manifest、PDF decoder、图标及第三方来源下载需要显式版本化，并调整 manifest 解析／白名单。
4. 上传完整 dist/client 白名单、校验所有摘要及 MIME 后，最后写 sealed/ready 清单。R2 对单对象提供强一致性，但没有跨对象提交；**未封存目录不构成可用发布**。入口只能引用已完成封存且线上验证合格的版本。
5. 为候选生成实际 stable/candidate 兼容性证据；必要 D1 expand migration 和后端发布仍走既有生产锁。用候选不可变 URL 做线上逐资源核查，分别核对后端 SHA 和前端 SHA。当前验证脚本把两者等同的假设需要改造。
6. 验证全部成功后，以 D1 单行条件更新推进 beta，包含期望旧 revision 和合法 ready 版本。后台 stable 提升同样 CAS，并与审计、幂等请求记录作为一次原子数据库操作实现；不重新构建或迁移。R2 上传和 D1 发布无法跨系统事务化，因此严格「先资源 ready，后指针」；失败只留未引用产物，不推进目标。
7. 一期 **不启用发布桶 TTL 或自动 GC**，保留所有已准入前端产物，避免把长期打开／离线恢复的资源错误退休。容量可观测；引用感知回收与退出支持策略另立任务，在明确安全规则前不可偷偷删旧版。这是初期工程取舍，不是永久保留承诺。

R2 onlyIf 可实现条件创建，API 在条件失败时返回 null。[R2 API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)。绑定访问的强一致性不代表 CDN 缓存即时失效。[R2 consistency](https://developers.cloudflare.com/r2/reference/consistency/)。Vite base 会处理 JS/CSS/HTML 的构建引用，动态拼接 URL 仍需显式使用 BASE_URL。[Vite build](https://vite.dev/guide/build#public-base-path)。这些平台事实支持上述实现路径；整个部署方案本身仍是设计推断。

## 路由、缓存与切换契约（设计，待实施）

| 地址 | 行为 |
| --- | --- |
| `/api/*`（含 auth/OAuth callback） | 始终业务后端，禁止应用壳回退；通道不授予权限 |
| `/.well-known/*`、APK 下载等 | 保持原协议边界；不得被 SPA 接管 |
| `/_releases/<id>/*` | 固定资源与 MIME；200 可 public immutable；缺失或未封存资源返回 no-store 404，禁止 HTML fallback；不受通道 Cookie 影响 |
| `/` 与有效 SPA 深链 | 冷访问按设备通道解析 sealed 目标，返回该版 HTML，private no-store；有 active SW 时沿用已验证运行壳直到安全交接 |
| `/sw.js` | 固定注册 URL 和根 scope，直接返回所选通道目标的 JS 字节，禁止重定向；private no-store，updateViaCache=none |
| `/api/client-release`（拟议） | 返回设备选择、意图标识、通道配置 revision、目标、兼容契约与封存状态；no-store，通道权威查询走主库一致性路径 |
| 根 `/build.json`、`/manifest.webmanifest` 等 legacy 入口 | 兼容旧客户端，按选择返回正确目标／桥接基线，private no-store；新检查使用不可变前端身份和独立后端身份 |

所有应用入口须先过 Worker，一期优先 `assets.run_worker_first=true`，取消自动 SPA 对缺资源的兜底，显式保留 API、静态与安装端点。之后如需优化成本再做准确路由分流。Worker 从 R2 返回的资源必须显式附加原 `_headers` 的安全响应头，不能假定文件规则会自动应用。[Worker routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)、[Headers](https://developers.cloudflare.com/workers/static-assets/headers/)。

设备偏好用根路径 Secure、HttpOnly、SameSite=Lax、Max-Age=31536000 的持久 Cookie（确认成功时续期），作为冷启动与 SW 更新请求的同一通道提示；UI 经同域 POST 设置，并 GET 读回确认。不在账户里同步，不改变认证 Cookie。Cookie 缺失／无效／过期默认 stable；写入被阻止时不能假装进入 beta。跨窗口选择通过 Web Locks 串行化，带可持久化意图标识；不支持安全串行化时明确暂缓切换。Cookie／目标查询不使用 CDN cache 或 replica 的陈旧读取。公开不可变资源可以单独缓存；初期也可以只采用浏览器 immutable 而不启用 Cache API。

Cookie 与本机意图许可的双写不伪装成原子事务：先持久化 pending 意图，POST 设置 Cookie，GET 读回匹配的通道／意图／目标 revision，再以独立壳 registry 单记录写提交确认回执。在线权威是 Cookie 经服务端一致性查询的结果；本机回执仅授权离线恢复最后确认的完整运行壳，不得在 Cookie 过期后自动恢复 beta。中断后先在线读回协调，不靠旧本机偏好覆盖 Cookie。HttpOnly Cookie 不能由离线 SW 读取；无网络时不凭 pending 候选授予新显示许可，歧义给恢复页并保留业务数据。

SW 安装／修复 canonical `/` 时实际从自身 `/_releases/<id>/index.html` 获取，仍在私有 release cache 的 canonical `/` 键保存并校验，不能 fetch 变化中的 `/`。其它资源一律按 manifest 固定 URL 获取。manifest 本身版本化，但安装身份、start_url 和 scope 保持根 `/`，避免生成两个桌面应用或破坏现有 App Links。W3C 将安装身份和 manifest 地址分别定义；真实 iOS／TWA 行为仍要实机验证。[Web App Manifest](https://w3c.github.io/manifest/)。

保留当前两轮跨窗口安全确认；**安装完成到 skipWaiting 前重新校验意图和目标 revision，activate 和首次导航也检查发布许可**。浏览器在没有旧受控 clients 时可自动激活 waiting worker，按钮保护不够。错通道／已过时候选不能因此成为可显示壳；使用同一意图下已许可的完整运行壳或恢复页，并准备正确目标。失败不清业务数据、不把 beta 当 stable 的隐式 fallback、不无限重载。正在编辑的旧页仍按现有安全规则保留运行身份；UI 需区分所选通道、实际运行版本和准备目标。

SW script 的请求采用 same-origin credentials，更新获取绕过 SW 自身拦截，重定向不可用；固定根 URL 避免版本目录 scope 扩展问题。[Service Worker Update algorithm](https://w3c.github.io/ServiceWorker/#update-algorithm)。

首次上线先把通道兼容桥接版同时设为 stable/beta，并保留旧版已承诺地址；旧 `/sw.js` 只能获得稳定桥接版。确认 legacy active/waiting 路径后才发布第一个有差异 beta。显式 opt-in 的 beta Cookie 只由桥接后入口生成；旧版本与后台冻结页仍按现有安全交接处理，不假定已全部更新。

## 实际探针与证据边界

### 浏览器

localhost 隔离 HTTP origin、每次新 browser context；合成 A/B/C 三套固定 HTML/JS，根 `/sw.js` 根据 Cookie 返回对应 worker，安装时 SRI 校验前缀资源。没有启动产品页面，也没有完整移植 ADR-0020 的安全状态机。

Chromium 151.0.7922.34 和 Playwright WebKit 26.5 均通过：

- 无 Cookie 的直接深链加载 A；根 scope 注册成功；浏览器 SW script 请求携带所选 Cookie，Cookie 被确认为持久有效期。
- beta B 安装后旧页面仍运行 A；明确请求后 B 接管；再选择 stable，A 再次安装并接管。
- B 待激活期间选择改回 stable，向原 B 候选请求激活返回 stale。
- beta 推进到 C 后新 context 仍加载 A，A 的固定脚本可取；未知资源返回 404，未知 API 保持 JSON 404。

最初探针只看 waiting state，观察到自动更新可能让等待引用被替换，后改为按 build 身份抓取候选并验证实际 controller。**这也支持产品不能只检查 waiting 存在，必须核对目标身份的结论**。跨窗口、自动无 client 激活保护、配额、实际应用完整资源与实机没有在此探针中通过，仍是实施验收项。

### 本地 Cloudflare 原语

当前 node_modules Miniflare 5.20261001.0-alpha，使用其 `convertV4MiniflareOptions` 适配已安装 API，完全本地 workerd，无远程绑定。R2 条件首次写成功、同 key 不同内容覆盖返回 null、原 A 字节保留；D1 使用条件 UPDATE 和同语句触发审计，B/revision1 提升被 C/revision2 拒绝，精确 C 提升成功且只产生一条审计。D1 meta.changes 包括触发器写入，不能以必须等于 1 判断成功；实际实现用受影响目标行或 RETURNING 与幂等记录确认。

探针只验证条件写入和 CAS 基础能力，未验证完整生产发布流水线、IAM、线上 CDN rules 或独立发布权限配置。现有单 Worker+R2+D1 已具备所需能力；新桶、绑定与权限属于后续实施，不在本次创建。

## Ready-for-agent 的含义

三项技术未知均已有具体可行路线和可复现基础证据，可从 needs-triage 转入 ready-for-agent。实施者无需再选择多域／多后端架构，但必须完成产品改造、兼容基线绑定、端到端矩阵及实机证据，才能上线；不能将本研究当作已实现或已获生产部署授权。

## 可复现脚本与输出

从仓库根目录把以下代码块分别保存为任意系统临时目录的 `browser-routing.cjs` 与 `storage.cjs`，用 `node <绝对临时路径>` 运行。它们通过当前工作目录解析仓库依赖；浏览器需已安装，未安装时只报告缺失，不使用真实 profile。存储脚本没有 persist 配置，退出 dispose；浏览器脚本 finally 关闭 context/browser/server。

### browser-routing.cjs

```javascript
const {createServer}=require('node:http');
const {createHash}=require('node:crypto');
const {createRequire}=require('node:module');
const assert=require('node:assert/strict');
const req=createRequire(process.cwd()+'/package.json');
const {chromium,webkit}=req('playwright');
const sri=x=>'sha256-'+createHash('sha256').update(x).digest('base64');
let stable='A',beta='B'; const requests=[];
const objects=new Map();
for(const id of ['A','B','C']) {
 const script=`window.actualRelease=${JSON.stringify(id)}`;
 const html=`<!doctype html><title>${id}</title><script src="/_releases/${id}/app.js"></script>`;
 objects.set(`/_releases/${id}/index.html`,[html,'text/html']);
 objects.set(`/_releases/${id}/app.js`,[script,'text/javascript']);
}
function worker(id){
const entries=[...objects].filter(([p])=>p.startsWith(`/_releases/${id}/`)).map(([url,[body]])=>({url,integrity:sri(body)}));
return `const id=${JSON.stringify(id)}; const entries=${JSON.stringify(entries)};
self.addEventListener('install',e=>e.waitUntil((async()=>{const c=await caches.open('probe:'+id);for(const x of entries){const r=await fetch(x.url,{cache:'no-store',integrity:x.integrity,redirect:'error'});if(!r.ok)throw Error('missing');await c.put(x.url,r)}})()));
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(u.pathname.startsWith('/api/'))return;if(e.request.mode==='navigate')e.respondWith(caches.open('probe:'+id).then(c=>c.match('/_releases/'+id+'/index.html')))});
self.addEventListener('message',e=>{if(e.data==='identity'){e.ports[0].postMessage(id);return}if(e.data!=='apply')return;e.waitUntil((async()=>{const r=await fetch('/api/target',{cache:'no-store'});const t=await r.json();if(t.id!==id){e.ports[0].postMessage('stale');return}await self.skipWaiting();e.ports[0].postMessage('ok')})())});`;
}
const server=createServer((r,s)=>{
 const channel=(r.headers.cookie||'').includes('channel=beta')?'beta':'stable';
 const id=channel==='beta'?beta:stable;
 const pathname=new URL(r.url,'http://localhost').pathname;
 requests.push({path:pathname,channel,id});
 const end=(body,type='application/json',code=200,headers={})=>{s.writeHead(code,{'Content-Type':type,'Cache-Control':'private, no-store',...headers});s.end(body)};
 if(pathname==='/api/select'){const x=new URL(r.url,'http://localhost').searchParams.get('channel');return end('{}','application/json',200,{'Set-Cookie':`channel=${x==='beta'?'beta':'stable'}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`})}
 if(pathname==='/api/target')return end(JSON.stringify({id}));
 if(pathname==='/sw.js')return end(worker(id),'text/javascript',200,{'Service-Worker-Allowed':'/'});
 if(objects.has(pathname)){const [body,type]=objects.get(pathname);return end(body,type,200,{'Cache-Control':'public, max-age=31536000, immutable'})}
 if(pathname.startsWith('/_releases/'))return end('missing','text/plain',404);
 if(pathname.startsWith('/api/'))return end('{"error":"not_found"}','application/json',404);
 return end(objects.get(`/_releases/${id}/index.html`)[0],'text/html');
});
(async()=>{
await new Promise(r=>server.listen(0,'127.0.0.1',r)); const origin=`http://127.0.0.1:${server.address().port}`;
const evidence=[];
try{
for(const [name,type]of [['chromium',chromium],['webkit',webkit]]){
 beta='B';const browser=await type.launch({headless:true});
 try{const ctx=await browser.newContext();const page=await ctx.newPage();await page.goto(origin+'/choirs/deep-link');
 await page.waitForFunction(()=>window.actualRelease==='A');
 await page.evaluate(async()=>{await navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'});await navigator.serviceWorker.ready});
 await page.reload();await page.waitForFunction(()=>navigator.serviceWorker.controller);
 const select=channel=>page.evaluate(async channel=>{await fetch('/api/select?channel='+channel,{method:'POST'});const r=await navigator.serviceWorker.getRegistration();await r.update();return true},channel);
 const candidate=expected=>page.evaluate(async expected=>{const until=Date.now()+15000;while(Date.now()<until){const r=await navigator.serviceWorker.getRegistration();const w=r.waiting;if(w){const id=await new Promise(resolve=>{const c=new MessageChannel();c.port1.onmessage=e=>resolve(e.data);w.postMessage('identity',[c.port2])});if(id===expected){window.probeCandidate=w;return true}}await new Promise(resolve=>setTimeout(resolve,25))}throw Error('candidate timeout '+expected)},expected);
 const apply=()=>page.evaluate(async()=>{return new Promise(resolve=>{const c=new MessageChannel();c.port1.onmessage=e=>resolve(e.data);window.probeCandidate.postMessage('apply',[c.port2])})});
 const active=expected=>page.waitForFunction(async expected=>{const c=navigator.serviceWorker.controller;if(!c)return false;return await new Promise(resolve=>{const m=new MessageChannel();m.port1.onmessage=e=>resolve(e.data===expected);c.postMessage('identity',[m.port2])})},expected);
 await select('beta');assert.ok((await ctx.cookies()).find(c=>c.name==='channel').expires>Date.now()/1000+86400);await candidate('B');assert.equal(await page.evaluate(()=>window.actualRelease),'A');
 assert.equal(await apply(),'ok');await active('B');
 await page.reload();await page.waitForFunction(()=>window.actualRelease==='B');
 await select('stable');await candidate('A');assert.equal(await apply(),'ok');await active('A');
 await page.reload();await page.waitForFunction(()=>window.actualRelease==='A');
 await select('beta');await candidate('B');await page.evaluate(()=>fetch('/api/select?channel=stable',{method:'POST'}));assert.equal(await apply(),'stale');
 beta='C'; const cold=await browser.newContext();const p=await cold.newPage();await p.goto(origin+'/choirs/cold');await p.waitForFunction(()=>window.actualRelease==='A');
 assert.equal(await p.evaluate(async()=>{const r=await fetch('/_releases/A/app.js');return r.status}),200);
 assert.equal(await p.evaluate(async()=>{const r=await fetch('/_releases/missing/app.js');return r.status}),404);
 assert.equal(await p.evaluate(async()=>{const r=await fetch('/api/missing');return r.headers.get('content-type')}),'application/json');
 await cold.close();await ctx.close();evidence.push({browser:name,version:browser.version(),coldStable:true,persistentPreference:true,rootScopeCookieSwUpdate:true,betaThenStable:true,pendingDoesNotReplaceRunning:true,staleCandidateRejected:true,coldStableAfterNewBeta:true,missingAsset404:true,apiExcluded:true});
 }finally{await browser.close()}
}
console.log(JSON.stringify({evidence,swRequests:requests.filter(x=>x.path==='/sw.js')},null,2));
}finally{await new Promise(r=>server.close(r))}
})().catch(e=>{console.error(e);process.exitCode=1});

```

### browser-routing-output.json

```json
{
  "evidence": [
    {
      "browser": "chromium",
      "version": "151.0.7922.34",
      "coldStable": true,
      "persistentPreference": true,
      "rootScopeCookieSwUpdate": true,
      "betaThenStable": true,
      "pendingDoesNotReplaceRunning": true,
      "staleCandidateRejected": true,
      "coldStableAfterNewBeta": true,
      "missingAsset404": true,
      "apiExcluded": true
    },
    {
      "browser": "webkit",
      "version": "26.5",
      "coldStable": true,
      "persistentPreference": true,
      "rootScopeCookieSwUpdate": true,
      "betaThenStable": true,
      "pendingDoesNotReplaceRunning": true,
      "staleCandidateRejected": true,
      "coldStableAfterNewBeta": true,
      "missingAsset404": true,
      "apiExcluded": true
    }
  ],
  "swRequests": [
    {
      "path": "/sw.js",
      "channel": "stable",
      "id": "A"
    },
    {
      "path": "/sw.js",
      "channel": "beta",
      "id": "B"
    },
    {
      "path": "/sw.js",
      "channel": "stable",
      "id": "A"
    },
    {
      "path": "/sw.js",
      "channel": "beta",
      "id": "B"
    },
    {
      "path": "/sw.js",
      "channel": "stable",
      "id": "A"
    },
    {
      "path": "/sw.js",
      "channel": "beta",
      "id": "B"
    },
    {
      "path": "/sw.js",
      "channel": "stable",
      "id": "A"
    },
    {
      "path": "/sw.js",
      "channel": "beta",
      "id": "B"
    }
  ]
}

```

### storage.cjs

```javascript
const {createRequire}=require('node:module');
const req=createRequire(process.cwd()+'/package.json');
const {Miniflare,convertV4MiniflareOptions}=req('miniflare');
const assert=require('node:assert/strict');
(async()=>{const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'probe',modules:true,script:'export default {fetch(){return new Response("probe")}}',r2Buckets:['RELEASES'],d1Databases:['DB']}]}));try{
const b=await mf.getR2Bucket('RELEASES');
const first=await b.put('releases/A/app.js','A',{onlyIf:{etagDoesNotMatch:'*'}});assert.ok(first);
const overwrite=await b.put('releases/A/app.js','different',{onlyIf:{etagDoesNotMatch:'*'}});assert.equal(overwrite,null);assert.equal(await(await b.get('releases/A/app.js')).text(),'A');
const db=await mf.getD1Database('DB');
await db.exec('CREATE TABLE pointers (id INTEGER PRIMARY KEY, stable TEXT, beta TEXT, revision INTEGER); CREATE TABLE audit (revision INTEGER, stable TEXT); INSERT INTO pointers VALUES (1, \'A\', \'B\', 1); CREATE TRIGGER log_promotion AFTER UPDATE OF stable ON pointers WHEN NEW.stable != OLD.stable BEGIN INSERT INTO audit VALUES (NEW.revision, NEW.stable); END;');
const promote=expected=>db.prepare('UPDATE pointers SET stable=beta,revision=revision+1 WHERE id=1 AND beta=? AND revision=?').bind(expected,1).run();
await db.prepare('UPDATE pointers SET beta=?,revision=revision+1 WHERE id=1').bind('C').run();
assert.equal((await promote('B')).meta.changes,0);
assert.ok((await db.prepare('UPDATE pointers SET stable=beta,revision=revision+1 WHERE id=1 AND beta=? AND revision=?').bind('C',2).run()).meta.changes>0);
assert.deepEqual(await db.prepare('SELECT stable,beta,revision FROM pointers').first(),{stable:'C',beta:'C',revision:3});
const audit=await db.prepare('SELECT * FROM audit').all();assert.equal(audit.results.length,1);
console.log(JSON.stringify({runtime:'local Miniflare/workerd',conditionalR2Put:{initialCreated:true,overwriteRejected:true,oldBytesPreserved:true},d1Promotion:{staleRejected:true,expectedTargetPromoted:true,auditRows:audit.results}},null,2));
}finally{await mf.dispose()}})().catch(e=>{console.error(e);process.exitCode=1});

```

### storage-output.json

```json
{
  "runtime": "local Miniflare/workerd",
  "conditionalR2Put": {
    "initialCreated": true,
    "overwriteRejected": true,
    "oldBytesPreserved": true
  },
  "d1Promotion": {
    "staleRejected": true,
    "expectedTargetPromoted": true,
    "auditRows": [
      {
        "revision": 3,
        "stable": "C"
      }
    ]
  }
}

```
