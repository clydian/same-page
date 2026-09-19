import { ArrowDown, ArrowLeft, ArrowRight, Expand, Hand } from "lucide-react";
import { Button } from "react-aria-components";

export function ReaderGuide({ layout, zoomed, onDismiss }: { layout: "page" | "continuous"; zoomed: boolean; onDismiss(): void }) {
  const edges = layout === "page" && !zoomed;
  return <aside className="reader-guide" aria-label="阅读器使用指引">
    <div className="reader-guide__zones" aria-hidden="true" data-edges={edges || undefined}>
      {edges && <div><ArrowLeft size={22} /><strong>上一页</strong><span>轻点左侧</span></div>}
      <div><Hand size={23} /><strong>{edges ? "轻点中央" : "轻点谱面"}</strong><span>显示或收起工具栏</span></div>
      {edges && <div><ArrowRight size={22} /><strong>下一页</strong><span>轻点右侧</span></div>}
    </div>
    <div className="reader-hint reader-guide__card" role="status">
      <div className="reader-guide__heading"><span>阅读小提示</span><Button onPress={onDismiss}>知道了</Button></div>
      <p>{edges ? "轻点两侧翻页，轻点中央显示工具栏。" : "轻点谱面显示或收起工具栏。"}</p>
      <div className="reader-guide__gestures"><span><ArrowRight size={16} />左右滑动翻页</span><span><Expand size={16} />双击放大／恢复</span><span><ArrowDown size={16} />{layout === "continuous" ? "顶部下拉关闭" : "整页下滑关闭"}</span></div>
      {layout === "continuous" && <p className="reader-guide__detail">上下滑动连续浏览；放大时拖动查看谱面。</p>}
    </div>
  </aside>;
}
