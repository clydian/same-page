# #539：稳定版／测试版本机数据库回切可行性

研究日期：2026-10-22。代码基线：`685a0eaf0b95a05f90ea38e927889033afce69ab`。
范围：只读审查、官方资料及隔离的内存数据库探针；没有修改产品代码、连接生产或访问用户浏览器数据。

## 实施期间补充：WebKit Blob 已定位并通过

同日进一步隔离确认：本机 Playwright WebKit 26.5 的 `browser.newContext()` ephemeral 模式原生 IndexedDB Blob 首写失败；使用 `launchPersistentContext(全新系统临时目录, {headless:true})`，原生 PDF Blob 保存／关闭／重开读取以及真实 SamePageDatabase 的 Blob 往返均通过。profile 在 finally 关闭并删除，没有用户数据。正式产物矩阵采用这一隔离持久 profile，见 `scripts/verify-release-storage.mjs`；真实 Safari/iOS 产品实机验收仍须保留。下文最初失败记录是调查历史，不再是未定位原因。

## 结论

**可行，但回切安全是每个发布产物之间必须验证的协议，不能从“可以打开数据库”推导。** 第一阶段让两个通道共用现有本机工作空间和数据库，不改数据库名，不按通道复制或清空草稿。#539 自身无需修改业务 schema；其发布通道偏好可沿用已有非业务偏好机制或独立命名键，不能借切换执行清理。

