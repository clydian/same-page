import { z } from "zod";
import {
  cliTokenListSchema,
  createCliTokenSchema,
  createdCliTokenSchema,
} from "../../shared/cli-tokens";
import {
  adminCapabilitiesSchema,
  adminDetailSchema,
  adminScoreSchema,
  adminAuditSchema,
} from "../../shared/admin";
export class AdminRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(adminErrorMessage(code));
  }
}
export function adminErrorMessage(code: string) {
  return (
    (
      {
        release_conflict: "版本已变化或操作冲突，请重新读取版本后确认。",
        release_unavailable: "发布资源暂不可用，稳定版未被替换。",
        forbidden: "当前身份没有产品运营权限，或授权已撤销。",
        xml_publication_conflict:
          "来源 PDF、检查结果或用户的移除选择已变化，请重新读取后检查。",
        attachment_conflict: "正式练习版已更新，请重新读取后确认。",
        review_conflict: "检查记录已更新，请重新读取后再试。",
        import_conflict:
          "同一次导入尚未完成或内容已变化，请重新选择文件后重试。",
        admin_storage_limit_reached: "产品候选存储已达上限，请联系维护者处理。",
        choir_storage_quota_exceeded: "云盘容量不足，当前练习版未被替换。",
        candidate_unavailable: "候选结果已到期或不可用，请重新导入。",
        invalid_musicxml: "无法识别此 MusicXML，请检查文件。",
        invalid_review: "检查尚未完成，无法标记通过。",
        invalid_cli_token: "请填写令牌名称，并选择至少一个云盘及有效期。",
        source_unavailable: "原 PDF 已到期或不可用。",
        resource_deleted: "内容已删除，不再提供访问。",
        score_not_found: "乐谱已回收、清理或暂不可用。",
        try_again_later: "操作过于频繁，请稍后重试。",
      } as Record<string, string>
    )[code] ?? "操作未完成，请检查网络后重试。"
  );
}
export async function adminFetch(path: string, init?: RequestInit) {
  const response = await fetch(`/api/admin${path}`, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) {
    const data = (await response
      .json()
      .catch(() => ({ error: "request_failed" }))) as { error?: string };
    throw new AdminRequestError(
      response.status,
      data.error ?? "request_failed",
    );
  }
  return response;
}
export const adminSession = async (signal?: AbortSignal) =>
  adminCapabilitiesSchema.parse(
    await (await adminFetch("/session", { signal })).json(),
  );
export const readAdminDetail = async (
  id: string,
  signal?: AbortSignal,
  before?: string,
  selected?: string | null,
) => {
  const query = new URLSearchParams();
  if (before) query.set("before", before);
  if (selected && selected !== "published") query.set("selected", selected);
  return adminDetailSchema.parse(
    await (await adminFetch(`/scores/${id}?${query}`, { signal })).json(),
  );
};
export const readAdminList = async (
  query: URLSearchParams,
  signal?: AbortSignal,
) =>
  z
    .object({ scores: z.array(adminScoreSchema), next: z.string().nullable() })
    .parse(await (await adminFetch(`/scores?${query}`, { signal })).json());
export const readAdminDrives = async (signal?: AbortSignal) =>
  z
    .object({ drives: z.array(z.object({ id: z.string(), name: z.string() })) })
    .parse(await (await adminFetch("/drives", { signal })).json());
export const readAdminAudit = async (signal?: AbortSignal) =>
  z
    .object({ events: z.array(adminAuditSchema) })
    .parse(await (await adminFetch("/audit", { signal })).json());
export const jsonPost = (data: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data),
});

export const readCliTokens = async (signal?: AbortSignal) =>
  cliTokenListSchema.parse(
    await (await adminFetch("/cli-tokens", { signal })).json(),
  );
export const createCliToken = async (input: z.input<typeof createCliTokenSchema>, signal?: AbortSignal) =>
  createdCliTokenSchema.parse(
    await (await adminFetch("/cli-tokens", { ...jsonPost(input), signal })).json(),
  );
export const revokeCliToken = async (id: string, signal?: AbortSignal) => {
  await adminFetch(`/cli-tokens/${encodeURIComponent(id)}`, { method: "DELETE", signal });
};

export type AdminCapabilities = Awaited<ReturnType<typeof adminSession>>;
