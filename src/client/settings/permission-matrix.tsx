import { useMessages } from "../../i18n";
import { permissionMessageKeys } from "./permission-messages";
import { Info } from "lucide-react";
import { Button, DialogTrigger, Heading, Popover } from "react-aria-components";
import { Dialog } from "../navigation/overlays";
import { operationKeys, type Operation, type PermissionSet } from "../../shared/drive-permissions";

const descriptions: Record<Operation, string> = {
  uploadFiles: "permissionMatrixUploadNewPdfScore",
  modifyFiles: "permissionMatrixRenameSheetMusicReplace",
  trashFiles: "permissionMatrixMoveSheetMusicAttachments",
  manageInvites: "permissionMatrixViewRotateCloudDisk",
  removeMembers: "permissionMatrixRemoveOrdinaryMembersRestore",
  configureLayers: "permissionMatrixAddingRenamingSortingDeactivating",
  editDriveInfo: "permissionMatrixModifyBasicInformationSuch",
};

export function PermissionMatrix({ focus, operations, management, scope, owner, disabled, layers, onOperations, onManagement }: {
  focus?: string; operations: PermissionSet; management: PermissionSet; scope: PermissionSet; owner: boolean; disabled: boolean;
  layers: { slot: string; name: string }[];
  onOperations: (value: PermissionSet) => void; onManagement: (value: PermissionSet) => void;
}) {
  const t = useMessages("library");
  const columns = [{ label: t("membershipManagementOperable"), value: operations, change: onOperations }, ...(owner ? [{ label: t("membershipManagementAuthorizeOthers"), value: management, change: onManagement }] : [])];
  function row(name: string, description: string, key: string, checked: (set: PermissionSet) => boolean, update: (set: PermissionSet, next: boolean) => PermissionSet, locked?: (set: PermissionSet) => boolean) {
    if (focus && focus !== key) return null;
    return <tr key={key}><th scope="row"><span>{name}</span><DialogTrigger>
      <Button className="permission-info icon-button" aria-label={t("permissionMatrixDescription", { name: String(name) })}><Info size={17} aria-hidden="true" /></Button>
      <Popover className="file-menu-popover permission-help"><Dialog><Heading slot="title">{name}</Heading><p>{description}</p><p>{t("permissionMatrixOperateAllowsPerformAuthorize")}</p></Dialog></Popover>
    </DialogTrigger></th>{columns.map(column => <td key={column.label}><label className="permission-check"><input type="checkbox" aria-label={t("permissionMatrixOption", { name, label: column.label })} checked={checked(column.value)} disabled={disabled || locked?.(column.value)} onChange={event => column.change(update(column.value, event.target.checked))} /><span className="visually-hidden">{t("permissionMatrixOption", { name, label: column.label })}</span></label></td>)}</tr>;
  }
  return <div className="permission-matrix"><table><caption>{t("permissionMatrixSetOperationAuthorizationSeparately")}</caption><thead><tr><th scope="col">{t("permissionMatrixPermissions")}</th>{columns.map(column => <th scope="col" key={column.label}>{column.label}</th>)}</tr></thead><tbody>
    {operationKeys.filter(key => scope.operations.includes(key)).map(key => row(t(permissionMessageKeys[key]), t(descriptions[key]), key, set => set.operations.includes(key), (set, next) => ({ ...set, operations: next ? [...new Set([...set.operations, key])] : set.operations.filter(item => item !== key) })))}
    {scope.sharedLayers === "all" && row(t("permissionMatrixEditAllSharedLayers"), t("permissionMatrixContainsCurrentFutureShared"), "all-layers", set => set.sharedLayers === "all", (set, next) => ({ ...set, sharedLayers: next ? "all" : [] }))}
    {layers.filter(layer => scope.sharedLayers === "all" || scope.sharedLayers.includes(layer.slot)).map(layer => row(t("permissionMatrixEdit", { name: String(layer.name) }), t("permissionMatrixAllowsCreationModificationDeletion"), `layer:${layer.slot}`, set => set.sharedLayers === "all" || set.sharedLayers.includes(layer.slot), (set, next) => ({ ...set, sharedLayers: set.sharedLayers === "all" ? "all" : next ? [...new Set([...set.sharedLayers, layer.slot])] : set.sharedLayers.filter(slot => slot !== layer.slot) }), set => set.sharedLayers === "all"))}
  </tbody></table></div>;
}
