# Chorus Player artifact

`itscly2026-chorus-player-0.1.0.tgz` 来自独立 Chorus 仓库的共享播放器包：

- 源码：https://github.com/itscly2026/chorus-score-studio/tree/dc9e14728157183e672abe8abe95ebe353825f72/packages/player
- 提交：`dc9e14728157183e672abe8abe95ebe353825f72`
- 构建：Node 24，源码仓库执行 `npm ci`，然后 `npm pack --workspace @itscly2026/chorus-player`
- 安装：本仓库执行 `npm install ./vendor/itscly2026-chorus-player-0.1.0.tgz`

包只含编译后的模块、类型及 README；不含曲库、房间或用户数据。锁文件固定压缩包完整性及传递依赖。生产构建不读取相邻仓库，也不调用 Chorus 网站。修复先在 Chorus 中完成，后续发布递增包版本并更新本文件与锁文件。
