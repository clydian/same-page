import { Button, DialogTrigger, Heading, Label, Popover, Radio, RadioGroup } from "react-aria-components";
import { X } from "lucide-react";
import { Dialog } from "../navigation/overlays";
import { librarySortDirection, type LibrarySort, type LibrarySortDirection, type LibraryView } from "./library-view-state";

const labels: Record<LibrarySort, string> = { name: "名称", updated: "最近更新", opened: "最近打开" };

export function LibrarySortControl({ view, disabled, onSort, onDirection }: {
  view: Pick<LibraryView, "sort" | "sortDirections">; disabled?: boolean;
  onSort(value: LibrarySort): void; onDirection(value: LibrarySortDirection): void;
}) {
  const direction = librarySortDirection(view);
  const time = view.sort !== "name";
  const order = time ? direction === "desc" ? "最新在前" : "最早在前" : direction === "asc" ? "升序" : "降序";
  return <DialogTrigger>
    <Button className="library-sort-trigger" isDisabled={disabled} aria-label={`按${labels[view.sort]}排序，${order}`}>
      {labels[view.sort]}<span aria-hidden="true">{direction === "asc" ? "↑" : "↓"}</span>
    </Button>
    <Popover className="library-sort-popover" placement="bottom end"><Dialog aria-label="乐谱排序">{({ close }) => <>
      <div className="dialog-heading"><Heading slot="title">排列方式</Heading><Button className="icon-button" aria-label="关闭排序选项" onPress={close}><X size={20} aria-hidden="true" /></Button></div>
      <RadioGroup className="library-sort-options" value={view.sort} onChange={value => onSort(value as LibrarySort)}>
        <Label>排序依据</Label>
        <Radio value="name">名称</Radio><Radio value="updated">最近更新</Radio><Radio value="opened">本机最近打开</Radio>
      </RadioGroup>
      <RadioGroup className="library-sort-options" value={direction} onChange={value => onDirection(value as LibrarySortDirection)}>
        <Label>顺序</Label><Radio value="asc">{time ? "最早在前" : "升序（A → Z）"}</Radio><Radio value="desc">{time ? "最新在前" : "降序（Z → A）"}</Radio>
      </RadioGroup>
    </>}</Dialog></Popover>
  </DialogTrigger>;
}
