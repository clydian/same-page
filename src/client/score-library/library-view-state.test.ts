import { afterEach, expect, it, vi } from "vitest";
import { librarySortDirection, readLibraryView, recordScoreOpened, rememberLibraryView, selectLibraryScores } from "./library-view-state";
import type { ScoreSummary } from "../../shared/scores";

const owner = "user:sort-test", drive = "drive";
const scores: ScoreSummary[] = [2, 10, 1].map(number => ({
  id: `score-${number}`, choirId: drive, fileName: `排练 ${number}.pdf`, updatedAt: number,
  currentVersion: { id: `version-${number}`, versionNumber: 1, sizeBytes: 20, sha256: "a".repeat(64), etag: "test", pageCount: 1, createdAt: 1 },
}));
afterEach(() => { window.sessionStorage.clear(); window.localStorage.clear(); vi.restoreAllMocks(); });

it("reads old device views unchanged and defaults name/time directions compatibly", () => {
  rememberLibraryView(owner, drive, { search: "排练", sort: "updated", scrollTop: 240 });
  const old = readLibraryView(owner, drive);
  expect(old).toEqual({ search: "排练", sort: "updated", scrollTop: 240 });
  expect(librarySortDirection(old)).toBe("desc");
  expect(librarySortDirection({ sort: "name" })).toBe("asc");
});

it("retains each basis's direction without sharing state across drives or users", () => {
  rememberLibraryView(owner, drive, { search: "排练", sort: "updated", scrollTop: 240, sortDirections: { name: "desc", updated: "asc" } });
  const view = readLibraryView(owner, drive);
  expect(librarySortDirection(view)).toBe("asc");
  expect(librarySortDirection({ ...view, sort: "name" })).toBe("desc");
  expect(readLibraryView(owner, "other").sortDirections).toBeUndefined();
  expect(readLibraryView("user:other", drive).sortDirections).toBeUndefined();
});

it("sorts names naturally and reverses times and recorded opens while filtering locally", () => {
  const names = (sort: "name" | "updated" | "opened", direction: "asc" | "desc") => selectLibraryScores(scores, "排练", sort, owner, drive, direction).map(score => score.id);
  expect(names("name", "asc")).toEqual(["score-1", "score-2", "score-10"]);
  expect(names("name", "desc")).toEqual(["score-10", "score-2", "score-1"]);
  expect(names("updated", "desc")).toEqual(["score-10", "score-2", "score-1"]);
  expect(names("updated", "asc")).toEqual(["score-1", "score-2", "score-10"]);
  vi.spyOn(Date, "now").mockReturnValueOnce(100).mockReturnValueOnce(200);
  recordScoreOpened(owner, drive, "score-10"); recordScoreOpened(owner, drive, "score-2");
  expect(names("opened", "desc")).toEqual(["score-2", "score-10", "score-1"]);
  expect(names("opened", "asc")).toEqual(["score-1", "score-10", "score-2"]);
  expect(selectLibraryScores(scores, "不存在", "name", owner, drive)).toEqual([]);
});
