import { useLayoutEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "react-aria-components";
import type { PDFDocumentProxy } from "./pdf-document";
import { PdfPageCanvas } from "./pdf-page";
import { usePdfPageAspectRatio } from "./use-pdf-page-geometry";
import { useElementSize } from "./use-element-size";

const ROW_HEIGHT = 174;

export function ReaderPageGrid({ document, currentPage, onSelect }: {
  document: PDFDocumentProxy;
  currentPage: number;
  onSelect(page: number): void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const size = useElementSize(viewport);
  const columns = Math.max(2, Math.floor(size.width / 112));
  const initialPage = useRef(currentPage);
  // Only visible rows render PDF canvases, even for very long scores.
  // eslint-disable-next-line react-hooks/incompatible-library
  const rows = useVirtualizer({
    count: Math.ceil(document.numPages / columns),
    getScrollElement: () => viewport.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 1,
  });
  useLayoutEffect(() => {
    if (size.width > 0) rows.scrollToIndex(Math.floor((initialPage.current - 1) / columns), { align: "center" });
  }, [columns, size.width, rows]);
  return <div className="reader-page-grid" ref={viewport} tabIndex={0} aria-label="浏览所有页码">
    <div style={{ height: rows.getTotalSize(), position: "relative" }}>
      {rows.getVirtualItems().map(row => <div key={row.index} className="reader-page-grid__row"
        style={{ transform: `translateY(${row.start}px)`, height: ROW_HEIGHT, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {Array.from({ length: Math.min(columns, document.numPages - row.index * columns) }, (_, index) => {
          const page = row.index * columns + index + 1;
          return <Button key={page} className="reader-page-grid__page" aria-label={`第 ${page} 页`}
            aria-current={page === currentPage ? "page" : undefined} onPress={() => onSelect(page)}>
            <GridThumbnail document={document} page={page} />
            <span>{page}</span>
          </Button>;
        })}
      </div>)}
    </div>
  </div>;
}

function GridThumbnail({ document, page }: { document: PDFDocumentProxy; page: number }) {
  const aspectRatio = usePdfPageAspectRatio(document, page);
  return <div className="reader-page-grid__paper" aria-hidden="true">
    <PdfPageCanvas document={document} pageNumber={page} presentation={false}
      width={Math.min(88, 116 * aspectRatio)} aspectRatio={aspectRatio} />
  </div>;
}
