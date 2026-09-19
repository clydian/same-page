import { ArrowDown, ArrowLeft, ArrowRight, MoveHorizontal, MoveVertical, Expand, Hand } from "lucide-react";
import { Button, Modal, ModalOverlay } from "react-aria-components";
import { Dialog } from "../navigation/overlays";

export function ReaderGuide({ layout, zoomed, onDismiss }: { layout: "page" | "continuous"; zoomed: boolean; onDismiss(): void }) {
  const edges = layout === "page" && !zoomed;
  return <ModalOverlay isOpen isKeyboardDismissDisabled className="reader-guide" onOpenChange={open => { if (!open) onDismiss(); }}>
    <Modal className="reader-guide__surface">
      <Dialog aria-label="阅读器使用指引" className="reader-guide__content">
        <header className="reader-guide__heading"><span>阅读指引</span><Button autoFocus onPress={onDismiss}>知道了</Button></header>
        <div className="reader-guide__zones" data-edges={edges || undefined}>
          {edges && <div><ArrowLeft size={26} aria-hidden="true" /><strong>轻点左侧</strong><span>上一页</span></div>}
          <div><Hand size={28} aria-hidden="true" /><strong>{edges ? "轻点中央" : "轻点谱面"}</strong><span>显示或收起工具栏</span></div>
          {edges && <div><ArrowRight size={26} aria-hidden="true" /><strong>轻点右侧</strong><span>下一页</span></div>}
        </div>
        <div className="reader-guide__gestures">
          {layout === "page" && <span><MoveHorizontal size={19} aria-hidden="true" /><strong>左右滑动</strong>切换页面</span>}
          <span><Expand size={19} aria-hidden="true" /><strong>双击谱面</strong>放大／恢复</span>
          {layout === "continuous"
            ? <span><MoveVertical size={19} aria-hidden="true" /><strong>上下滑动</strong>连续浏览</span>
            : <span><ArrowDown size={19} aria-hidden="true" /><strong>整页下滑</strong>关闭乐谱</span>}
        </div>
        {layout === "continuous" && <p className="reader-guide__detail">轻点谱面显示工具栏，使用返回按钮关闭乐谱。</p>}
        {layout === "page" && zoomed && <p className="reader-guide__detail">放大时拖动查看谱面；恢复整页后可下滑关闭。</p>}
      </Dialog>
    </Modal>
  </ModalOverlay>;
}
