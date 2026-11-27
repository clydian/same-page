import { describe, expect, it } from "vitest";

import type { AnnotationConflictRecord } from "../platform/local-database";
import {
  authenticatedLocalOwnerKey,
  createLocalWorkspace,
} from "../platform/local-workspace";
import {
  deriveReaderSyncStatus,
  describeAnnotationConflict,
} from "./reader-sync-status";

const quiet = {
  outcome: "none" as const,
  loaded: true,
  syncing: false,
  pendingCount: 0,
  conflictCount: 0,
  syncErrorCount: 0,
};

describe("reader sync status", () => {
  it("does not claim an upload when an empty score only checks the cloud", () => {
    expect(deriveReaderSyncStatus({ ...quiet, loaded: false }).message).toContain("尚未确认");
    expect(deriveReaderSyncStatus({ ...quiet, outcome: "synced" }).message).toBe("尚无笔记修改");
    expect(deriveReaderSyncStatus({ ...quiet, acceptedCount: 2 }).message).toBe("没有待上传的修改");
  });

  it("distinguishes local persistence, queued work and real requests", () => {
    expect(deriveReaderSyncStatus({ ...quiet, draftCount: 1 }).message).toBe("已保存在本机 · 完成编辑后同步");
    expect(deriveReaderSyncStatus({ ...quiet, pendingCount: 2, online: false }).message).toBe("已保存在本机 · 等待联网");
    expect(deriveReaderSyncStatus({ ...quiet, pendingCount: 2, syncing: true }).message).toBe("正在同步 2 项修改");
    expect(deriveReaderSyncStatus({ ...quiet, pendingCount: 1, acceptedCount: 2 }).kind).toBe("pending");
  });

  it("keeps conflicts and revoked grants actionable even during other sync", () => {
    expect(deriveReaderSyncStatus({ ...quiet, conflictCount: 1, syncing: true }).kind).toBe("conflict");
    expect(deriveReaderSyncStatus({ ...quiet, syncErrorCount: 1, permissionErrorCount: 1 }).message).toContain("编辑权已撤销");
    expect(deriveReaderSyncStatus({ ...quiet, outcome: "failed" }).message).toBe("本机操作未完成，请重试。");
    expect(deriveReaderSyncStatus({ ...quiet, syncErrorCount: 1, online: false })).toMatchObject({
      kind: "failed", message: "本机笔记已保存，但有修改未能上传。", dismissible: true,
    });
    expect(deriveReaderSyncStatus({ ...quiet, cloudAvailability: "denied", online: false }).kind).toBe("risk");
  });
  it("keeps an unavailable cloud read separate from durable edits and unknown local data", () => {
    const unavailable = { ...quiet, cloudAvailability: "unavailable" as const, outcome: "sync-attempt-failed" as const };
    expect(deriveReaderSyncStatus(unavailable)).toEqual({ kind: "unavailable", message: "暂时无法检查云端笔记。" });
    expect(deriveReaderSyncStatus({ ...unavailable, online: false }).kind).toBe("quiet");
    expect(deriveReaderSyncStatus({ ...unavailable, pendingCount: 1 }).kind).toBe("pending");
    expect(deriveReaderSyncStatus({ ...unavailable, loaded: false, checkingLocal: true }).kind).toBe("quiet");
    expect(deriveReaderSyncStatus({ ...unavailable, loaded: false }).kind).toBe("risk");
  });

  it("describes a persisted conflict by page, layer and a safe summary", () => {
    const workspace = createLocalWorkspace(
      authenticatedLocalOwnerKey("user-1"),
      "choir-1",
      "score-1",
    );
    const conflict = {
      opId: "op-1",
      ...workspace,
      annotationId: "annotation-1",
      layerId: "layer-1",
      localPayload: {
        kind: "text",
        pageNumber: 7,
        x: 0.1,
        y: 0.2,
        fontScale: 0.024,
        text: "这是一条很长的笔记文字，用来确认摘要不会无限暴露完整内容。",
      },
      localDeleted: false,
      canonical: null,
      createdAt: 1,
    } satisfies AnnotationConflictRecord;

    expect(describeAnnotationConflict(conflict, "G")).toEqual({
      pageNumber: 7,
      layerName: "G",
      summary: "这是一条很长的笔记文字，用来确认摘要不会无限暴露完整内容…",
    });
  });
});
