# 乐谱页几何 module

[`use-pdf-page-geometry.ts`](../../src/client/reader/use-pdf-page-geometry.ts) 集中 PDF 页宽高比的读取、缓存和订阅。翻页模式与缩略图调用 `usePdfPageAspectRatio`，连续滚动模式调用 `usePdfPageAspectRatios`。这两个 interface 也是测试 seam；内部 `PdfPageGeometry` 不向调用者暴露。

```text
翻页模式、缩略图 ── 按页读取 ──┐
                              ├─ 文档级页几何 module ── PDF.js getViewport
连续滚动模式 ─── 整份文档读取 ─┘
```

缓存按 `PDFDocumentProxy` 对象身份隔离，由 WeakMap 持有。按页读取不会预读其他页；整份文档读取复用已经成功或正在进行的同页请求。订阅在提交后启动读取；切换文档或页后，展示直接读取新目标的 snapshot，旧请求只能更新其原文档。取消订阅不取消其他消费者共享的元数据读取，也不销毁 PDF。

比例来自 PDF.js `getViewport({ scale: 1 })`，保留文档旋转后的宽高。宽、高和比例都必须有限且大于零。未就绪、读取失败或非法尺寸使用原有 `0.707` 回退；整份文档在所有页成功或回退后才给出完整比例列表。失败页不会自动循环重试，但后续消费者的新订阅可重试；成功页不重复读取，恢复结果同步通知当前文档的已有消费者。重试期间保留已给出的几何，不重新撤去连续布局的就绪状态。

调用者已提供比例时，不订阅或读取对应 PDF 页。元数据就绪不代表 canvas 已显示；module 不绘制或保留 canvas。分页按需读取和连续全量读取仍各有用途，不将二者统一为一个导航流程。缩放交接、页面定位、虚拟列表和编辑导航准入仍由原有 module 负责。

依据 [#364](https://github.com/clydian/same-page/issues/364)，遵守 [ADR-0010](../adr/0010-use-a-content-first-single-page-reader-shell.md) 和 [ADR-0013](../adr/0013-use-legacy-pdf-display.md)。没有持久化格式、同步协议或数据库迁移，也不完成 #318 的通用坐标转换模型。

## 验证

`use-pdf-page-geometry.test.tsx` 从上述 interface 验证共享读取、成功缓存、失败及非法尺寸的恢复、已知比例、文档/页切换和完整就绪。PDF.js 是外部 adapter，测试控制其元数据响应；没有 mock 内部 module。`use-continuous-reader-layout.test.tsx` 和现有 reader 展示、缩放浏览器测试继续验证布局、返回位置、混合页尺寸和交互。
