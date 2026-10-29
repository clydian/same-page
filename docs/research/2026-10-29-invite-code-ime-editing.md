# 邀请码即时显示、中文输入法与字符校验调研

日期：2026-10-29。代码基线：`10874ff`。本轮只调研和受控复现，不修改产品、服务端协议或既有邀请码。

## 结论

推荐将邀请码改为**一个可见的原生文本输入框，原始草稿同步更新，规范化与校验独立进行**。大写外观可以用 CSS 呈现，业务提交再按明确规则生成规范值。不要在编辑过程中静默删除 `O`、`I`，也不要把上一次有效邀请码保留成当前可提交值。

如果八格外观必须保留，也可以做到组字期间即时预览，但八格必须读取当前草稿，而不是已确认业务值；还要处理组合范围、光标/选区、无效字符及超长内容的可见性。它比可见原生输入框更复杂，不能只改一条绑定就声称完成了生产修复。

“立即显示正在输入的字母”与“强制输入法立即提交这些字母”是两件事。前者可实现；后者不应通过网页劫持输入法完成，也不能承诺所有系统都无需确认键。点击导致失焦时，最终确认、取消还是转换成中文字，由输入法/浏览器决定，必须读取最终真实文本。

## 最终产品选择

用户确认保留稳定八格，并强制最多八位。因此最终实现采用单一原生输入、即时草稿镜像与独立校验；组字期间不截断，确认后保留前八个非展示分隔符字符并提示截断。I/O、中文等无效字符保留并报错，既有字母表与服务端协议不变。确认后移除已支持的空格与分组横线，并映射选区，避免删除不可见分隔符。格子点选与拖选映射到原生 UTF-16 选区，避免分隔符或宽字导致命中位置偏移。以下推荐原生可见输入的内容是调研时的初始取舍，最终选择以本节为准。

## 当前项目的确定事实

