import type { ReactNode } from "react";
import "./loading-status.css";

// Keep the status accessible immediately; only defer its visual appearance.
// The containing region owns its space, so a fast response cannot move controls.
export function PendingText({ children }: { children: ReactNode }) {
  return <span className="pending-text">{children}</span>;
}

export function LoadingStatus({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`loading-status ${className}`} role="status"><PendingText>{children}</PendingText></p>;
}
