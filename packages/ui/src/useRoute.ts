import { useCallback, useEffect, useState } from "react";

/**
 * Tiny hash router (`#/staff/tests/abc`). A hash works the same in the browser
 * and in the desktop app's file:// page, and the back button just works.
 */
export function useRoute(fallback: string): [string, (to: string) => void] {
  const read = useCallback(() => window.location.hash.replace(/^#\/?/, "") || fallback, [fallback]);
  const [path, setPath] = useState(read);

  useEffect(() => {
    const onChange = () => setPath(read());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, [read]);

  const go = useCallback((to: string) => {
    window.location.hash = `/${to.replace(/^\/+/, "")}`;
  }, []);

  return [path, go];
}
