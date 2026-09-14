import { kOnlineManager, type OnlineManager } from "better-auth/client";

// Better Auth exposes this platform adapter (also used by its Expo client).
// The app has one auth client. Keep accurate connectivity, but let our bounded
// recovery coordinator own reconnect notifications; Better Auth otherwise
// refetches on every online event regardless of local errors or visibility.
export function installSessionOnlineStatus() {
  const manager: OnlineManager = {
    isOnline: typeof navigator === "undefined" || navigator.onLine,
    setOnline(online) { this.isOnline = online; },
    subscribe() { return () => {}; },
    setup() {
      if (typeof window === "undefined") return () => {};
      const online = () => manager.setOnline(true);
      const offline = () => manager.setOnline(false);
      window.addEventListener("online", online);
      window.addEventListener("offline", offline);
      return () => {
        window.removeEventListener("online", online);
        window.removeEventListener("offline", offline);
      };
    },
  };
  Reflect.set(globalThis, kOnlineManager, manager);
}
