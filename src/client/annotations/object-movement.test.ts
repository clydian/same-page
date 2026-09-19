import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { localDatabase } from "../platform/local-database";
import { activateAuthenticatedLocalOwner, authenticatedLocalOwnerKey, createLocalWorkspace } from "../platform/local-workspace";
import { readScoreAnnotationState } from "./annotation-state";
import { AnnotationEditor } from "./annotation-editor";
import { ObjectMovement, type MovablePayload } from "./object-movement";

const workspace = createLocalWorkspace(authenticatedLocalOwnerKey("movement"), "drive", "score");
const text: MovablePayload = { kind: "text", pageNumber: 1, text: "换气", x: .2, y: .3, fontScale: .024 };
const bounds = { width: 100, height: 100 };
const pointer = (pointerId: number, clientX: number, clientY: number) => ({ pointerId, clientX, clientY });
let editor: AnnotationEditor;
let movement: ObjectMovement;
let unsubscribe: () => void;

beforeEach(async () => {
  await localDatabase.delete();
  await localDatabase.open();
  await activateAuthenticatedLocalOwner("movement");
  editor = new AnnotationEditor(workspace);
  editor.begin();
  await editor.persist({ id: "note", layerId: "personal", payload: text });
  movement = new ObjectMovement(editor);
  unsubscribe = movement.subscribe(() => {});
  await projectLocalQuery();
});
afterEach(() => { unsubscribe(); editor.cancel(); vi.restoreAllMocks(); });

async function projectLocalQuery() {
  const { annotations } = await readScoreAnnotationState(workspace);
  movement.reconcile(annotations);
}
function target() {
  const note = movement.getSnapshot().annotations.find(note => note.id === "note")!;
  if (note.payload?.kind !== "text" && note.payload?.kind !== "shape") throw new Error("Expected movable note");
  return { id: note.id, layerId: note.layerId, payload: note.payload };
}
function displayed() { return movement.getSnapshot().annotations.find(note => note.id === "note")?.payload; }
function drag(from: number, to: number) {
  movement.begin(pointer(1, from, 30), target());
  movement.move(pointer(1, to, 30), bounds);
  movement.release(1);
}

it("retains released movement through failed local save, retry and undo when the query skips intermediate positions", async () => {
  const write = vi.spyOn(localDatabase.annotations, "put").mockRejectedValueOnce(new Error("storage full"));
  drag(20, 60);
  await waitFor(() => expect(editor.getSnapshot()).toBe("failed"));
  expect(displayed()).toMatchObject({ x: expect.closeTo(.6), y: expect.closeTo(.3) });
  write.mockRestore();
  expect(await editor.retry()).toBe(true);
  expect(displayed()).toMatchObject({ x: expect.closeTo(.6) });
  // No query delivery of the dragged position, even after retry.
  expect(await editor.undo("personal")).toBe(true);
  expect(displayed()).toMatchObject({ x: expect.closeTo(.2) });
  await projectLocalQuery();
  expect(displayed()).toMatchObject({ x: expect.closeTo(.2) });
  expect(await editor.redo("personal")).toBe(true);
  await projectLocalQuery();
  expect(displayed()).toMatchObject({ x: expect.closeTo(.6) });
});

it("cancels only the active gesture while retaining the previous released movement", async () => {
  drag(20, 50);
  await waitFor(() => expect(editor.getSnapshot()).toBe("idle"));
  movement.begin(pointer(2, 50, 30), target());
  movement.move(pointer(2, 80, 30), bounds);
  expect(movement.getSnapshot().preview?.payload).toMatchObject({ x: expect.closeTo(.8) });
  movement.cancel();
  expect(movement.engaged).toBe(false);
  expect(movement.release(2)).toBeNull();
  expect(movement.getSnapshot().preview).toBeNull();
  expect(displayed()).toMatchObject({ x: expect.closeTo(.5) });
  await projectLocalQuery();
  expect(displayed()).toMatchObject({ x: expect.closeTo(.5) });
  expect(await editor.undo("personal")).toBe(true);
  await projectLocalQuery();
  expect(displayed()).toMatchObject({ x: expect.closeTo(.2) });
});

