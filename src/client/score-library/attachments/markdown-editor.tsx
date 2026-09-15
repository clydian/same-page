import { BlockTypeSelect, BoldItalicUnderlineToggles, CreateLink, ListsToggle, MDXEditor, UndoRedo, headingsPlugin, linkDialogPlugin, linkPlugin, listsPlugin, quotePlugin, thematicBreakPlugin, toolbarPlugin } from "@mdxeditor/editor";
import { safeAttachmentUrl } from "../../../shared/attachments";
import "@mdxeditor/editor/style.css";

export default function MarkdownEditor({ initial, disabled, onChange, onError }: {
  initial: string; disabled: boolean; onChange: (value: string) => void; onError: (source: string) => void;
}) {
  return <MDXEditor markdown={initial} readOnly={disabled} suppressHtmlProcessing contentEditableClassName="attachment-prose attachment-editor-body"
    onChange={(value, initialNormalize) => { if (!initialNormalize && !disabled) onChange(value); }} onError={({ source }) => onError(source)}
    translation={(_key, defaultValue) => ({ "Undo": "撤销", "Redo": "重做", "Bold": "加粗", "Italic": "斜体", "Create link": "添加链接", "Paragraph": "正文", "Block type": "正文格式", "Quote": "引用", "Heading 1": "标题 1", "Heading 2": "标题 2", "Heading 3": "标题 3", "Bulleted list": "无序列表", "Numbered list": "有序列表", "Check list": "任务列表" }[defaultValue] ?? defaultValue)}
    plugins={[headingsPlugin({ allowedHeadingLevels: [1, 2, 3] }), listsPlugin(), quotePlugin(), thematicBreakPlugin(),
      linkPlugin({ validateUrl: value => Boolean(safeAttachmentUrl(value)), disableAutoLink: true }), linkDialogPlugin({ onClickLinkCallback: url => { const target = safeAttachmentUrl(url); if (target) window.open(target, "_blank", "noopener,noreferrer"); } }),
      toolbarPlugin({ toolbarContents: () => <><UndoRedo /><BlockTypeSelect /><BoldItalicUnderlineToggles options={["Bold", "Italic"]} /><ListsToggle /><CreateLink /></> })]} />;
}
