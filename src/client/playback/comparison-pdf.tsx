import { useState } from 'react';
import { ContinuousLayout, PageNavigatorPanel, type AnnotationPageProps } from '../reader/reader-layouts';
import type { PDFDocumentProxy } from '../reader/pdf-document';

type Props = {
  active: boolean; document: PDFDocumentProxy; initialPage: number; annotationProps: AnnotationPageProps;
};

export function ComparisonPdf(props: Props) {
  const [opened, setOpened] = useState(props.active);
  if (props.active && !opened) setOpened(true);
  return opened ? <ComparisonPdfContent {...props} /> : null;
}

function ComparisonPdfContent({ active, document, initialPage, annotationProps }: Props) {
  // Keep the normal reader's page, zoom and stored layout independent of comparison.
  const [page, setPage] = useState(initialPage);
  const [zoom, setZoom] = useState(1);
  return <section className="practice-comparison-pdf" data-visible={active || undefined} aria-label="对照原始 PDF" aria-hidden={!active} inert={!active}>
    <div className="practice-pane-heading">原始 PDF</div>
    <PageNavigatorPanel document={document} currentPage={page} compact onSelect={setPage} />
    <div className="practice-comparison-pdf-stage">
      <ContinuousLayout document={document} currentPage={page} zoom={zoom}
        viewportName="practice-comparison" onZoomChange={setZoom} onPageChange={setPage} onToggleChrome={() => {}}
        annotationProps={{ ...annotationProps, editing: false }} />
    </div>
  </section>;
}
