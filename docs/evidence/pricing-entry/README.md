# 价格入口收敛：浏览器前后对照

基线：`05b2951748119544426f4417a0a6da0f2c1ce370`（从最新 main 分支创建）。

实际 Chromium，1280×900，zh-CN，reduced motion，阻止 Service Worker；运行 `npm run preview:drive-entry`，通过 Playwright 使用 `visual-report/fixtures.mjs` 的 API 合成数据。首页使用 guest；云盘列表及关于页使用 member，列表补充第二个合成云盘以避免单云盘自动跳转。无生产用户数据。

首页与列表滚动到页尾；关于页前后均滚动至 y=200。图片为原始 viewport 截图，已逐张打开检查。

- `home-before.png` / `home-after.png`：未登录公开首页，价格、条款、退款继续作为普通链接。
- `drives-before.png` / `drives-after.png`：云盘列表共用页尾，移除收费筹备相关链接，帮助、关于、隐私、语言保留。
- `about-before.png` / `about-after.png`：移除价格筹备卡片，保留其他支持入口。

实际浏览器定向断言通过：首页三个政策链接；云盘/关于没有对应链接；页尾帮助、关于、隐私和语言选择存在；直接打开 /pricing、/terms、/refunds，政策导航到隐私，再从隐私进入价格页正常。线路链接的原有条件与代码未改。