it("keeps the original object when another finger lands on another note and saves only on final release", async () => {
  movement.begin(pointer(1, 20, 30), target());
  movement.begin(pointer(2, 40, 30), { id: "other", layerId: "other-layer", payload: text });
  movement.move(pointer(2, 60, 30), bounds);
  expect(movement.getSnapshot().preview).toMatchObject({ id: "note", payload: { x: expect.closeTo(.3), fontScale: expect.closeTo(.048) } });
  expect(movement.release(2)).toBeNull();
  expect(movement.engaged).toBe(true);
  await projectLocalQuery();
  expect(displayed()).toMatchObject({ x: expect.closeTo(.2), fontScale: expect.closeTo(.024) });
  movement.move(pointer(1, 30, 30), bounds);
  movement.release(1);
  await waitFor(() => expect(editor.getSnapshot()).toBe("idle"));
  await projectLocalQuery();
  expect(displayed()).toMatchObject({ x: expect.closeTo(.4), fontScale: expect.closeTo(.048) });
  expect(movement.getSnapshot().annotations.map(note => note.id)).toEqual(["note"]);
  expect(await editor.undo("personal")).toBe(true);
  await projectLocalQuery();
  expect(displayed()).toMatchObject({ x: expect.closeTo(.2), fontScale: expect.closeTo(.024) });
});

it("returns a tap within the threshold and ignores unrelated pointers", () => {
  const original = target();
  movement.begin(pointer(1, 20, 30), original);
  movement.move(pointer(2, 70, 30), bounds);
  expect(movement.release(2)).toBeNull();
  expect(movement.owns(1)).toBe(true);
  movement.move(pointer(1, 26, 30), bounds);
  expect(movement.getSnapshot().transforming).toBe(false);
  expect(movement.release(1)).toEqual(original);
  expect(editor.getSnapshot()).toBe("idle");
});

it("scales shapes within the page and deletes with one undoable final release", async () => {
  await editor.persist({ id: "note", layerId: "personal", payload: { kind: "shape", shape: "ellipse", pageNumber: 1, x: .2, y: .3, width: .2, height: .1, strokeWidth: .003 } });
  await projectLocalQuery();
  movement.begin(pointer(1, 20, 30), target());
  movement.begin(pointer(2, 40, 30));
  movement.move(pointer(2, 240, 30), bounds);
  expect(movement.getSnapshot().preview?.payload).toMatchObject({ x: 0, y: 0, width: 1, height: 1 });
  movement.cancel();
  movement.begin(pointer(3, 20, 30), target());
  movement.move(pointer(3, 50, 90), bounds, { left: 40, top: 80, width: 20, height: 20 });
  expect(movement.getSnapshot().deleteActive).toBe(true);
  movement.release(3);
  await waitFor(() => expect(editor.getSnapshot()).toBe("idle"));
  await projectLocalQuery();
  expect(displayed()).toBeUndefined();
  expect(await editor.undo("personal")).toBe(true);
  await projectLocalQuery();
  expect(displayed()).toMatchObject({ kind: "shape", x: expect.closeTo(.2), y: expect.closeTo(.3), width: .2, height: .1 });
});

it("hands projection back to the query after acknowledgement and can explicitly discard a failed movement", async () => {
  drag(20, 60);
  await waitFor(() => expect(editor.getSnapshot()).toBe("idle"));
  await projectLocalQuery();
  expect(displayed()).toMatchObject({ x: expect.closeTo(.6) });
  const records = movement.getSnapshot().annotations;
  movement.reconcile(records.map(note => ({ ...note, payload: { ...text, x: .8 } })));
  expect(displayed()).toMatchObject({ x: expect.closeTo(.8) });
  const write = vi.spyOn(localDatabase.annotations, "put").mockRejectedValueOnce(new Error("storage full"));
  drag(80, 90);
  await waitFor(() => expect(editor.getSnapshot()).toBe("failed"));
  expect(displayed()).toMatchObject({ x: expect.closeTo(.9) });
  expect(editor.discard("note")).toBe(true);
  movement.discard("note");
  expect(displayed()).toMatchObject({ x: expect.closeTo(.8) });
  write.mockRestore();
});
