import { useEffect, useState, type ComponentType, type ReactNode } from "react";

// A remounted attempt calls the importer again; unlike a module-level lazy(),
// it never retains a rejected promise for the rest of the application lifetime.
export function AttachmentModule<T extends object>({ load, props, fallback }: {
  load: () => Promise<{ default: ComponentType<T> }>; props: T; fallback: ReactNode;
}) {
  const [module, setModule] = useState<{ default: ComponentType<T> } | null>(null);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    let active = true;
    void load().then(value => { if (active) setModule(value); }, cause => {
      if (active) setError(Object.assign(new Error("attachment_module_unavailable", { cause }), { name: "AttachmentModuleError" }));
    });
    return () => { active = false; };
  }, [load]);
  if (error) throw error;
  if (!module) return fallback;
  const Content = module.default;
  return <Content {...props} />;
}
