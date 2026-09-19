import { ArrowDown, ArrowLeft, ArrowRight, Expand, Hand } from "lucide-react";
import { Button, Modal, ModalOverlay } from "react-aria-components";
import { Dialog } from "../navigation/overlays";

export function ReaderGuide({ layout, zoomed, onDismiss }: { layout: "page" | "continuous"; zoomed: boolean; onDismiss(): void }) {
  const edges = layout === "page" && !zoomed;
  return <ModalOverlay isOpen isKeyboardDismissDisabled className="reader-guide" onOpenChange={open => { if (!open) onDismiss(); }}>
    <Modal className="reader-guide__surface">
      <Dialog aria-label="阅读器使用指引" className="reader-guide__content">
        <header className="reader-guide__heading"><span>阅读指引</span><Button autoFocus onPress={onDismiss}>知道了</Button></header>
        <div className="reader-guide__zones" data-edges={edges || undefined}>
          {edges && <div><ArrowLeft size={26} aria-hidden="true" /><strong>上一页</strong><span>轻点左侧</span></div>}
          <div><Hand size={28} aria-hidden="true" /><strong>{edges ? "轻点中央" : "轻点谱面"}</strong><span>显示或收起工具栏</span></div>
          {edges && <div><ArrowRight size={26} aria-hidden="true" /><strong>下一页</strong><span>轻点右侧</span></div>}
        </div>
        <div className="reader-guide__gestures">
          <span><ArrowRight size={19} aria-hidden="true" /><strong>左右滑动</strong>切换页面</span>
          <span><Expand size={19} aria-hidden="true" /><strong>双击谱面</strong>放大／恢复</span>
          <span><ArrowDown size={19} aria-hidden="true" /><strong>{layout === "continuous" ? "顶部下拉" : "整页下滑"}</strong>关闭乐谱</span>
        </div>
        {layout === "continuous" && <p className="reader-guide__detail">上下滑动连续浏览；放大时拖动查看谱面。</p>}
        {layout === "page" && zoomed && <p className="reader-guide__detail">放大时拖动查看谱面；恢复整页后可下滑关闭。</p>}
      </Dialog>
    </Modal>
  </ModalOverlay>;
}
