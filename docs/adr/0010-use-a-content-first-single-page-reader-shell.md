# Use a content-first single-page reader shell

Same Page will use an iPad-first reader in which the score is the sole primary content: a score first opens in 翻页模式 fitted to one whole page in every orientation, while 连续滚动模式 remains an optional per-score preference, and all reader chrome stays hidden until a central tap after a one-time first-use hint. In 阅读模式 under 翻页模式, edge taps or horizontal swipes turn pages, pinch and drag zoom or pan, a page turn restores whole-page fit, the last page and layout are restored on the same device only, and thumbnails, layers, layout, offline, and synchronization controls appear in overlay panels; only a new PDF version, a local conflict, or local-data risk may interrupt the score. 编辑模式 keeps the revealed top controls in place with only the edit control shown as selected; it edits one page in 翻页模式 and permits separate edits on visible pages in 连续滚动模式. Toggling that control off returns to the same reading layout at the current page. Always-visible reading chrome, reflowing sidebars, two-page spreads, cross-device reading-position sync are deliberately excluded because they dilute score focus or add complexity to the first version.

Entering or leaving editing preserves the current page's scale and viewport position. In continuous reading, editing keeps neighbouring pages visible and separately editable while retaining the existing page geometry and scroll container; rebuilding a fitted single-page layout would lose the user's place. Finishing keeps the same reading layout without a scale conversion or scroll restoration.

