import { useMessages } from "../../i18n";
import { Button, DialogTrigger, Heading, Label, Popover, Radio, RadioGroup } from "react-aria-components";
import { X } from "lucide-react";
import { Dialog } from "../navigation/overlays";
import { librarySortDirection, type LibrarySort, type LibrarySortDirection, type LibraryView } from "./library-view-state";

const labels: Record<LibrarySort, string> = { name: "attachmentName", updated: "librarySortControlLatestUpdates", opened: "librarySortControlRecentlyOpened" };

export function LibrarySortControl({ view, disabled, onSort, onDirection }: {
  view: Pick<LibraryView, "sort" | "sortDirections">; disabled?: boolean;
  onSort(value: LibrarySort): void; onDirection(value: LibrarySortDirection): void;
}) {
  const t = useMessages("library");
  const direction = librarySortDirection(view);
  const time = view.sort !== "name";
  const order = time ? direction === "desc" ? t("librarySortControlLatestFirst") : t("librarySortControlEarliestFirst") : direction === "asc" ? t("librarySortControlAscendingOrder") : t("librarySortControlDescendingOrder");
  return <DialogTrigger>
    <Button className="library-sort-trigger" isDisabled={disabled} aria-label={t("librarySortControlSort", { value1: t(labels[view.sort]), order: String(order) })}>
      {t(labels[view.sort])}<span aria-hidden="true">{direction === "asc" ? "↑" : "↓"}</span>
    </Button>
    <Popover className="library-sort-popover" placement="bottom end"><Dialog aria-label={t("librarySortControlScoreSorting")}>{({ close }) => <>
      <div className="dialog-heading"><Heading slot="title">{t("librarySortControlArrangement")}</Heading><Button className="icon-button" aria-label={t("librarySortControlTurnOffSortingOptions")} onPress={close}><X size={20} aria-hidden="true" /></Button></div>
      <RadioGroup className="library-sort-options" value={view.sort} onChange={value => onSort(value as LibrarySort)}>
        <Label>{t("librarySortControlSort2")}</Label>
        <Radio value="name">{t("attachmentName")}</Radio><Radio value="updated">{t("librarySortControlLatestUpdates")}</Radio><Radio value="opened">{t("librarySortControlMachineRecentlyOpened")}</Radio>
      </RadioGroup>
      <RadioGroup className="library-sort-options" value={direction} onChange={value => onDirection(value as LibrarySortDirection)}>
        <Label>{t("librarySortControlOrder")}</Label><Radio value="asc">{time ? t("librarySortControlEarliestFirst") : t("librarySortControlAscendingOrderZ")}</Radio><Radio value="desc">{time ? t("librarySortControlLatestFirst") : t("librarySortControlDescendingOrderZ")}</Radio>
      </RadioGroup>
    </>}</Dialog></Popover>
  </DialogTrigger>;
}
