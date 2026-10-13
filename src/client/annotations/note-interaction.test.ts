import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AnnotationPayload } from "../../shared/annotations";
import { localDatabase } from "../platform/local-database";
import { activateAuthenticatedLocalOwner, authenticatedLocalOwnerKey, createLocalWorkspace } from "../platform/local-workspace";
import { AnnotationEditor } from "./annotation-editor";
import { NoteInteraction } from "./note-interaction";

const layerId = "11111111-1111-4111-8111-111111111111";
const workspace = createLocalWorkspace(authenticatedLocalOwnerKey("interaction-user"), "drive", "score");
let editor: AnnotationEditor;
let notes: NoteInteraction;
const ink = (): Extract<AnnotationPayload, { kind: "ink" }> => ({ kind: "ink", brush: "pen", nib: "round", pressureMode: "uniform", pageNumber: 1, points: [{ x: .1, y: .1 }, { x: .1, y: .1 }], strokeWidth: .003 });
const saved = () => localDatabase.annotations.filter(note => !note.deleted).toArray();
beforeEach(async () => {
  await localDatabase.open();
  await localDatabase.delete();
  await localDatabase.open();
  await activateAuthenticatedLocalOwner("interaction-user");
  editor = new AnnotationEditor(workspace);
  editor.begin();
  notes = new NoteInteraction(editor);
});
afterEach(async () => { notes.dispose(); await editor.finish(); editor.cancel(); });

it("withdraws only the unreleased checkpoint and accepts a new gesture after handoff", async () => {
  notes.begin(1, layerId, ink(), 0);
  await notes.end("release", 1, { x: .2, y: .2 });
  const released = (await saved())[0]!;
  notes.begin(2, layerId, ink(), 0);
  notes.move(2, { x: .5, y: .5 }, 150);
  notes.checkpoint();
  await notes.end("interrupt");
  // A late release from the interrupted gesture must not release its successor.
  notes.begin(3, layerId, ink(), 200);
  await notes.end("release", 2, { x: .9, y: .9 });
  expect(notes.drawing).toBe(true);
  await notes.end("release", 3, { x: .3, y: .3 });
  expect(await editor.finish()).toBe("local-saved");
  const records = await saved();
  expect(records).toHaveLength(2);
  expect(records.find(note => note.id === released.id)?.payload).toEqual(released.payload);
  expect(records.map(note => note.payload)).not.toContainEqual(expect.objectContaining({ points: expect.arrayContaining([{ x: .5, y: .5 }]) }));
});

it("restores newly collected ink with compact coordinates, pressure and nonzero pen angles intact", async () => {
  const first = { x: .123456789, y: .987654321, pressure: .731234567, tiltX: 0, tiltY: 0, twist: 0 };
  notes.begin(1, layerId, { ...ink(), points: [first, first] }, 0);
  notes.move(1, { x: .333333333, y: .666666666, pressure: .612345678, tiltX: 12, tiltY: -8, twist: 35 }, 150);
  await notes.end("release", 1, { x: .444444444, y: .555555555, pressure: 0, tiltX: 0, tiltY: 0, twist: 0 });
  expect(await editor.finish()).toBe("local-saved");
  localDatabase.close();
  await localDatabase.open();
  const records = await saved();
  expect(records).toHaveLength(1);
  expect(records[0]!.payload).toMatchObject({ points: [
    { x: .12346, y: .98765, pressure: .731234567 },
    { x: .12346, y: .98765, pressure: .731234567 },
    { x: .33333, y: .66667, pressure: .612345678, tiltX: 12, tiltY: -8, twist: 35 },
    { x: .44444, y: .55556, pressure: 0 },
  ] });
  if (records[0]!.payload?.kind !== "ink") throw new Error("expected ink");
  expect(records[0]!.payload.points[0]).not.toHaveProperty("tiltX");
  expect(records[0]!.payload.points[0]).not.toHaveProperty("tiltY");
  expect(records[0]!.payload.points[0]).not.toHaveProperty("twist");
});

it.each(["pen", "highlighter"] as const)("retains a %s release sample whose pressure and rotation change inside one rounded coordinate cell", async brush => {
  const first = { x: .123451, y: .5, pressure: .2, twist: 0 };
  notes.begin(1, layerId, { ...ink(), brush, nib: brush === "highlighter" ? "chisel" : "round", points: [first, first] }, 0);
  await notes.end("release", 1, { x: .123454, y: .5, pressure: .9, twist: 90 });
  expect(await editor.finish()).toBe("local-saved");
  expect((await saved())[0]!.payload).toMatchObject({ points: [
    { x: .12345, y: .5, pressure: .2 },
    { x: .12345, y: .5, pressure: .2 },
    { x: .12345, y: .5, pressure: .9, twist: 90 },
  ] });
});

it("preserves collected ink on pointercancel without adding its final coordinates", async () => {
  notes.begin(1, layerId, ink(), 0);
  notes.move(1, { x: .4, y: .4 }, 150);
  await notes.end("pointercancel", 1, { x: .9, y: .9 });
  expect((await saved())[0]?.payload).toMatchObject({ points: [{ x: .1, y: .1 }, { x: .1, y: .1 }, { x: .4, y: .4 }] });
});

it.each(["interrupt", "pointercancel"] as const)("%s restores eraser targets and discards an unreleased shape", async reason => {
  notes.begin(1, layerId, ink(), 0);
  await notes.end("release", 1);
  const target = (await saved())[0]!;
  notes.begin(2, layerId, "eraser", 0);
  notes.erase(2, target.id);
  expect(notes.getSnapshot().erased.has(target.id)).toBe(true);
  await notes.end(reason, 2);
  expect(notes.getSnapshot().erased.size).toBe(0);
  notes.begin(3, layerId, { kind: "shape", shape: "rectangle", pageNumber: 1, x: .1, y: .1, width: 0, height: 0, strokeWidth: .003 }, 0);
  notes.move(3, { x: .5, y: .6 }, 50);
  expect(notes.getSnapshot().shape?.width).toBeCloseTo(.4);
  await notes.end(reason, 3);
  expect(await editor.finish()).toBe("local-saved");
  expect(await saved()).toEqual([expect.objectContaining({ id: target.id, payload: target.payload, deleted: false })]);
});

it("finishing submits the current eraser preview through durable editing completion", async () => {
  notes.begin(1, layerId, ink(), 0);
  await notes.end("release", 1);
  const target = (await saved())[0]!;
  notes.begin(2, layerId, "eraser", 0);
  notes.erase(2, target.id);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const persist = editor.persist.bind(editor);
  const delayed = vi.spyOn(editor, "persist").mockImplementationOnce(async (...args) => { await gate; return persist(...args); });
  const unregister = editor.registerFinishCommit(() => notes.end("finish"));
  const finishing = editor.finish();
  await vi.waitFor(() => expect(delayed).toHaveBeenCalledTimes(1));
  expect(notes.getSnapshot().erased.has(target.id)).toBe(true);
  release();
  expect(await finishing).toBe("local-saved");
  expect(notes.getSnapshot().erased.size).toBe(0);
  delayed.mockRestore();
  expect(await saved()).toHaveLength(0);
  unregister();
});
