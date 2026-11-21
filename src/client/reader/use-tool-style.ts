import { useState } from "react";
import type { AnnotationTool } from "../annotations/annotation-overlay";
import { defaultToolStyle, toolStyleSchema, type ToolStyle } from "../annotations/tool-style";
export function useToolStyle(owner: string, tool: AnnotationTool) {
  const key = `note-tool-style:${owner}:${tool}`;
  const read = () => {
    try { const result = toolStyleSchema.safeParse({ ...defaultToolStyle(tool), ...JSON.parse(localStorage.getItem(key) ?? "null") }); if (result.success) {
      // Legacy values did not distinguish an explicit choice from the default.
      const version = localStorage.getItem(`${key}:pressure-default`);
      return tool === "ink" && version !== "1" ? { ...result.data, pressureMode: "pressure" as const } : result.data;
    } } catch { /* Optional preference. */ }
    return defaultToolStyle(tool);
  };
  const [state, setState] = useState(() => ({ key, value: read() }));
  const style = state.key === key ? state.value : read();
  const setStyle = (value: ToolStyle) => {
    const parsed = toolStyleSchema.parse(value);
    setState({ key, value: parsed });
    try { localStorage.setItem(key, JSON.stringify(parsed)); if (tool === "ink") localStorage.setItem(`${key}:pressure-default`, "1"); } catch { /* Retain session choice. */ }
  };
  return { style, setStyle };
}