当前安装的 Dexie 4.4.5 **并非数据库版本升高就必然让旧客户端报 VersionError**。官方说明其自 4.0.1-beta.8 起可适配已安装高版本；安装源码先按声明版本打开，收到 VersionError 后不指定版本重试。真实 `SamePageDatabase` 类的探针也证明 v16 新增表后 v15 能打开 native 160。但如果升级删除旧表，v15 还可能自动补回空表、升至 native 161；这绝不等于数据恢复。[官方说明](https://dexie.org/docs/DexieErrors/Dexie.VersionError)、[v4.4.5 源码](https://github.com/dexie/Dexie.js/blob/v4.4.5/src/classes/dexie/dexie-open.ts)。本机对应位置：`node_modules/dexie/dist/dexie.mjs` 的 `dexieOpen`、`verifyInstalledSchema`。

## 已证实的仓库约束

- [`local-database.ts`](../../src/client/platform/local-database.ts) 当前最大声明版本为 15，默认库名 `same-page`。草稿、outbox、冲突、同步游标、离线 PDF／快照、本机工作空间归属共同使用该库。
- 历史升级并非全都双向兼容：v7 清空旧层模型；v9 把 `defaultSlot` 改成 `sharedSlot`；v11 将快照分表且新写入不带旧嵌入快照；v15 删除旧图片包。不能把任意历史壳设为可回切版本，也不能重演已不可逆的数据迁移。
- [`annotations.ts`](../../src/shared/annotations.ts) 的 payload 是 `text/ink/shape` 判别联合。实际 schema 探针确认：未知 kind 被拒绝；已知 kind 的未知可选字段可以通过校验，但 `parse()` 返回值剥离该字段。
- [`sync.ts`](../../src/client/annotations/sync.ts) 用当前响应 schema 解析 pull／push；[`routes.ts`](../../worker/annotations/routes.ts) 用 schema 解析请求，`serializeObject` 也将解析后 payload 返回。故“仅添加可选 JSON 字段”不足以保证保真。
- [`push-request.ts`](../../src/client/annotations/push-request.ts) 传递整个 payload；这不构成端到端未知字段保留保证。`put()` 本来就是整体替换，后续编辑路径必须逐一检查。[Dexie put 语义](https://dexie.org/docs/Table/Table.put())。
- 不加索引的字段本来就不需要声明到 `stores()` 中；“没有 schema version 改动”也不说明业务格式兼容。[Dexie stores 语义](https://dexie.org/docs/Version/Version.stores())。
- [ADR-0004](../adr/0004-allow-verified-offline-access-without-requiring-installation.md) 要求本机归属隔离、离线可编辑及清理边界；[ADR-0009](../adr/0009-use-object-operations-with-d1-optimistic-concurrency.md) 要求 outbox／冲突持久保存；[ADR-0020](../adr/0020-versioned-application-shells.md) 的应用壳切换不迁移业务数据库。本方案遵循这些决策。

## 实测探针

运行环境：Node 24.21.0，Dexie 4.4.5，fake-indexeddb 6.2.5。通过 esbuild 打包**实际的** `SamePageDatabase` 与 `annotationPayloadSchema`，创建 UUID 命名的三个 fake IndexedDB 数据库；结束后删除，仅使用内存。`Blob` 为人工构造的 `test-xml` 字符串。没有启动真实产品页面。

复现命令（从仓库根目录运行；生成物写到系统临时目录）：

```sh
node --input-type=module <<'NODE'
import { build } from 'esbuild';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = await mkdtemp(join(tmpdir(), 'same-page-539-db-'));
const source = `
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { SamePageDatabase } from './src/client/platform/local-database.ts';
import { annotationPayloadSchema } from './src/shared/annotations.ts';
const names = [];
const nameFor = x => {
  const n = 'issue-539-isolated-' + x + '-' + crypto.randomUUID();
  names.push(n); return n;
};
const info = db => ({declared: db.verno, native: db.backendDB().version});
try {
  const name = nameFor('same-version');
  let stable = new SamePageDatabase(name); await stable.open();
  await stable.system.put({key:'probe:stable', value:'retained'}); stable.close();
  let beta = new SamePageDatabase(name); await beta.open();
  await beta.system.put({key:'probe:beta', value:'optional-v1', blob:new Blob(['test-xml'])}); beta.close();
  stable = new SamePageDatabase(name); await stable.open();
  const optional = await stable.system.get('probe:beta');
  console.log('same-schema', JSON.stringify({...info(stable), stable:(await stable.system.get('probe:stable')).value, beta:optional.value, blob:await optional.blob.text()})); stable.close();
  const n2 = nameFor('additive');
  beta = new SamePageDatabase(n2); beta.version(16).stores({betaOnly:'&key'}); await beta.open();
  await beta.system.put({key:'draft', value:'unsynced'});
  await beta.table('betaOnly').put({key:'x', extra:1});
  console.log('beta-additive', JSON.stringify(info(beta))); beta.close();
  stable = new SamePageDatabase(n2); await stable.open();
  console.log('stable-after-additive', JSON.stringify({...info(stable), draft:(await stable.system.get('draft')).value, betaTableExists:stable.backendDB().objectStoreNames.contains('betaOnly')})); stable.close();
  const n3 = nameFor('deleted-store');
  stable = new SamePageDatabase(n3); await stable.open();
  await stable.readingPreferences.put({key:'probe', ownerKey:'user:test', choirId:'test'}); stable.close();
  beta = new SamePageDatabase(n3); beta.version(16).stores({readingPreferences:null}); await beta.open(); beta.close();
  stable = new SamePageDatabase(n3); await stable.open();
  console.log('stable-after-delete', JSON.stringify({...info(stable), preferencesCount:await stable.readingPreferences.count()})); stable.close();
  const payload = {kind:'text', pageNumber:1, x:.2, y:.3, fontScale:.024, text:'draft', betaOnly:'must-preserve'};
  const parsed = annotationPayloadSchema.parse(payload);
  console.log('actual-payload-parser', JSON.stringify({acceptsOptional:annotationPayloadSchema.safeParse(payload).success, preservesOptional:'betaOnly' in parsed, acceptsNewKind:annotationPayloadSchema.safeParse({...payload, kind:'beta-kind'}).success}));
} finally {
  for (const n of names) await Dexie.delete(n);
  console.log('cleanup', names.length + ' isolated in-memory databases deleted');
}
`;
const output = await build({stdin:{contents:source, resolveDir:process.cwd(), sourcefile:'issue-539-probe.ts', loader:'ts'}, bundle:true, platform:'node', format:'esm', write:false});
const filename = join(dir, 'probe.mjs');
await writeFile(filename, output.outputFiles[0].text);
await import(filename);
NODE
```

2026-10-22 实际输出（省略临时绝对路径）：

```text
same-schema {"declared":15,"native":150,"stable":"retained","beta":"optional-v1","blob":"test-xml"}
beta-additive {"declared":16,"native":160}
stable-after-additive {"declared":15,"native":160,"draft":"unsynced","betaTableExists":true}
Dexie SchemaDiff: Schema was extended without increasing the number passed to db.version(). Dexie will add missing parts and increment native version number to workaround this.
stable-after-delete {"declared":15,"native":161,"preferencesCount":0}
actual-payload-parser {"acceptsOptional":true,"preservesOptional":false,"acceptsNewKind":false}
cleanup 3 isolated in-memory databases deleted
```

这证明已安装依赖和当前类在给定条件下的行为。它**没有**证明旧生产产物使用同一 Dexie、任意新增索引／主键／表语义兼容、真实浏览器多连接行为或实际同步协议互通。上述源码行为也意味着不能只按 `db.verno` 判断实际 native schema。没有在此研究中测试用户数据或任何已发布产物的端到端迁移。

另一个独立 fake IndexedDB 探针直接调用原生 API（同样 UUID 命名、结束删除），先创建 native 160，再用 150 打开，实际输出为 `native-lower-version VersionError`。复现：

```sh
node --input-type=module <<'NODE'
import 'fake-indexeddb/auto';
const name = 'issue-539-native-' + crypto.randomUUID();
const db = await new Promise((resolve, reject) => {
  const r = indexedDB.open(name, 160);
  r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
}); db.close();
try {
  await new Promise((resolve, reject) => {
    const r = indexedDB.open(name, 150);
    r.onsuccess = () => { r.result.close(); resolve(); };
    r.onerror = () => reject(r.error);
  });
} catch (error) { console.log('native-lower-version', error.name); }
await new Promise((resolve, reject) => {
  const r = indexedDB.deleteDatabase(name);
  r.onsuccess = resolve; r.onerror = () => reject(r.error);
});
console.log('cleanup isolated native in-memory database deleted');
NODE
```

原生较低版本请求被拒绝，与 Dexie 捕获后改用无版本请求重新打开是两个不同层面的行为；后者没有把数据库降级，也没有反向运行迁移。

## 建议写入 #539 的发布 gate（未来实施验收）

1. **冻结第一版兼容基线。** 通道功能本身不引入业务 schema／payload／outbox 格式变更；第一阶段的默认发布 gate 也禁止 beta 单独 bump IndexedDB schema version（即使仅新增表），保持两个通道同一兼容存储契约。初始 stable 与 beta 指向同一产物。记录实际 stable artifact、Dexie 版本、本机 schema、数据格式和 API 能力基线，不能以仓库 HEAD 代替已发布稳定版。以后放开 schema bump 必须明确检查旧表／索引／主键仍可用、原有数据和新扩展保真、旧产物重开不触发补空表／意外 schema patch、多连接 versionchange 正确协调，并通过下述全部实际产物矩阵；本探针不是这一授权。
2. **每次更新 beta 前验证与当前 stable 的双向兼容，而非只在提升 stable 时验证。** beta 同样可能产生会同步给稳定版用户的共享笔记。发布候选构建完成后，以实际 stable 和 candidate 产物执行 `stable → beta → stable → beta`。更新仍存活稳定版客户端的浏览器窗口也在兼容范围内。
3. **固定 fixture 与断言。** 包含离线 PDF Blob／独立快照、本机体验笔记、个人层和共享层草稿、pending outbox、已尝试的 opId、冲突 canonical/local、游标、归属／session fence、阅读偏好，以及新功能可选元数据。验证内容与关联、Blob 校验和、状态／opId 不丢失；回切后继续编辑／同步，再切 beta，不能仅断言 `open()` 成功或表数量。
4. **同步契约测试。** 当前 stable 客户端与最新后端、beta 客户端与最新后端；beta 写入后 stable pull／编辑／push，再由 beta 读取，验证字段保真、乐谱与层权限、未知对象不会让全批失败，不把不理解内容转换为删除，不误推进游标导致永远跳过内容。新旧已尝试 outbox payload 不得就地改写，避免相同 opId 不同内容触发 `op_id_reused`。
5. **多窗口和浏览器。** 在隔离新 profile 中执行 Chromium、WebKit 的真实 IndexedDB 探针；涵盖一个窗口仍持有旧连接、beta 升级触发 versionchange、待提交写入、冻结／恢复窗口、离线回切和重新联网。SW 安全交接只协调界面刷新，不替代数据库升级／事务协调。没有按 gate 通过就不准入 beta，保持其目标原指针。
6. **禁止失败兜底删库。** 打开／校验失败保留全部本机数据和旧可用版本，通道变更尚未完成时保留原偏好／目标，给可重试诊断。不能要求先上传所有草稿，不能靠退出登录、清缓存或重建 DB 完成回切。

## 超出兼容窗口时的桥接策略（设计推断，尚未实现）

优先使用 expand–migrate–contract，但这三个词不是安全证明。必须明确桥接顺序：

1. 先发布兼容桥接版 B，在仍使用旧持久格式时加入未来格式的读取／保真编辑能力和新后端协议支持。B 自身满足与旧 stable 的回切矩阵；不能先写新格式，再事后补兼容。
2. B 验证后提升 stable。之后 beta C 才能启用相关新写入；C 的 gate 针对**当前 B stable 实际产物**重跑。新增字段、对象 kind、索引和表均以实际读写能力与测试为准。
3. 仍在线或离线后恢复的旧客户端不会因“提升稳定版”立即消失。共享数据新格式启用前，要有已验证的 API 兼容表示／能力协商；不能给旧客户端返回其拒绝的新 kind。若投影会丢语义或旧端保存会覆盖扩展内容，则保持新写入关闭，先做保真桥接／明确只读策略。单纯 schema version 提升不能解决这一问题。
4. 本机 destructive contract（删表、删字段、改键／枚举语义）必须另立迁移任务并证明旧客户端及回切目标不再依赖旧形态；长期离线客户端使得“等几天”不构成证据。第一阶段不授权此类变更。必要时长期保留旧表示或版本化的独立扩展记录，后者仍需验证权限清理和旧端编辑合并。
5. 发布回滚目标只能是兼容窗内经验证的产物；把旧 JS 重新分发不可能逆转已经发生的数据丢失。若 gate 无法满足，阻止这次 beta 晋级／上线，而不是悄悄取消用户回切保证。

因此 #539 可以进入实现准备：有保守的同库兼容路线、实证支持及明确发布阻断条件。尚未完成的真实浏览器／实际产物矩阵属于实现验收，不应在 issue 中写成已经通过。


## 真实浏览器 IndexedDB 补充实证

同日进一步使用临时 localhost HTTP server、esbuild 打包当前**实际** `SamePageDatabase`，分别启动 Playwright Chromium 151.0.7922.34、WebKit 26.5 的全新 context。没有导入 fake-indexeddb；全部使用浏览器原生 IndexedDB。每个用例随机库名，finally 删除；context、browser、server 均关闭，不使用用户 profile。

| 用例 | Chromium 151.0.7922.34 | WebKit 26.5 |
| --- | --- | --- |
| 同存储契约 stable → beta 写入 → stable，system 普通记录与 beta 独立可选键 | 通过，native 150，编辑与可选键保留 | 通过，native 150，编辑与可选键保留 |
| 同上，保留人工 Blob 并读回字节 | 通过，`test-xml` 保留 | **未通过**：首次保存 Blob 即 UnknownError |
| 实际类加 v16 新表，实际 v15 回开 | 通过，native 160、草稿保留、新表仍存在 | 通过，native 160、草稿保留、新表仍存在 |
| v16 删除已有 readingPreferences，再用实际 v15 打开 | native 161，原记录计数为 0 | native 161，原记录计数为 0 |
| 不经 Dexie，原生 IDB 单独写入 Blob | 通过 | **未通过**：原生事务也失败 |

实际失败信息：

```text
WebKit / SamePageDatabase Blob:
UnknownError: Error preparing Blob/File data to be stored in object store
 UnknownError: Error preparing Blob/File data to be stored in object store
WebKit / native Blob:
UnknownError: native transaction failed without error detail
```

后一条是探针对原生事务无 error detail 的统一展示，不是浏览器给出的详细原因。第一次整体脚本在 WebKit Blob 用例抛出后中止；随后将用例隔离、加入原生 Blob 对照，再获得上表完整结果。不能把前次中止后的用例当作已执行。

**边界与处理：** 两个引擎的结构版本适配及普通记录往返已得到真实浏览器实证；Blob 只有 Chromium 通过。WebKit 原生写入也失败，说明该失败不是只在通道回切时发生，也不能归因于 Dexie 或通道逻辑；具体是自动化 WebKit 环境限制还是其他平台问题尚未确定。不能据此宣称真实 Safari 已兼容，不能用假 Blob、内存实现或清空数据掩盖失败。实现验收必须在支持的真实 Safari／iOS 环境确认已有离线 Blob 保存与 `stable → beta → stable` 完整往返；若真实用户环境复现，须解决后才可上线。当前研究仍可支持设计进入 ready-for-agent，**不代表部署门槛已经通过**。

这里 stable 和 beta 都是当前类的合成实例，用来验证底层行为；不是线上 stable 与候选产物，也未覆盖完整草稿／outbox／冲突／同步／多窗口矩阵。该完整矩阵仍按上述 gate 实施。

复现：从仓库根目录，将下列脚本保存到系统临时目录（如 `/tmp/issue-539-real-db-probe.mjs`），执行 `node /tmp/issue-539-real-db-probe.mjs`。脚本仅启动本机临时 HTTP 服务，无生产调用；`ok:false` 是如实收集的失败，脚本成功退出不表示全部用例通过。

```javascript
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
const req = createRequire(process.cwd() + '/package.json');
const { build } = req('esbuild');
const { chromium, webkit } = req('playwright');
const source = `
import { SamePageDatabase } from './src/client/platform/local-database.ts';
import Dexie from 'dexie';
window.runDbProbe = async () => {
 const names=[];
 const nameFor=x=>{const n='issue-539-real-'+x+'-'+crypto.randomUUID();names.push(n);return n;};
 const info=db=>({declared:db.verno,native:db.backendDB().version});
 const results={};
 const run=async(label,fn)=>{try{results[label]={ok:true,...await fn()}}catch(e){results[label]={ok:false,name:e?.name??"UnknownError",message:e?.message??"native transaction failed without error detail"}}};
 try {
  for(const withBlob of [false,true])await run(withBlob?'sameContractBlob':'sameContractRecords',async()=>{
   const n=nameFor('same');let stable=new SamePageDatabase(n);await stable.open();
   try{await stable.system.put({key:'draft',value:'unsynced',...(withBlob?{blob:new Blob(['test-xml'])}:{})})}finally{stable.close()}
   let beta=new SamePageDatabase(n);await beta.open();
   try{const row=await beta.system.get('draft');if(withBlob&&await row.blob.text()!=='test-xml')throw Error('beta blob mismatch');await beta.system.put({...row,value:'edited-by-beta'});await beta.system.put({key:'probe:beta',value:'optional-v1'})}finally{beta.close()}
   stable=new SamePageDatabase(n);await stable.open();
   try{const row=await stable.system.get('draft');if(row.value!=='edited-by-beta'||(await stable.system.get('probe:beta')).value!=='optional-v1')throw Error('roundtrip mismatch');if(withBlob&&await row.blob.text()!=='test-xml')throw Error('stable blob mismatch');return {...info(stable),stableBetaStable:true,value:row.value,...(withBlob?{blob:await row.blob.text()}:{}),betaOptional:'optional-v1'}}finally{stable.close()}
  });
  await run('stableAfterAdditive',async()=>{
   const n=nameFor('additive');let beta=new SamePageDatabase(n);beta.version(16).stores({betaOnly:'&key'});await beta.open();
   try{await beta.system.put({key:'draft',value:'unsynced'});await beta.table('betaOnly').put({key:'x',value:'retained'})}finally{beta.close()}
   const stable=new SamePageDatabase(n);await stable.open();
   try{if((await stable.system.get('draft')).value!=='unsynced'||!stable.backendDB().objectStoreNames.contains('betaOnly'))throw Error('additive mismatch');return {...info(stable),draft:'unsynced',betaTableExists:true}}finally{stable.close()}
  });
  await run('stableAfterDelete',async()=>{
   const n=nameFor('delete');let stable=new SamePageDatabase(n);await stable.open();try{await stable.readingPreferences.put({key:'probe',ownerKey:'user:test',choirId:'test'})}finally{stable.close()}
   const beta=new SamePageDatabase(n);beta.version(16).stores({readingPreferences:null});await beta.open();beta.close();
   stable=new SamePageDatabase(n);await stable.open();try{return {...info(stable),preferencesCount:await stable.readingPreferences.count()}}finally{stable.close()}
  });
  await run('nativeBlob',async()=>{
   const n=nameFor('native-blob');const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(n,1);r.onupgradeneeded=()=>r.result.createObjectStore('files');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
   try{await new Promise((resolve,reject)=>{const tx=db.transaction('files','readwrite');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);tx.onerror=e=>{e.preventDefault();reject(tx.error)};tx.objectStore('files').put(new Blob(['test-xml']),'x')});return {stored:true}}finally{db.close()}
  });
  return results;
 }finally{for(const n of names)await Dexie.delete(n)}
};`;
const built=await build({stdin:{contents:source,resolveDir:process.cwd(),sourcefile:'issue-539-real-db.ts',loader:'ts'},bundle:true,platform:'browser',format:'iife',write:false});
const server=createServer((r,s)=>{s.setHeader('Cache-Control','no-store');if(r.url==='/probe.js'){s.setHeader('Content-Type','text/javascript');s.end(built.outputFiles[0].text)}else{s.setHeader('Content-Type','text/html');s.end('<!doctype html><script src="/probe.js"></script>')}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
try{for(const [name,type]of [['chromium',chromium],['webkit',webkit]]){
 const browser=await type.launch({headless:true});
 try{const context=await browser.newContext();try{const page=await context.newPage();await page.goto(origin);await page.waitForFunction(()=>typeof window.runDbProbe==='function');const results=await page.evaluate(()=>window.runDbProbe());console.log(JSON.stringify({browser:name,version:browser.version(),results}))}finally{await context.close()}}finally{await browser.close()}
}}finally{await new Promise(r=>server.close(r))}
```