Reading is immersive by hiding application controls. A supported browser exposes full-screen reading through a user gesture, requesting hidden navigation UI on the document root so body portals remain visible. Leaving the reader exits only the fullscreen session it requested; unsupported platforms keep ordinary reading. The background fills the screen, while the score viewport consumes the four device safe-area insets. Fitting, scrolling, zoom anchoring and annotation coordinates use that same reduced viewport; content must not paint into the system status-bar area. Controls independently respect device safe areas. This supersedes the earlier full-screen score geometry, which allowed the status bar to overlap the paper (Issue #327). Browser and installed-app policies retain authority over system status bars.

Module loading, local identity preparation, document loading and first paint share the content-first paper shell. Retry and diagnostics appear only on failure. Returning first closes the top overlay, then commits composing text and awaits durable local editing before leaving editing; an explicit internal link continues to its destination after these steps. Cloud synchronization does not hold navigation.

The open deadline includes source selection, document readiness and first visible page confirmation. A PDF.js document resolving is not proof that the loading overlay has disappeared. Only the current document's display callback confirms presentation; an unpainted document is never retained as a successful recovery target. Timeout provides retry/back navigation and safe stage diagnostics, without classifying the device as incompatible. Local Blob reads are bounded so stalled storage does not occupy verification slots indefinitely; online source arbitration remains independent of annotation synchronization.

In continuous reading, the page at the vertical viewport center is the current reading page used by preview selection; continuous editing input ownership is selected by the page receiving the pointer; a trailing fragment at the top does not determine it. Revealing reading controls also reveals the compact horizontal thumbnail strip and a separate translucent page-position capsule. The thumbnail strip is a centered whole-document scrubber that shrinks to its page count, capped by the available width: resting thumbnails are sampled to fit the available width without overlap, the selected thumbnail enlarges in place, and dragging maps directly to a page, and a native range input provides touch and keyboard access. Page labels update immediately; a 120ms pause or release selects the latest destination without queueing intermediate renders. At most 40 thumbnails are sampled at a minimum 20px spacing, while every page remains selectable. The strip uses slightly larger, legible miniature pages on a translucent paper surface. The page-position capsule sits separately at the upper right and is a labelled button with an expansion affordance: it opens a scrollable thumbnail grid with page numbers and current-page selection. Selecting a page closes the grid and returns to the score; Escape/back dismisses it without navigating the score. There is no numeric page input. The bottom strip remains a compact scrubber without page labels or a floating preview card. The grid renders only nearby thumbnail rows so long scores remain responsive.

Continuous reading initially fits width. The explicit “适合页面” action fits the current page in both dimensions and realigns it after geometry changes. Editing keeps the current page mounted, allows two-finger pan/zoom from blank canvas, and cancels the interrupted single-touch edit when the second finger takes over. Reading drags and blank-canvas two-finger translation in either mode consume available horizontal pan first, then hand the remaining motion to one shared page turn. Distance, velocity, reversal, boundary resistance and rebound belong to the pager; editing has no separate threshold or release hint. Pinch and cancellation do not turn. The destination fits the page and centers it in either layout while preserving layer, tool and editor history. A gesture starting on a movable note stays owned by that object even if the second finger lands outside it. Erasing is previewed until release so navigation cancellation does not delete ink. Text composition has its own commit state: saving another annotation cannot disable a newly mounted textarea and prevent its user-gesture autofocus. A pending text commit makes the input read-only instead of disabling it, preserving focus and the draft on failure. Native software keyboard behavior still requires device acceptance.

The public preview score link explicitly requests local experience, including when the browser has an authenticated session. Experience reads omit account layers and never provision a server personal layer. Signed-in experience data has a separate local owner scope tied to that account's existing session fence; guest experience has a separate scope tied to the per-drive guest owner. Notes stay durable in local storage, never enter the outbox, are not uploaded or migrated at login, and clearing a score's experience notes also removes its offline snapshot copies. Explicit logout clears the signed-in experience's private and mutable local data together with account data; only sanitized public offline copies may remain. Ordinary member reader links retain their account workspace. The source drive's permission and shared-layer information remains readable through its existing access rules.

The last explicitly selected note tool is a local preference scoped to the same owner as tool styles. It is retained across scores and reloads, with text as the fallback for missing, invalid or unreadable preferences. Choosing a tool is sufficient to remember it; entering editing does not overwrite it. Opening a score still starts in reading mode. Text composition retains its accessible name and user-gesture focus without a visible placeholder.

Tool changes preserve the annotation display nodes and cancel the unfinished pointer interaction, including its ink checkpoints. Released object transforms remain projected until local data takes over, including failed writes retained for retry. The editor supplies committed object intent with its queue revision so a later undo/redo cannot be hidden when the local query skips an intermediate position. This projection is scoped to the mounted edit layer and does not wait for cloud synchronization.

Highlighter coverage deposits a coat only in the area newly entered by the moving nib. Adjacent samples share the prior contact footprint, while retracing or crossing after leaving an area adds another coat. SVG display, hit testing and PDF export consume the same coverage geometry. Geometry uses the PDF page's intrinsic aspect ratio; zoom-dependent DOM rounding must not reshape saved ink. This changes rendering of retraced existing highlighters without rewriting their point data or changing the annotation schema; older deployed clients retain their previous single-coat rendering until updated.


In paged reading at whole-page fit, single taps divide the visible viewport into equal horizontal thirds: previous page on the left, chrome in the center, and next page on the right. Above fit, single taps anywhere toggle chrome. Continuous reading uses single taps anywhere for chrome at every zoom. Editing keeps edge taps disabled. An unavailable boundary target leaves zoom and position unchanged. An object transform owns its pointer sequence: adding a second finger continues transforming that object rather than starting viewport navigation. Blank-page two-finger navigation still interrupts unfinished ink. Page spacing belongs to the pager layout, not foreground gutter overlays that can obscure the score during pinch previews.
Text uses explicit line breaks only in composition, score display and PDF export; the text block sizes to its longest line, has no width handles, and can extend beyond the page while its normalized center anchor remains on-page. Left/center/right alignment arranges lines within that stable block. New text starts at size 16 with 12–80 numeric entry and one-step decrement/increment controls; the schema's historical 12 minimum and 24 fallback stay unchanged for deployed clients and legacy notes. New-note size and alignment are local owner-scoped preferences, updated on successful creation; existing-note edits do not alter them.

The additive optional `textAlign` field requires the server to preserve stored alignment on older-client writes that omit it. New-client draft writes, including undo, explicitly encode center when legacy intent has no field. Operation hashes retain the original request intent for idempotent replay. Deploy the accepting/preserving server before clients that send alignment; older clients may display centered text until updated but must not erase the field on content edits. No database or IndexedDB schema migration is required.


Horizontal discrete navigation belongs only to paged reading, owned by `usePagedReader`. Continuous reading selects pages by vertical scrolling or direct thumbnail positioning, without a horizontal page transition. Input supplies logical navigation-session samples after subtracting paper pan; same-frame touch positions distinguish translation from pinch. Reversal withdraws page progress before returning to paper pan. Pinch, cancellation, extra contacts and document replacement cancel navigation and drain residual contacts; a movable note retains its original ownership. Reading in the continuous layout uses `touch-action: pan-y` and one non-passive TouchEvent path for horizontal panning/two-finger gestures; PointerEvent touch input is excluded there. Vertical native ownership is never reclaimed after its direction is established, retaining browser scrolling and momentum.

`pageTurnPresentation` applies progress and settling presentation only to paged reading. The current page keeps its mounted editor and zoom while the target renders at its own fitted aspect ratio, including PDF rotation. Render leases fence readiness by document and generation. Only a displayed target and `AnnotationEditor.prepareNavigation` admission can begin completion; a final local guard also protects edits arriving during settling. Text commits and released edits must be durable locally, saving/failed states return to the current page, and the editor remains active with its history. Cloud synchronization is outside admission. A successful horizontal turn fits and centers the destination; native vertical current-page feedback remains a layout selection. No API, database, IndexedDB or saved-note format changes are required.


Reading-mode double taps work across the entire score viewport. A single tap waits 250ms after release; a second down within that interval and 24 CSS px suspends the pending action, and a qualifying second release performs only the double tap. Movement of 10 CSS px, a press over 500ms, cancellation, additional contacts, navigation, mode changes, resize and unmount discard tap intent. A distant second contact discards the old pending tap and starts a new sequence. Controls keep their own input. Editing never acquires this single-finger gesture.

Continuous pages share one width-based zoom. A double tap enlarges to twice the layout's 100% baseline at the tapped paper point. Above that baseline by more than 1%, it restores 100%: fit-width in continuous mode while preserving a legal tapped vertical reading position (short paper centers vertically), or centered fit-page in paged mode. The continuous default therefore enlarges on the first double tap; the explicit toolbar fit-page action still centers the entire current page. A side gutter belongs to the page at that vertical coordinate; a gap belongs to the nearest page (the earlier page wins a tie). Page identity and the page-local anchor remain fixed throughout a zoom; viewport-center current-page feedback is independent of which page initiated it.

Pinch preview follows the captured paper point and may temporarily leave the reading bounds. Committed zoom and pan use only native scroll coordinates: a paper axis smaller than the viewport centers, while a larger axis stays within its scrollable range. A legal anchor remains stable; an impossible anchor does not create residual translations or extra blank space. The pinch minimum fits the captured paper, including when it differs from the viewport-center selection in a mixed-size continuous document. Continuous reading retains native vertical movement across pages; zoom centers short captured paper, and continuous editing retains document-wide vertical browsing. Continuous first/last pages always have only the geometry-derived padding needed for centering. Explicit fitting and successful page navigation restore centering; entering or leaving editing preserves position. This replaces the earlier rule that retained anchors outside native scroll range. No API, storage or annotation formats change. Both input paths cap the existing zoom state at 5 without changing either layout's percentage baseline or canvas memory budget. Page turns settle for 300ms with a shared duration and a later completion fallback; reduced-motion preferences suppress the visual transition.

Zoom handoff has one owner, `useReaderZoom`: double taps and pinch sessions share anchor capture, preview, committed-layout placement and one-time release. Input recognition retains contact arbitration and frame sampling; layout adapters retain paper geometry, editing constraints and virtual-page leases. A lease suspends continuous current-page feedback until completion or cancellation; presentation attributes are not the authority for that decision. Scope, mode, viewport/fit/navigation revision and mounted elements are checked before accepting a matching zoom, so obsolete sessions cannot place an anchor or release a newer lease. Geometry commits do not wait for PDF canvas paint. Cancellation discards positioning and presentation; it does not roll back the route's already-issued controlled zoom update. No user data or persisted format changes are involved.


An explicitly started audio or MusicXML attachment practice session may retain a thin, full-width bottom bar over its own PDF, with reserved reader space so the bar does not cover the paper. This is an exception to the exclusion of always-visible reading chrome: ordinary reading creates no player and loads no playback engine. The original PDF is the default practice view. A single select switches between PDF and MusicXML notation without recreating the playback session or discarding the PDF's reading position; entering another view uses the existing durable-edit navigation admission. Playback content is chosen through separate audio/MusicXML icon entries at the lower right of the reader, each opening a named list, or a specific attachment, before creating the session. Even a single item shows its name and audio/MusicXML file type without inferring its purpose. Settings do not switch content. An audio attachment opens a standalone preview; its "listen with score" action retains the same media element, current position and playback state while entering the original PDF. XML attachments enter the PDF directly and offer rendered notation; recordings display only PDF. Practice details open on demand. Collapsing details preserves audio; ending practice, leaving the owning score, changing identity or confirmed access revocation stops and disposes it. The PDF remains manually navigated: no MusicXML-to-PDF coordinate or automatic-page mapping is implied. Playback has no authority over annotation state or offline-copy completeness.

Issue #352 simplifies onboarding to two fixed, manually dismissed full-screen guides, selected only by reading layout. Zoom-dependent rules appear in the same guide rather than producing further variants. Whole-page downward dismissal is available only in paged reading outside editing; continuous scrolling never dismisses the score, including repeated pulls at the top. This supersedes the earlier shared horizontal-navigation behavior.

## 连续编辑浏览与轻量提示 · 2026-09-20

连续滚动模式下，编辑仍使用单指或笔操作笔记，双指移动或缩放，但垂直浏览范围改为整份文档。相邻谱面保持可见；手势期间保留原编辑页，松开后按视口中心选择目的页，通过既有本机持久化准入后才切换编辑页。保留缩放、浏览位置、所选工具、编辑层及 editor 历史；本机保存未就绪或新的编辑到达时保留原编辑页。异步准入不能覆盖后续手势、页面选择、模式或文档变化。此决定取代上文连续编辑仅允许在当前页内移动及隐藏相邻页的约束。横向离散翻页仍仅属于翻页模式。

进入各阅读模式的编辑时，顶部持续显示一行轻量提示：翻页模式为「编辑中 · 双指左右翻页」，连续模式为「编辑中 · 双指上下浏览」。提示不跟随工具变化，不因已经浏览或本机历史记录而淡出，不使用进入动画；阅读帮助保留「编辑操作指引」进入入口。此规则按 #368 取代原先记忆已学会手势并隐藏提示的行为。文字输入期间的提示与完成入口由下方 #370 决定取代。完成编辑是一个标有勾号与「完成」的轻量动作按钮，不使用工具选中样式。界面变化不修改 API、PDF、笔记格式或数据库 schema。

所选笔记属性采用主工具栏上方的上下文浮栏，直接预览原笔记，不再使用独立样本或「应用修改」。离散属性自动保存；连续调整在释放、失焦或取消选择前提交，一次调整对应一次撤销。文字对齐点击按左→中→右→左循环切换，图标显示当前状态，不增加提示或菜单，字号采用可输入数值与加减按钮。这取代原属性卡片及字号滑条；下一笔工具设置仍保留小样本预览。所有提交复用既有 AnnotationEditor 保存与历史协议，不改变持久化格式。

桌面编辑为选中笔记提供方向键微移（1 屏幕像素，Shift 为 10 像素）、删除、取消选择及文字输入快捷键。一次按住方向键对应一次历史记录，切换选择先结束原对象的移动，不能跨对象复用草稿。输入框和滑条保留原生键盘行为。导航准备等待已在执行的本机写入结束，再检查编辑有效期和准入条件；失败或取消不切页。

所选笔记的属性与键盘微移共用 `SelectedObjectAdjustment` 管理当前选择、临时意图及结束编辑/导航注册。两个输入路径交接时先释放原调整，再从最新显示投影开始下一次调整，各保留一次撤销；迟到的松键不能提交另一输入路径的调整。选择变化结束原对象的调整，编辑范围或权限变化则取消未释放的调整。原生字段归一化及按键识别仍归输入路径，已释放意图的显示衔接、失败重试和历史仍由 `ObjectMovement` 与 `AnnotationEditor` 负责，不新增存储或同步协议。


Reader usability refinements (Issue #368) preserve the existing gestures and quiet reading surface. Resizing the continuous viewport preserves the current page and its normalized paper position in reading and editing; it is not a navigation intent. An explicit page-fit preference remains fitted and centered. Editing continuously shows the layout-specific two-finger navigation hint, regardless of earlier device hint preferences, except while composing text. The selected tool is named without collapsing the existing tool set; the editing layer exposes its audience, and history controls reflect the selected layer's available undo/redo history.

The single 笔记图层 entry opens on 显示, with an internal 管理 page. 显示 owns score visibility and shared-layer display colors; 管理 owns personal-layer creation, naming, sharing, deletion and recovery. Restoring drive defaults explicitly names both visibility and color. Page switches keep management errors recoverable and preserve the panel shell. Reading options distinguish local/upload status from the last cloud check; no polling, proactive notices or notification badges are added. These are presentation changes with no storage or synchronization protocol migration.

## 文字输入状态与精确命中 · #370

文字输入期间使用约 8% 的中性灰黑遮罩区分输入状态，正在输入的文字、光标、紧凑边框、移动手柄和文字样式工具保持在遮罩上方；不挖洞、不增加白色输入卡片，其他编辑工具继续隐藏。顶部提示改为「正在输入文字 · 轻点空白处完成」，取消右上「收起」，按安全区和提示实际边界避让，不再为窄屏固定预留 108px。此决定取代 #368 的文字输入提示与右上完成入口。

文字块的点击范围与其内容布局一致，避免 44px 隐形命中区域覆盖相邻文字；普通工具按钮仍保留触摸尺寸。文字输入浮层自行处理触摸，禁止其触发浏览器整页缩放；多指、拖动和取消不能完成输入。进入输入时，避让后的兼容鼠标行为不能夺走输入焦点。只限制文字输入期间的手势，保留其他编辑与阅读状态的谱面双指浏览。

明确轻点空白处或既有键盘快捷键完成输入，读屏软件保留不可见的完成按钮；新建空白直接退出，不留下空笔记。已有内容继续沿用可靠本机保存后退出、失败保留输入的协议，清空既有文字的删除行为不变。原生 Android PWA 键盘弹出仍需真机验收；浏览器焦点和手势回归不替代该验收。不改变 API、笔记格式或数据库 schema。

## 阅读与编辑界面统一 · 2026-09-21

普通编辑与文字输入的右上动作均显示固定文案「完成」；无障碍名称仍分别说明完成编辑与完成文字输入。文字输入同时显示「正在输入文字 · 轻点空白处完成」，包括窄屏；空白轻点与现有键盘快捷键继续走可靠本机保存后退出的协议。这取代 #370 隐藏可见完成按钮的决定，不改变失败保留输入的行为。

手机（宽度不超过 640px）选中笔记后，由所选笔记属性替换主工具栏，避免两块浮栏叠放；「返回工具」取消选择，所选层的撤销与重做留在属性栏。触发历史操作前先提交未释放的属性调整，提交失败不继续撤销或重做。宽屏保留主工具栏上方的上下文属性栏。创建工具、所选属性和文字输入采用相同的移动端底栏宽度与基础两行结构；空间不足时允许换行，不裁掉操作。工具设置明确用于新笔记；文字对齐继续保持一点循环切换。

编辑图层选择器提供「显示参考笔记」和「管理个人层」，复用笔记图层面板，关闭后仍处于编辑模式。面板位于编辑浮栏之上，继续使用公共对话框的焦点与返回协议。显示订阅、编辑层和权限仍分别判断，进入面板不改变当前编辑目标。共享层显示色与个人笔记内容色仍保持原有语义。

本次收敛按钮、面板、色点、复选框和选中态的视觉语言，压缩图层选择与笔触设置的留白。不改变保存与阅读同步机制、笔记格式、API 或数据库 schema。预览已检查放大谱面、页底文字与低高度视口；真实软键盘与 Pencil 仍需真机验收。

## 普通访客只读与示例试写 · #378

普通云盘的访客只读；扫码后在文件列表说明注册/登录并加入可记录个人笔记、跨设备同步，阅读器点击编辑时提供登录入口和继续看谱。登录完成沿用当前访客加入流程，返回原云盘或乐谱。只有公开体验入口提供本机体验笔记，不提供成员加入，也不将体验笔记转入个人笔记。体验工作空间显式隔离，访客身份本身不再授予试写能力；普通成员离线编辑规则不变。不开发旧普通访客笔记的迁移、恢复或专用导出。

## 附件播放体验 · #413

主 PDF 普通打开仍遵循阅读器原有行为。明确打开可播放 XML 附件默认进入重排谱面；原 PDF/重排谱面切换保留会话，结束播放返回原 PDF。右下角统一附件入口保留附件语义，可播放内容以播放角标提示。播放条在顶沿提供拖动进度，下面仅一排控制，直接显示结束播放，不采用两行控制栏。重排谱面自动跟随允许主动滚动暂停与明确恢复；声部关注与独立混音沿用既有播放器规则；播放器现由本仓库的 `packages/player` 维护。短期内存准备缓存受身份、会话、云盘、附件和修订隔离，有容量与时效限制，使用前仍验证访问，不新增持久离线附件。

## 练习看谱控制统一 · #431

本节取代 #413 及早期附件播放段落中“显示谱面使用 select、结束位于底栏”的约定。练习会话使用跨手机、iPad 和桌面的共同顶部栏，直接选择「原始 PDF／重排谱面」，并提供「结束」。两种视图共用同一会话，结束恢复普通 PDF 阅读。底栏保留播放、前后定位、速度、练习设置与常驻位置；MusicXML 用带数字 1 的弧形箭头表示前后小节，录音用 10 表示前后十秒。拖动时预览目标位置，释放提交，取消不跳转；小节标号与展开重复后的播放次序分别表达。

练习中的 PDF 只浏览原谱及已有可见笔记，保留翻页、页码总览、双指缩放和平移，不唤起普通阅读器工具、附件入口或编辑。普通阅读器本身不另建实现；退出练习恢复原工具行为。播放小节不表示 PDF 页码，不提供自动翻页或 XML/PDF 坐标映射。

重排谱面默认采用 alphaTab 80% 排版比例，按可用宽度自动换行；不固定每行小节数。顶部提供缩小、放大及点击比例恢复默认，限制为 60%–120%。大小变化重新排版并更新数字坐标，保留播放状态、位置、混音，以及手动浏览时的可见系统和自动跟随状态。首调数字首次开启默认全部声部，用户指定范围后，本次会话开关保持选择。谱面大小和标注范围不引入新的持久偏好格式。

## 每次打开练习从头开始 · #431

每次明确选择可播放附件都创建新的播放会话，即使选择同一附件；MusicXML 从第一个播放小节、1×、默认混音、无声部关注开始。结束后再次打开或页面刷新不恢复之前的位置或练习设置。删除播放偏好读取/写入路径，已有 `same-page.practice:*` 值不再使用，不扫描或删除其他本机数据。保留同一次会话内 PDF／重排谱面切换及音频「边听边看谱」的连续播放；有界准备缓存仅复用文件解析结果，不保存用户的播放状态。普通 PDF 阅读位置沿用其自身契约。此决定取代此前跨次恢复练习偏好的约定。

## 重排密度修正 · #431

用户试用后确认 60% 下限不足以让密集六行合唱／钢琴谱排入更多小节，取代此前 80% 默认与 60% 下限：共用默认改为 60%，可调 30%–120%。较小比例是用户选择的全谱概览，不保证歌词在所有设备上可读。重排清除内存 score model 的源打印换行／分页约束，由可用宽度决定换行；不修改源 XML 或原 PDF，也不强制每行固定小节数。


## 统一练习控件与对照 · 2026-10-17

本节取代前述“顶部直接显示两个视图按钮”和“顶部放大缩小”的界面约定。
XML 会话共用当前视图菜单，提供原始 PDF／重排谱面／对照，保留直接结束操作。
对照不再分别显示谱面标题栏；PDF 页码及 XML 比例入口浮在各自谱面内，不预留竖向空间。
XML 单独显示和对照采用同一缩放行为：双指直接缩放，点击比例展开调整及恢复默认。
三种视图和音频看谱共用以播放键为几何中心的单排底栏：当前位置、速度在左，练习设置在右。
XML 底栏只显示源小节号，定位面板分别说明源小节号与播放次序／总数；音频显示时间。
进度条继续直接拖动；定位面板先选择、再跳转，不因修改草稿立即寻址。
比例、切换视图、打开浮层均保留同一播放会话，沿用原有权限、数据和生命周期边界。


Continuous editing now shares one `AnnotationPages` session across its mounted page overlays. This supersedes the earlier single-editable-page rule for continuous mode only. Each pointer note belongs to its origin page, ends at that page boundary, and cannot resume on re-entry or feed the same contact into another page. New contacts may edit either visible page. One reader editor retains the common write queue and per-layer undo history; input owner and viewport-center page are independent. Outgoing overlays remain pinned until their local queue settles. Text composition and active object gestures retain their owner, a second touch on another page joins the original object, and keyboard/properties/failure UI belong to one input page. Saving can queue released edits on another visible page, but failed local writes block leaving their input owner and retain all queued intent for explicit retry. Blank-page two-finger browsing interrupts unreleased ink/eraser previews through the shared session and still uses the existing local navigation admission. No saved-note, API or database format changes.


## Reuse preparation while retaining independent practice sessions · #551

An active practice session holds its immutable preparation; bounded idle retention
begins when the last session releases it. Complete source normalization and printed
measure labels can be reused, while every explicit open still creates a fresh
Score, renderer and sound instance with the existing default practice state.
Within that Score generation, the same MIDI and timing data are loaded when the
synth becomes ready rather than generated again; an explicit MIDI rebuild remains
available. This avoids retaining a live hidden player or sharing an old Score's
position references across sessions. Prepared objects remain memory-only under
ADR-0004; source files, annotations and practice preferences are unchanged.


## 循环选段与统一定位 · #567

循环范围以小节为单位，由 A/B 双端点选择，包含终点完整小节，允许单小节并保留反复经过标签。编辑为独立草稿：进入时暂停，拖动时只保留范围条与端点位置，其他设置及面板背景淡出，让用户透视重排谱面；松手恢复面板，应用后启用新范围并从 A 开始，取消或关闭恢复原范围及原浏览位置。应用与取消都恢复进入编辑前的播放状态。预览可超出旧循环范围，但不寻址音频；原 PDF 没有位置映射，开始选段时转到重排谱面。

所有实际定位通过同一会话边界：进度条、前后小节、定位面板、普通与放大点击都限制在循环区间；范围外点击吸附最近边界小节起点，不能取消引擎范围。底栏将有效片段作为完整进度范围；手动滚动浏览仍可越出范围，不改变播放位置。引擎原生的点击／划选会自行修改播放范围，因此由宿主统一处理命中并保留引擎的谱面、游标和范围高亮，避免出现界面与实际循环各持一份状态。

练习设置依次保留声部关注、折叠的独立混音、始终可见的循环状态与范围、谱面辅助和简短资源状态。本次不改变源文件、云数据、权限或持久偏好格式；关闭会话仍重置练习设置。此节补充 #431 的拖动契约：播放进度仍释放寻址，选段拖动只预览谱面，明确应用才改变循环。


## 平铺练习设置与即时循环调节 · 2026-10-26

本节取代前文的分类排列、循环草稿应用按钮和单小节预览约定。六个入口按声部关注、声部混音、片段循环、节拍器、跳转后预备一小节、首调数字平铺；名称、独立问号和右侧控件固定列对齐。功能说明按需打开，静音、独奏和离线状态继续直接显示。展开内容采用统一的缩进、轻底色与细边框；320px 窄屏混音将名称与控制分两行，为音量滑块保留操作空间。

声部关注、循环和首调数字采用开关，开启后直接显示详细设置。声部关注维持选定声部／其他声部的两组音量，关闭恢复独立音量，保留静音和独奏；本次会话内保留声部选择。声部混音使用折叠入口，收起继续生效，且不依赖声部关注。关注开启时其他声部的独立音量只读，静音与独奏仍可独立调节。

循环开关是唯一启停入口：首次开启默认整曲，关闭后本次会话内记住最后范围，再开启直接复用，收起面板不丢失。范围始终可调，不提供调整、应用或取消按钮。拖动时暂停并透视预览，释放后提交范围并恢复原播放状态；A/B 卡片合并端点选择和范围展示，逐小节微调立即提交。指针取消、Escape、失焦或面板卸载中断未完成拖动，保留生效范围；取消后的同一指针手势不能重新提交。

预览按播放次序收集整个待循环范围经过的谱面小节，同一印刷小节去重、同行相邻边界合并，跨行分别显示，单小节覆盖完整小节。视图只跟随正在调整的端点。预览期间清除原生的旧范围高亮，取消或提交后恢复实际生效范围的显示；不改变音频位置或实际循环范围，重新排版后按新坐标重建。预览 API 的范围参数可选，保留单参数调用兼容性。

练习设置只保留在本次会话，不修改云数据、源附件、schema 或持久偏好；新会话重置。


## 循环状态保持底栏布局稳定 · 2026-10-27

练习设置入口始终显示“练习”，循环开启时保留浅绿色选中外观与辅助范围描述。A/B 与小节范围仅在设置面板内展示，底栏不重复显示，避免范围文字将进度条推入按钮区域。循环开关不改变进度条、按钮位置或底栏高度；进度条仍表示生效循环片段，拖动、前后小节和其他定位入口继续遵循原有循环边界。
