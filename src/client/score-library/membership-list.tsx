import { useEffect, useState } from "react";
import { Button } from "react-aria-components";
import { Link } from "react-router-dom";

import {
  choirMembershipsResponseSchema,
  type MembershipSummary,
} from "../../shared/choirs";
import { SettingsRequestError } from "../settings/settings-request";
import { diagnosticFetch, parseDiagnosticResponse } from "../diagnostics/diagnostics";
import { startLoadingJourney } from "../performance/loading-performance";
import { driveCacheOwnerKey, rememberDriveSummary } from "./drive-library-cache";
import { readLocalDriveDirectories } from "./local-drive-directory";
import "./library-ux.css";

type MembershipState =
  | { userId: string; kind: "loading" | "failed" }
  | { userId: string; kind: "loaded"; memberships: MembershipSummary[]; failed?: boolean };

export function MembershipList({
  userId,
  currentChoirId,
  onSelect,
  localOnly = false,
}: {
  userId: string;
  currentChoirId?: string;
  onSelect?: () => void;
  localOnly?: boolean;
}) {
  const [state, setState] = useState<MembershipState>({ userId, kind: "loading" });
  const [retry, setRetry] = useState(0);
  const [local, setLocal] = useState<{ userId: string; drives: Awaited<ReturnType<typeof readLocalDriveDirectories>> | null } | null>(null);
  useEffect(() => {
    let active = true;
    void readLocalDriveDirectories(userId).then(drives => { if (active) setLocal({ userId, drives }); }).catch(() => { if (active) setLocal({ userId, drives: null }); });
    return () => { active = false; };
  }, [userId]);

  useEffect(() => {
    if (localOnly) return;
    const controller = new AbortController();
    async function load() {
      setState(previous => previous.userId === userId && previous.kind === "loaded" ? { ...previous, failed: false } : { userId, kind: "loading" });
      try {
        const response = await diagnosticFetch("/api/choirs", { signal: controller.signal });
        if (!response.ok) throw new SettingsRequestError(response.status);
        const { memberships } = await parseDiagnosticResponse(response, choirMembershipsResponseSchema);
        if (controller.signal.aborted) return;
        memberships.forEach(({ choir }) =>
          rememberDriveSummary(driveCacheOwnerKey(userId, choir.id), choir),
        );
        setState({ userId, kind: "loaded", memberships });
      } catch (error) {
        if (!controller.signal.aborted) setState(previous => previous.userId === userId && previous.kind === "loaded" &&
          !(error instanceof SettingsRequestError && [401, 403, 404].includes(error.status))
          ? { ...previous, failed: true } : { userId, kind: "failed" });
      }
    }
    void load();
    return () => controller.abort();
  }, [userId, retry, localOnly]);

  const retryNotice = state.userId === userId && (state.kind === "failed" || (state.kind === "loaded" && state.failed)) && !localOnly
    ? <p role="status">暂时无法加载已加入的云盘。<Button onPress={() => setRetry(value => value + 1)}>重试</Button></p> : null;
  if (state.userId !== userId || state.kind !== "loaded") {
    const drives = local?.userId === userId ? local.drives === null ? null : local.drives.filter(entry => entry.membership && !entry.accessRevoked) : undefined;
    return <>
      {retryNotice}
      {drives?.length ? <div className="membership-list">{drives.map(entry => <Link className="membership-row" key={entry.choirId} to={`/choirs/${entry.choirId}`} aria-current={entry.choirId === currentChoirId ? "page" : undefined} onClick={onSelect}><span><strong>{entry.choir.name}</strong></span></Link>)}</div>
        : drives === null ? <p role="status">暂时无法读取本机目录，请重试连接。</p>
        : localOnly && drives ? <p>本机尚未保存云盘目录，请联网后重试。</p>
        : state.userId === userId && state.kind === "failed" && drives ? null
        : <p role="status">{localOnly ? "正在读取本机目录…" : "正在加载已加入的云盘…"}</p>}
    </>;
  }
  if (!state.memberships.length) {
    return (
      <>{retryNotice}<p className="membership-empty">
        还没有已加入的云盘。请使用云盘提供的邀请码加入。
      </p></>
    );
  }
  return (
    <>
    {retryNotice}
    <div className="membership-list">
      {state.memberships.map((membership) => (
        <Link
          className="membership-row"
          key={membership.id}
          to={`/choirs/${membership.choir.id}`}
          aria-current={membership.choir.id === currentChoirId ? "page" : undefined}
          onClick={() => {
            startLoadingJourney("enter-drive", "warm");
            onSelect?.();
          }}
        >
          <span>
            <strong>{membership.choir.name}</strong>
            <small>
              {membership.isOwner ? "拥有者" : "成员"}
              {membership.choir.id === currentChoirId ? " · 当前云盘" : ""}
            </small>
          </span>
          <span aria-hidden="true">→</span>
        </Link>
      ))}
    </div>
    </>
  );
}
