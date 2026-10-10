import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PdfVersionPreview } from "./pdf-version-preview";

const identity = vi.hoisted(() => ({ user: "owner" as string | null, error: null as null | { status: number } }));
vi.mock("../auth/auth-client", () => ({ authClient: { useSession: () => ({ data: identity.user ? { user: { id: identity.user } } : null, isPending: false, error: identity.error }) } }));
vi.mock("../platform/local-workspace", () => ({
  currentLocalOwnerKey: async () => "user:owner",
  createLocalWorkspace: () => ({ ownerKey: "user:owner", choirId: "drive", scoreId: "score", scopeKey: "scope" }),
  assertLocalWorkspaceActive: async () => {},
}));
vi.mock("../reader/pdf-document", () => ({ loadPdfDocument: () => ({
  promise: Promise.resolve({ document: { numPages: 2, getPage: async () => ({ getViewport: () => ({ width: 600, height: 800 }) }) } }),
  destroy: vi.fn(),
}) }));
vi.mock("../reader/pdf-page", () => ({ PdfPageCanvas: ({ pageNumber }: { pageNumber: number }) => <canvas aria-label={`预览页 ${pageNumber}`} /> }));
vi.mock("../annotations/annotation-overlay", () => ({ AnnotationOverlay: () => null }));
afterEach(() => { identity.user = "owner"; identity.error = null; vi.unstubAllGlobals(); });

it("keeps the rendered PDF page through missing temporary session data and clears it on confirmed absence", async () => {
  vi.stubGlobal("fetch", vi.fn(async input => String(input).endsWith("/layers")
    ? Response.json({ layers: [], sharedLayerRevision: 0, permissions: { canManageLayers: false } })
    : Response.json({ objects: [], cursor: 0 })));
  const props = { scorePath: "/api/choirs/drive/scores/score", choirId: "drive", scoreId: "score", versionId: "candidate", onReady: vi.fn() };
  const view = render(<PdfVersionPreview {...props} />);
  await screen.findByLabelText("预览页 1");
  fireEvent.click(screen.getByRole("button", { name: "下一页" }));
  const canvas = await screen.findByLabelText("预览页 2");
  identity.user = null; identity.error = { status: 503 };
  view.rerender(<PdfVersionPreview {...props} />);
  expect(screen.getByLabelText("预览页 2")).toBe(canvas);
  identity.user = "owner"; identity.error = null;
  view.rerender(<PdfVersionPreview {...props} />);
  expect(screen.getByLabelText("预览页 2")).toBe(canvas);
  identity.user = null;
  view.rerender(<PdfVersionPreview {...props} />);
  expect(screen.queryByLabelText("预览页 2")).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("登录身份已变化");
});