代码来源：[JoinCodeField](https://github.com/itscly2026/same-page/blob/10874fff427ae71023ab12eb4591db511427144f/src/client/components/join-code-field.tsx)、[客户端规范化](https://github.com/itscly2026/same-page/blob/10874fff427ae71023ab12eb4591db511427144f/src/client/components/join-code.ts)、[服务端生成与校验](https://github.com/itscly2026/same-page/blob/10874fff427ae71023ab12eb4591db511427144f/worker/security/join-code.ts)。

- 草稿 `draft.raw` 会在组字时更新，但八格绑定 `props.value`；组字期间业务值冻结，原生输入又是透明的，因此用户看不到已经存在的草稿。
- 客户端清理函数会删除非 `[A-HJ-NP-Z2-9]` 字符；服务端字母表明确排除 `I`、`O`、`0`、`1`，但包含 `U` 和 `L`。`O/I` 消失与当前业务过滤直接对应，不需要用输入法故障解释。
- 服务端只对完整值进行 `trim()`、大写转换和八位字母表校验；它并不接受中间横线。允许分组粘贴属于客户端已有的呈现规范化，不能假定后端会自行移除分隔符。

主代理在当前页面执行 Chromium 原生 CDP 组合输入，得到：

| 输入操作 | 原生草稿 | 八格内容 |
| --- | --- | --- |
| 正在组字 `as` | `as` | 空白 |
| 确认 `as` | `as` | `AS` |
| 正在组字 `oiu` | `oiu` | 空白 |
| 确认 `oiu` | `u` | `U` |
| 直接输入 `OIA2U3BC` | `A2U3BC` | `A2U3BC` |
| 直接输入 `Uu` | `Uu` | `UU` |

复现命令：`node /tmp/same-page-current-ime-research.mjs`。针对即时显示和保留 O/I 的期望断言失败，退出码为 1。

另做了仅拦截开发模块响应的正向对照：停止改写原生草稿，让八格从 `draft.raw.toUpperCase()` 派生。六项短字符串检查通过：`as` 和 `oiu` 可在组字期间显示，确认后没有重复，O/I/U 均可见。命令：`IME_VARIANT=draft-preview node /tmp/same-page-ime-draft-preview-probe.mjs`，退出码为 0。这只证明即时预览与保护原生组合范围可以共存；校验、溢出、选区与辅助技术仍未完成，不能作为可发布实现。

## 补充：字母与数字混输

对照命令：`node /tmp/same-page-ime-alnum-research.mjs` 与 `IME_VARIANT=draft-preview node /tmp/same-page-ime-alnum-research.mjs`。全部使用合成凭证样例，不采集真实邀请码。

- 当前实现直接输入或确认拉丁文本 `ab23`，会保留并显示 `AB23`；组字期间依然空白。因此，“字母数字混输必然被过滤”不成立，仍需确认用户真实输入法最终交给页面的完整文本。
- 控制输入法最终提交中文加数字 `阿波23` 时，当前清理会将草稿与显示都改成 `23`；原样保留草稿的正向对照会显示完整 `阿波23`。这是受控最终文本对照，并非已复现用户实际 OS 候选选择过程。
- 推荐方案能消除应用静默删字，保证尚存在的 `ab23` 即时可见；若输入法本身已把字母转换成汉字，只能保留最终文字并明确校验失败，不能承诺无损反推原始拼音。禁止删掉汉字后把剩余数字作为另一串有效邀请码提交。

## 一手规范与实现依据

### 编辑值与展示值必须分开

React 官方要求受控输入在 `onChange` 中同步接收 DOM 当前值，并把即时转大写列为光标问题示例。W3C CSS Text 说明 `text-transform` 仅改变呈现，不改变底层内容或纯文本复制结果。因此，显示大写不需要逐次把大写字符串写回 DOM；提交规范化也不能依赖 CSS。[React 输入文档](https://react.dev/reference/react-dom/components/input#my-input-caret-jumps-to-the-beginning-on-every-keystroke)、[CSS Text §2.1](https://www.w3.org/TR/css-text-3/#text-transform-property)。

组合输入本身是对活动文本段的持续更新，`input` 发生在 DOM 更新之后。读取当前完整 `input.value` 可用于展示组字进度；不能把每个 composition 事件的 `data` 当成追加字符。Input Events Level 2 仍是 Working Draft，真实事件顺序和候选行为仍需跨平台验证。[Input Events §7](https://www.w3.org/TR/input-events-2/#input-event-order-during-composition)、[UI Events](https://www.w3.org/TR/uievents/#events-compositionevents)。

### 即时展示不等于即时有效

W3C 表单指南强调可理解的错误反馈、容忍合理格式差异，并保留服务端校验。这里的设计建议是保留无效输入供用户核对，而非删除后提交另一串字符。例如输入 `ABOI2345` 应完整显示，并提示邀请码不包含 I/O；它不应变成 `AB2345`。这条 UX 建议是基于指南与本项目凭证语义的推导，不是指南对该控件的逐字要求。[WAI 表单校验](https://www.w3.org/WAI/tutorials/forms/validation/)。

不同凭证字母表也可能单独排除某些字母。例如 Crockford Base32 明确排除 I/L/O/U；本项目采用的字母表与它不同。用户观察到其他网站的 U 被拒绝，不能据此推断该网站和本项目存在同一个 IME 缺陷，也不能推断该网站采用了 Crockford 编码。[Crockford 原始说明](https://www.crockford.com/base32.html)。

### 输入属性是提示，不是禁用输入法的开关

WHATWG 将 `inputmode` 定义为帮助选择合适输入机制的提示；`text` 保留用户语言环境的文本输入。`autocapitalize` 通常不影响物理键盘，且可被用户代理或输入法覆盖，不能用于校验。`enterkeyhint` 改变虚拟键盘按键标签，也不能强制组字提交。不要通过 `type=tel`、`type=email` 或自造 `inputmode=latin` 来冒充输入法解决方案。[WHATWG 输入模式](https://html.spec.whatwg.org/multipage/interaction.html#input-modalities:-the-inputmode-attribute)、[自动大写](https://html.spec.whatwg.org/multipage/interaction.html#autocapitalization)、[Enter 提示](https://html.spec.whatwg.org/multipage/interaction.html#input-modalities:-the-enterkeyhint-attribute)。

### Enter 选字不能被解释为提交

优先保留普通单行输入与原生 form 提交，不新增 Enter 快捷提交。Chrome 官方指南明确区分原生隐式提交与自定义 `keydown` 提交：原生表单由浏览器处理 IME 消费的 Enter；自定义处理则必须识别组合状态，并避免默认提交与手动提交重复。若目标环境确需自定义处理，应实测后采用指南描述的 `isComposing` 与 Enter 范围内 `keyCode === 229` 兼容方案，而不是把 229 过滤应用到所有按键。[Chrome 官方 IME 指南](https://developer.chrome.com/docs/modern-web-guidance/guides/forms/ime-safe-enter-submit)。

Safari 历史上存在 composition/key 事件顺序问题。旧 bug 虽标为已解决/重复，新 bug 的 2026-10 评论又说明修复曾被回退，因此不能仅根据状态标签断言所有当前 Safari 与独立 Web App 都已无此问题。必须记录实际系统、浏览器和输入法版本。[WebKit 165004](https://bugs.webkit.org/show_bug.cgi?id=165004)、[WebKit 311717](https://bugs.webkit.org/show_bug.cgi?id=311717)。

## 推荐实现方向（尚未实现）

1. 原生输入框保存并显示完整编辑草稿，React 同步接收 `event.currentTarget.value`，输入期间不转写、不按业务字母表过滤、不拼接组合事件数据。普通原生光标、选区与组字下划线由浏览器管理。
2. 用纯解析函数从当前草稿派生规范值、长度和错误原因。允许哪些空格/横线属于显式格式规则；只接受既定邀请码字母表。不能把 O/I 改成猜测字符，也不能先删除它们再当作有效凭证。
3. 组字时立即显示草稿；候选尚未确认时不做网络准入、不触发满八位自动进入、不发布可提交的“最后一个有效码”。确认、取消及最终 input 事件按完整文本幂等更新。
4. 编辑框可保持合理的原始长度上限，业务仍严格八位。超长、中文及无效字符必须可见并可删除；不能只显示前八个字符却保留看不见的尾部。提交时再次同步解析当前完整文本，任何错误都阻止使用缩短后的替代码。
5. 默认建议采用可见原生文本框，大写可仅通过 CSS 展示，分组可作说明或非编辑预览。若坚持八格，保留一个原生输入而非八个切换焦点的输入，并补齐当前草稿镜像、组合状态、实际选区、溢出与错误展示。这是产品外观与维护复杂度的取舍。
6. `inputMode="text"`、`autoCapitalize="characters"`、`autoCorrect="off"`、`spellCheck={false}` 可作为体验提示；它们不替代组合输入兼容和字符校验。邀请码是可重复使用的共享凭证，不应仅因为 OTP 库默认如此就开启短信 `one-time-code` 自动填充语义。

这里建议在前端修正编辑/展示/校验的职责，保持生成规则、后端校验和已部署邀请码不变。若产品要真正支持含 O/I 的邀请码，那是独立的凭证协议与兼容迁移决策，不应与此次输入法修复捆绑。

## 现成组件是否能直接解决

2026-10-29 查看了维护者仓库源码快照：

- [`input-otp`，cf81845](https://github.com/guilhermerodz/input-otp/blob/cf81845e59ff43c5885c66b4755085a36f071cc1/packages/input-otp/src/input.tsx)：一个原生输入覆盖装饰槽，维护镜像选区；默认 numeric、one-time-code。其 change handler 截取长度并用正则拒绝字符串，所查看文件没有内建 composition 处理。架构可参考，但不能保证给定正则/回调与中文 IME 配合正确；没有理由为此直接引入依赖。
- [Radix OTP，eb3a2b7](https://github.com/radix-ui/primitives/blob/eb3a2b7091293e27df8f9ba906632d8daa3d81a3/packages/react/one-time-password-field/src/one-time-password-field.tsx)：每格为原生输入，并有焦点、单字符长度和输入分发逻辑。所查看文件也未提供明确的 IME 完整保证。对本项目而言，多输入之间的焦点迁移增加组合输入验证面。

以上是源码审阅结果，不是这些库在所有平台上的缺陷报告，也不是完成过本项目接入验证的推荐。

## 验收范围与证据边界

- 自动化：原生 Chromium 组合输入的逐次可见性；包含 A–Z（特别是 I/O/U）、2–9、0/1 的编辑与错误反馈；快速与慢速输入、大小写、选区替换、删除、撤销、分组粘贴、九位及更长草稿、确认中文候选、取消组字。
- 表单：选字 Enter 不提交；普通 Enter/点击提交的正确行为；满八位未确认草稿和当前无效草稿均不得使用旧有效值；确认/取消后解析结果与显示完全一致。
- 实机：macOS Safari/Chrome + 系统拼音；Windows Chrome/Edge + 微软拼音；iOS Safari/独立 Web App + 中文键盘；Android Chrome + 常用中文输入法；VoiceOver/键盘选区。记录版本，并覆盖点按钮造成的失焦、候选点击和快速连续输入。
- CDP 的原生组合范围重放优于仅 dispatch 合成 composition 事件，但它不等价于真实 OS 候选窗、移动键盘或 Safari 输入法验收。本轮没有诊断或复现 OpenAI 网站的实现。
