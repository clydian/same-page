# PR #479 / #480 再审查

审查起点：#479 `4e76d74`，#480 `8e6dcb7`；两者仍为 draft。重新读取全部 conversation、review submissions 和 review threads，均为空。没有合并、部署或生产数据写入。

检查共享像素预算/队列取消/前后台恢复、旧文档和已卸载画布的异步结果失效；跨页输入归属、边界截断、写入失败保留、同层 undo/redo；原有 owner/session/workspace/layer 权限边界。当前没有新发现的产品代码阻断项。新增测试明确断言：旧 getPage 在文档替换或卸载后才返回，不得调用旧 render、替换当前画面、重新占用预算；卸载所有画布后预留像素及画布数归零。测试通过并不代替实体设备验收。

## Ctrl+点击尚未确诊

失败证据是 #479 CI run `39339439020`、首次 smoke(1) job `118357384314`：Chromium 的 `context.waitForEvent("page", {timeout: 5000})` 超时。相邻 WebKit 和 #480 同用例成功。下载并检查首次失败 artifact `12228477896`：只有其他测试截图，本用例当时未保存 trace、输入事件、点击完成时间或导航请求，因此不能判断点击是否被拦截、actionability 等待占掉事件时限、还是新页面初始导航变慢。不得据此归因应用、基础设施或宣称重跑已修复。

本地系统 Chromium：原测试通过；同一真实本地 Worker/R2/D1 合成会话中连续 40 次执行触摸菜单 → 右键 → Escape → Ctrl+点击，每次新页成功且点击 defaultPrevented=false。未复现历史故障，不能提供修前失败/修后成功的因果证明。没有产品修复，没有增加 retry 或放宽断言/超时。

补齐此测试的永久证据：两个引擎每次运行均保存 trace（动作、DOM、网络）、截图、输入事件的 pointerType/修饰键/defaultPrevented、点击开始/完成及新页/导航响应时间；上传位置为 `artifacts/verification/file-touch-links/`。原 5 秒事件时限和真实 PDF 内容断言保留；每次运行连续检查三次右键/Ctrl+点击，每一次失败都使测试失败。Promise.all 同时观察动作和事件，避免事件 Promise 在 click 等待期间超时后成为未观察的 rejection；这只改进失败观察，不宣称消除偶发超时。

采集器另做受控反证：仅在隔离测试中主动 preventDefault 取消 Ctrl+点击，同样触发原 5 秒超时。原生事件在 capture listener 之后可能先执行 microtask，最初采集曾错误读取为 false；改为事件分发后的任务读取，受控失败准确留下 defaultPrevented=true、click-complete、无新页及 trace。受控取消不是历史事故复现，也不是产品根因。

仍缺：一次带上述 trace 的同类失败，或能够稳定触发的受控条件。在此之前 Ctrl+点击问题保持未解决状态；不把多次通过记作根因结案。
