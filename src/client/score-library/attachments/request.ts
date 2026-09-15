import { diagnosticFetch } from "../../diagnostics/diagnostics";
export function attachmentFetch(input: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("X-Same-Page-Attachments", "2");
  return diagnosticFetch(input, { ...init, headers });
}
