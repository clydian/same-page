import { useMessages } from "../../../i18n";
import { BlockTypeSelect, BoldItalicUnderlineToggles, CreateLink, ListsToggle, MDXEditor, UndoRedo, headingsPlugin, linkDialogPlugin, linkPlugin, listsPlugin, quotePlugin, thematicBreakPlugin, toolbarPlugin } from "@mdxeditor/editor";
import { safeAttachmentUrl } from "../../../shared/attachments";
import "@mdxeditor/editor/style.css";

export default function MarkdownEditor({ initial, disabled, onChange, onError }: {
  initial: string; disabled: boolean; onChange: (value: string) => void; onError: (source: string) => void;
}) {
  const t = useMessages("library");
  return <MDXEditor markdown={initial} readOnly={disabled} suppressHtmlProcessing contentEditableClassName="attachment-prose attachment-editor-body"
    onChange={(value, initialNormalize) => { if (!initialNormalize && !disabled) onChange(value); }} onError={({ source }) => onError(source)}
    translation={(_key, defaultValue) => ({ "Undo": t("markdownEditorCancel"), "Redo": t("markdownEditorRedo"), "Bold": t("markdownEditorBold"), "Italic": t("markdownEditorItalics"), "Create link": t("attachmentPresentationAddLink"), "Paragraph": t("markdownEditorText"), "Block type": t("markdownEditorTextFormat"), "Quote": t("markdownEditorQuote"), "Heading 1": t("markdownEditorTitle"), "Heading 2": t("markdownEditorTitle2"), "Heading 3": t("markdownEditorTitle3"), "Bulleted list": t("markdownEditorUnorderedList"), "Numbered list": t("markdownEditorOrderedList"), "Check list": t("markdownEditorTaskList") }[defaultValue] ?? defaultValue)}
    plugins={[headingsPlugin({ allowedHeadingLevels: [1, 2, 3] }), listsPlugin(), quotePlugin(), thematicBreakPlugin(),
      linkPlugin({ validateUrl: value => Boolean(safeAttachmentUrl(value)), disableAutoLink: true }), linkDialogPlugin({ onClickLinkCallback: url => { const target = safeAttachmentUrl(url); if (target) window.open(target, "_blank", "noopener,noreferrer"); } }),
      toolbarPlugin({ toolbarContents: () => <><UndoRedo /><BlockTypeSelect /><BoldItalicUnderlineToggles options={["Bold", "Italic"]} /><ListsToggle /><CreateLink /></> })]} />;
}
