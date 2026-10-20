# player 0.1.19-samepage.6 / native 1.8.4-samepage.7

修复 #499：原谱 MusicXML tenuto 明确 placement=above/below 被原生导入/排版忽略。公开 Note.tenutoPlacement、clone/Worker JSON 与原生 effect band/glyph 保留显式位置；缺省沿原有符干自动布局。只处理 tenuto，不泛化其它 articulation 或自定义坐标。

- Native source afe9089e99ed6044a1dc0030c14a149be44ddcd6，独立 fullclone/Node24/npmci/ESM+UMD+Vite+Webpack；完整修改源、patch、MPL与通知随包并公开复制。
- Player source 29038c72b4753a94faad4aec07dc9a36f369b237，Chorus PR21 squashmain0b20fe856883945cf571ff3f48e156d5b8dbdc30 全tree相同；22runtimeJS/audio源哈希与上一版本逐字节一致。旧包与24公开源文件保留，精确SHA见manifest。
- Native12owned/147相关及类型/build通过；Chorus358tests/types/build/PWA通过；正式两tar真正独立npmci，35输入158073个MIDI事件字段/order/grid/ticks一致；2owned+33frozen默认SVG两布局字节/几何一致；Chromium/WebKit实际prepareWorker→native renderWorker/JSON/上下注记glyph及望春风11通过。
- 本次新增installed测试首轮错误地按literalUnicode搜索SVGdecimalentities，已保留失败和实际SVG后只更正断言；ChorusCI首轮npmci ECONNRESET未到测试，精确failed一次重试成功。

不改原谱音高/时值/文字，未声称听音或全谱质量验收。既有单头多outgoing phrase限制#498独立保留。
