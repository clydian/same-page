import type { Operation } from "../../shared/drive-permissions";

export const permissionMessageKeys = {
  uploadFiles: "permissionUploadScores",
  modifyFiles: "permissionModifyScores",
  trashFiles: "permissionTrashScores",
  manageInvites: "permissionManageInvites",
  removeMembers: "permissionRemoveMembers",
  configureLayers: "permissionConfigureLayers",
  editDriveInfo: "permissionEditDriveInfo",
} as const satisfies Record<Operation, string>;
