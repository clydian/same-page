import { fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReaderZoom, type ReaderZoomGeometry, type ReaderZoomGesture } from "./use-reader-zoom";

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 800, width: 600, height: 800, toJSON() {},
  });
});
afterEach(() => vi.restoreAllMocks());

function geometry() {
  const releases = [vi.fn(), vi.fn(), vi.fn()];
  const resolve = vi.fn(() => ({ x: 800, y: 400 }));
  const constrain = vi.fn();
  let count = 0;
  const adapter: ReaderZoomGeometry = {
    capture: () => ({
      anchor: { pageIndex: 0, ratio: 0.75, resolve, resolveCenter: resolve },
      release: releases[count++],
    }),
    constrain,
  };
  return { adapter, releases, resolve, constrain };
}
interface Props {
  zoom?: number;
  scope?: string;
  revision?: string;
  mode?: boolean;
  disabled?: boolean;
  navigation?: string;
  geometry: ReaderZoomGeometry;
  onZoomChange: (zoom: number) => void;
}
function Harness({ zoom = 1, scope = "document-a", revision = "page:1:fit:0:600x800",
  mode = false, disabled = false, navigation = "pager-a", geometry, onZoomChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const previewBoundaryRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<ReaderZoomGesture | null>(null);
  const previous = useRef<ReaderZoomGesture | null>(null);
  const handoff = useReaderZoom({ containerRef, contentRef, previewBoundaryRef, zoom, minimumZoom: 1,
    geometry, onZoomChange, continuous: false, scope, revision, mode, disabled, navigation });
  return <>
    <button onClick={() => { previous.current = gesture.current; gesture.current = handoff.begin({ x: 300, y: 200 }); }}>begin</button>
    <button onClick={() => gesture.current?.update({ x: 400, y: 200 }, 2)}>move</button>
    <button onClick={() => gesture.current?.finish()}>finish</button>
    <button onClick={() => { previous.current?.update({ x: 500, y: 300 }, 3); previous.current?.finish(); }}>old input</button>
    <button onClick={handoff.cancel}>cancel</button>
    <button onClick={() => handoff.doubleTap({ x: 400, y: 200 })}>double tap</button>
    <div ref={containerRef} data-testid="viewport"><div ref={previewBoundaryRef} data-testid="presentation"><div ref={contentRef} data-testid="content" /></div></div>
  </>;
}
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name, exact: true }));
const preview = () => { click("begin"); click("move"); };
const pending = () => { preview(); click("finish"); };

describe("reader zoom handoff", () => {
  it("keeps the lease through deferred layout and completes once without waiting for PDF paint", () => {
    const g = geometry(), onZoomChange = vi.fn();
    const props = { geometry: g.adapter, onZoomChange };
    const view = render(<Harness {...props} />);
    pending();
    expect(onZoomChange).toHaveBeenCalledExactlyOnceWith(2);
    expect(g.resolve).not.toHaveBeenCalled();
    expect(g.releases[0]).not.toHaveBeenCalled();
    expect(screen.getByTestId("content")).toHaveAttribute("data-gesture-preview");
    view.rerender(<Harness {...props} zoom={2} />);
    expect(screen.getByTestId("viewport").scrollLeft).toBe(400);
    expect(screen.getByTestId("viewport").scrollTop).toBe(200);
    expect(g.constrain).toHaveBeenCalledOnce();
    expect(g.releases[0]).toHaveBeenCalledExactlyOnceWith({ status: "committed", zoomChanged: true });
    expect(screen.getByTestId("content")).not.toHaveAttribute("data-gesture-preview");
    view.rerender(<Harness {...props} zoom={2} />);
    click("finish");
    expect(g.releases[0]).toHaveBeenCalledOnce();
  });

  it.each([
    { scope: "document-b" }, { mode: true }, { disabled: true }, { navigation: "pager-b" },
    { revision: "page:1:fit:0:800x600" }, { revision: "page:1:fit:1:600x800" },
    { revision: "page:2:fit:0:600x800" },
  ])("invalidates before matching a pending zoom on replacement %j", replacement => {
    const g = geometry(), onZoomChange = vi.fn();
    const props = { geometry: g.adapter, onZoomChange };
    const view = render(<Harness {...props} />);
    pending();
    view.rerender(<Harness {...props} zoom={2} {...replacement} />);
    expect(g.resolve).not.toHaveBeenCalled();
    expect(g.constrain).not.toHaveBeenCalled();
    expect(g.releases[0]).toHaveBeenCalledExactlyOnceWith({ status: "cancelled" });
    expect(screen.getByTestId("viewport").scrollLeft).toBe(0);
    expect(screen.getByTestId("content")).not.toHaveAttribute("data-gesture-preview");
    expect(screen.getByTestId("presentation")).not.toHaveAttribute("data-gesture-preview");
    click("finish");
    expect(onZoomChange).toHaveBeenCalledOnce();
  });

  it("cancels an obsolete anchor when the toolbar commits a different zoom", () => {
    const g = geometry(), onZoomChange = vi.fn();
    const props = { geometry: g.adapter, onZoomChange };
    const view = render(<Harness {...props} />);
    pending();
    view.rerender(<Harness {...props} zoom={1.25} />);
    view.rerender(<Harness {...props} zoom={2} />);
    expect(g.resolve).not.toHaveBeenCalled();
    expect(g.releases[0]).toHaveBeenCalledExactlyOnceWith({ status: "cancelled" });
  });

  it("makes old handles inert without releasing or repainting a newer session", () => {
    const g = geometry(), onZoomChange = vi.fn();
    const props = { geometry: g.adapter, onZoomChange };
    const view = render(<Harness {...props} />);
    pending();
    preview();
    expect(g.releases[0]).toHaveBeenCalledExactlyOnceWith({ status: "cancelled" });
    click("old input");
    expect(g.releases[1]).not.toHaveBeenCalled();
    expect(screen.getByTestId("content").style.getPropertyValue("--reader-gesture-scale")).toBe("2");
    expect(onZoomChange).toHaveBeenCalledOnce();
    click("finish");
    view.rerender(<Harness {...props} zoom={2} />);
    expect(g.releases[1]).toHaveBeenCalledExactlyOnceWith({ status: "committed", zoomChanged: true });
  });

  it("routes double tap through the same lease and pending layout cancellation", () => {
    const g = geometry(), onZoomChange = vi.fn();
    const props = { geometry: g.adapter, onZoomChange };
    const view = render(<Harness {...props} />);
    click("double tap");
    expect(onZoomChange).toHaveBeenCalledExactlyOnceWith(2);
    expect(g.releases[0]).not.toHaveBeenCalled();
    click("cancel");
    view.rerender(<Harness {...props} zoom={2} />);
    expect(g.resolve).not.toHaveBeenCalled();
    expect(g.releases[0]).toHaveBeenCalledExactlyOnceWith({ status: "cancelled" });
  });

  it.each([false, true])("cleans captured DOM and releases once on unmount (pending=%s)", finish => {
    const g = geometry();
    const view = render(<Harness geometry={g.adapter} onZoomChange={vi.fn()} />);
    preview();
    if (finish) click("finish");
    const content = screen.getByTestId("content"), presentation = screen.getByTestId("presentation");
    view.unmount();
    expect(content).not.toHaveAttribute("data-gesture-preview");
    expect(content.style.getPropertyValue("--reader-gesture-scale")).toBe("");
    expect(presentation).not.toHaveAttribute("data-gesture-preview");
    expect(g.releases[0]).toHaveBeenCalledExactlyOnceWith({ status: "cancelled" });
  });
});
