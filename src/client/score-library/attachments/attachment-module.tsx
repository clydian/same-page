import { Component, useEffect, useState, type ComponentType, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { diagnosticErrorType, recordFailure } from "../../diagnostics/diagnostics";

export function AttachmentRecovery() {
  return <div className="attachment-module-error">
    <p role="alert">附件暂时无法打开。可关闭此窗口，从附件的“⋯”菜单下载后打开，也可检查更新或反馈问题。</p>
    <Link className="text-button" to="/about">检查更新</Link>{" "}<Link className="text-button" to="/diagnostics">反馈问题</Link>
  </div>;
}

// Native import failures are cached by the browser module map, even after the
// network recovers. Do not offer a retry that merely repeats the same import.
// This boundary stays inside the parent's shell/form so its input survives.
export function AttachmentModule<T extends object>({ load, props, fallback, failure }: {
  load: () => Promise<{ default: ComponentType<T> }>; props: T; fallback: ReactNode; failure?: ReactNode;
}) {
  return <ModuleBoundary failure={failure}><ModuleContent load={load} props={props} fallback={fallback} failure={failure} /></ModuleBoundary>;
}
function ModuleContent<T extends object>({ load, props, fallback, failure }: {
  load: () => Promise<{ default: ComponentType<T> }>; props: T; fallback: ReactNode; failure?: ReactNode;
}) {
  const [module, setModule] = useState<{ default: ComponentType<T> } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void load().then(value => { if (active) setModule(value); }, error => {
      if (!active) return;
      recordFailure({ operation: "drive", step: "attachment-entry", category: "network", stage: "prepare", errorType: diagnosticErrorType(error) });
      setFailed(true);
    });
    return () => { active = false; };
  }, [load]);
  if (failed) return failure ?? <AttachmentRecovery />;
  if (!module) return fallback;
  const Content = module.default;
  return <Content {...props} />;
}
class ModuleBoundary extends Component<{ children: ReactNode; failure?: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) {
    recordFailure({ operation: "drive", step: "attachment-entry", category: "internal", stage: "decode", errorType: diagnosticErrorType(error) });
  }
  render() { return this.state.failed ? this.props.failure ?? <AttachmentRecovery /> : this.props.children; }
}
