import { useState } from "react";
import { useLocation } from "react-router-dom";
import { readInviteLink } from "../components/invite-link";

// Retain the invitation after removing its credential from the address bar.
export function useDriveInvitation() {
  const location = useLocation();
  const [invitation, setInvitation] = useState(() => ({ hash: location.hash, version: 0, link: readInviteLink(location.hash) }));
  // A same-page navigation does not remount HomePage. Capture each new fragment,
  // but retain the credential in memory when admission removes it from the URL.
  if (invitation.hash !== location.hash) {
    const link = readInviteLink(location.hash);
    setInvitation({ hash: location.hash, version: invitation.version + (link ? 1 : 0), link: link ?? invitation.link });
  }
  const finishInvitation = () => setInvitation(current => ({ ...current, link: null }));
  return { invitation, finishInvitation };
}
