import { effectiveCapabilities, permissionSetSchema, type Operation } from "../../src/shared/drive-permissions";
import { AuthorizationError } from "../auth/authorization";
import type { Principal } from "../auth/principal";

export interface PermissionMember {
  id: string; choirId: string; userId: string; displayName: string; status: "active" | "removed";
  permissions: string; managementScope: string; lifecycleRevision: number; isOwner: boolean;
}
export function memberCapabilities(member: Pick<PermissionMember, "isOwner" | "permissions" | "managementScope">) {
  return effectiveCapabilities(member.isOwner, permissionSetSchema.parse(JSON.parse(member.permissions)), permissionSetSchema.parse(JSON.parse(member.managementScope)));
}
export async function readPermissionMember(db: D1Database, principal: Principal | null, choirId: string): Promise<PermissionMember> {
  if (principal?.kind !== "user") throw new AuthorizationError();
  const row = await db.prepare(`SELECT id, choir_id AS choirId, user_id AS userId, display_name AS displayName, status,
    permissions, management_scope AS managementScope, lifecycle_revision AS lifecycleRevision, is_owner
    FROM membership_capabilities WHERE choir_id = ? AND user_id = ?`).bind(choirId, principal.userId).first<Omit<PermissionMember, "isOwner"> & { is_owner: number }>();
  if (!row) throw new AuthorizationError();
  return { ...row, isOwner: row.is_owner === 1 };
}
// The optional identity fence is used by destructive requests from deployed
// clients. Omitting it preserves callers that authorize only current ownership.
export async function requireDriveOwner(db: D1Database, principal: Principal | null, choirId: string, expectedUserId?: string) {
  const member = await readPermissionMember(db, principal, choirId);
  if (!member.isOwner || (expectedUserId && expectedUserId !== member.userId)) throw new AuthorizationError();
  return member;
}
export async function requireOperation(db: D1Database, principal: Principal | null, choirId: string, operation: Operation) {
  const member = await readPermissionMember(db, principal, choirId);
  if (!memberCapabilities(member).operations.operations.includes(operation)) throw new AuthorizationError();
  return member;
}
// Identifiers are closed over the shared Operation union; values remain bound parameters.
export function operationPredicate(operation: Operation): string {
  return `EXISTS (SELECT 1 FROM membership_capabilities WHERE id = ? AND ${operation} = 1)`;
}
