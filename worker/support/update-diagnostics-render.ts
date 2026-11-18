export function renderUpdateDiagnostics(
  template: string,
  messages: Readonly<Record<string, string>>,
  locale: string,
  build: string,
  limit: number,
): string {
  const values: Readonly<Record<string, string>> = {
    ...messages,
    LOCALE: locale,
    BUILD: build,
    LIMIT: String(limit),
    MESSAGES: JSON.stringify(messages),
  };
  return template.replace(/__([A-Za-z]+)__/g, (marker: string, key: string) => {
    if (!Object.hasOwn(values, key)) return marker;
    return values[key].replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  });
}

export function renderUpdateDiagnosticsScript(template: string, sourceMessages: Readonly<Record<string, string>>): string {
  return template.replace("__SOURCE_MESSAGES__", () => JSON.stringify(sourceMessages));
}
