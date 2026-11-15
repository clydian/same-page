# Use a filename-first library with recoverable trash

> 创建、额度与彻底删除规则由 ADR-0017 替代；下文保留原决策背景。
Same Page treats every validated upload as an immediately visible score whose initial display name is the PDF filename, without separate work metadata or draft and publication states; this keeps choir file management aligned with a familiar cloud-drive model while preserving a stable score identity across rename and PDF replacement. Deletion moves the complete score to an administrator-only thirty-day trash that supports restoration but not immediate permanent deletion, so accidental removal remains recoverable while one automatic expiry path consistently purges PDF versions and annotations.

Visible score names omit the final case-insensitive `.pdf` suffix. Stored filenames, uniqueness and downloads retain the extension; rename inputs add it when omitted. The `/` page presents the public product homepage immediately, including while identity is being checked. Only a cold startup (or a completed login without another destination) may automatically reopen the last accessible member drive, or the sole membership when no last drive is remembered. Multiple memberships without a remembered destination open `/drives`; an unavailable remembered drive opens that list with an explanation. No memberships leaves the homepage visible. Offline startup may restore owner-scoped saved membership directories, never treating them as cloud authorization or including public preview access.

Explicit home navigation uses `/` with a home intent and always stays on the homepage, including after a late identity response. `/drives` expresses explicit selection and never automatically redirects after returning or closing admission. Brand and “返回首页” actions go to the homepage; signed-in users can also open the public preview there and use “我的云盘” to reach selection. Explicit invitations, drive/score deep links and foreground resume preserve their destinations; neither a delayed startup response nor local recovery may override them.


Installation onboarding (#290) extends cold startup for signed-out visitors with no remembered user identity: a currently valid server guest session may reopen its ordinary drive. Public preview sessions never trigger restoration. The server must confirm admission before activating the isolated guest workspace; local storage alone cannot authorize access. This lets Home Screen launches resume an invited drive when the platform copies cookies at installation, while retaining all explicit-navigation and member-startup rules above.


Navigation refinement (#482) makes the current drive name the direct membership picker, with the gear opening drive settings. The public homepage and explicit `/drives` selection rules above remain unchanged. Library search and sort share one row; sort direction is an optional owner/drive-scoped session preference compatible with earlier views. Touch pull-to-refresh and the personal/guest menu both refresh the existing library without reloading the application. Existing settings deep links, authority checks and local draft boundaries remain unchanged.


## 云盘入口与按需反馈 · 2026-11-15

切换面板按本次打开的目录规模预留行数，冷读完成后仅在没有按住控件时收敛一次；随后刷新保持本次空间稳定，更多云盘在列表内滚动。手机保留底部面板，桌面保留锚定面板。创建云盘突出两字段与额度摘要，保留可见的清理风险摘要，完整邀请与清理规则按需展开；创建权限、提交与不确定结果处理不变。

安装建议保留原有显眼、可关闭的排练准备卡片。列表不常驻逐谱离线说明，继续由既有图标与辅助描述表达状态。离线点击不可打开的普通附件或外链时复用底部短暂可关闭提示，不插入附件行文字；MusicXML 仍由其自身离线准备与访问校验决定能否打开。
