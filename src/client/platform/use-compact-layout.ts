import { useEffect, useState } from "react";

export function useCompactLayout() {
  const [compact, setCompact] = useState(() => !window.matchMedia("(min-width: 681px)").matches);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 681px)");
    const update = () => setCompact(!query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return compact;
}
