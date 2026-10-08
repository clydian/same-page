import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { PDFDocumentProxy } from "./pdf-document";
import { usePdfPageAspectRatio, usePdfPageAspectRatios } from "./use-pdf-page-geometry";

it("shares pending page metadata with the whole document and reuses successful geometry", async () => {
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  const getPage = vi.fn(async (page: number) => {
    await ready;
    return { getViewport: () => ({ width: page === 1 ? 600 : 1200, height: 800 }) };
  });
  const document = { numPages: 2, getPage } as unknown as PDFDocumentProxy;
  const page = renderHook(() => usePdfPageAspectRatio(document, 1));
  await waitFor(() => expect(getPage).toHaveBeenCalledTimes(1));
  const all = renderHook(() => usePdfPageAspectRatios(document));
  expect(all.result.current).toEqual([]);
  await act(async () => release());
  await waitFor(() => expect(all.result.current).toEqual([0.75, 1.5]));
  expect(page.result.current).toBe(0.75);
  expect(getPage).toHaveBeenCalledTimes(2);
  page.unmount(); all.unmount();
  const reopened = renderHook(() => usePdfPageAspectRatio(document, 2));
  expect(reopened.result.current).toBe(1.5);
  expect(getPage).toHaveBeenCalledTimes(2);
});

it("settles failed metadata with a fallback and shares recovery on a later subscription", async () => {
  let failed = true;
  const getPage = vi.fn(async (page: number) => {
    if (page === 2 && failed) throw new Error("metadata unavailable");
    return { getViewport: () => ({ width: page === 1 ? 600 : 1200, height: 800 }) };
  });
  const document = { numPages: 2, getPage } as unknown as PDFDocumentProxy;
  const all = renderHook(() => usePdfPageAspectRatios(document));
  await waitFor(() => expect(all.result.current).toEqual([0.75, 0.707]));
  expect(getPage).toHaveBeenCalledTimes(2);
  all.rerender();
  expect(getPage).toHaveBeenCalledTimes(2);
  failed = false;
  const page = renderHook(() => usePdfPageAspectRatio(document, 2));
  await waitFor(() => expect(page.result.current).toBe(1.5));
  expect(all.result.current).toEqual([0.75, 1.5]);
  expect(getPage).toHaveBeenCalledTimes(3);
});

it("uses finite positive geometry and retries invalid metadata without caching it as success", async () => {
  const sizes = [[600, 0], [-600, -800], [Infinity, 800], [NaN, 800], [600, -800], [0, 800], [600, Infinity], [Number.MAX_VALUE, Number.MIN_VALUE]];
  const getPage = vi.fn(async (page: number) => ({ getViewport: () => ({ width: sizes[page - 1][0], height: sizes[page - 1][1] }) }));
  const document = { numPages: sizes.length, getPage } as unknown as PDFDocumentProxy;
  const all = renderHook(() => usePdfPageAspectRatios(document));
  await waitFor(() => expect(all.result.current).toEqual([0.707, 0.707, 0.707, 0.707, 0.707, 0.707, 0.707, 0.707]));
  sizes[0] = [800, 400];
  const page = renderHook(() => usePdfPageAspectRatio(document, 1));
  await waitFor(() => expect(page.result.current).toBe(2));
  expect(all.result.current[0]).toBe(2);
  expect(getPage).toHaveBeenCalledTimes(9);
});

it("uses supplied geometry without loading and reads when the supplied geometry is removed", async () => {
  const getPage = vi.fn(async () => ({ getViewport: () => ({ width: 800, height: 400 }) }));
  const document = { numPages: 1, getPage } as unknown as PDFDocumentProxy;
  const initialProps: { known?: number } = { known: 1.25 };
  const view = renderHook(({ known }: { known?: number }) => usePdfPageAspectRatio(document, 1, known), { initialProps });
  expect(view.result.current).toBe(1.25);
  expect(getPage).not.toHaveBeenCalled();
  view.rerender({ known: undefined });
  await waitFor(() => expect(view.result.current).toBe(2));
  expect(getPage).toHaveBeenCalledTimes(1);
});

it("does not expose a previous document or page while replacement metadata is pending", async () => {
  const first = deferred();
  const second = deferred();
  const old = { numPages: 2, getPage: async () => {
    await first.promise;
    return { getViewport: () => ({ width: 400, height: 800 }) };
  } } as unknown as PDFDocumentProxy;
  const next = { numPages: 2, getPage: async (page: number) => {
    await second.promise;
    return { getViewport: () => ({ width: page === 1 ? 1200 : 800, height: 800 }) };
  } } as unknown as PDFDocumentProxy;
  const view = renderHook(({ document, page }) => ({
    page: usePdfPageAspectRatio(document, page), all: usePdfPageAspectRatios(document),
  }), { initialProps: { document: old, page: 1 } });
  view.rerender({ document: next, page: 2 });
  await act(async () => first.resolve());
  expect(view.result.current).toEqual({ page: 0.707, all: [] });
  await act(async () => second.resolve());
  expect(view.result.current).toEqual({ page: 1, all: [1.5, 1] });
  view.rerender({ document: next, page: 1 });
  expect(view.result.current.page).toBe(1.5);
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(complete => { resolve = complete; });
  return { promise, resolve };
}

it("keeps an unresolved page selected when the previous page finishes first", async () => {
  const first = deferred();
  const second = deferred();
  const document = { numPages: 2, getPage: async (page: number) => {
    await (page === 1 ? first : second).promise;
    return { getViewport: () => ({ width: page === 1 ? 600 : 1200, height: 800 }) };
  } } as unknown as PDFDocumentProxy;
  const view = renderHook(({ page }) => usePdfPageAspectRatio(document, page), { initialProps: { page: 1 } });
  view.rerender({ page: 2 });
  const all = renderHook(() => usePdfPageAspectRatios(document));
  await act(async () => first.resolve());
  expect(view.result.current).toBe(0.707);
  expect(all.result.current).toEqual([]);
  await act(async () => second.resolve());
  expect(view.result.current).toBe(1.5);
  expect(all.result.current).toEqual([0.75, 1.5]);
});
