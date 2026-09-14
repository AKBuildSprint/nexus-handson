import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * The Console deskbar hosts the search control owned by the visible screen.
 *
 * A screen renders its real search form inline and, when this module reports a
 * desktop host node, portals that same form into the deskbar instead. The host
 * is `null` at compact width and while no `ConsoleShell` is mounted, so a
 * screen never portals into a CSS-hidden deskbar.
 */
const ConsoleSearchHostContext = createContext<HTMLElement | null>(null);

const DESKTOP_SEARCH_QUERY = '(min-width: 720px)';
const canQueryViewport = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function';

/** Tracks the deskbar breakpoint so a compact layout never keeps a hidden host. */
export function useDesktopSearchViewport(): boolean {
  const [desktop, setDesktop] = useState(() => canQueryViewport() && window.matchMedia(DESKTOP_SEARCH_QUERY).matches);

  useEffect(() => {
    if (!canQueryViewport()) return;
    const query = window.matchMedia(DESKTOP_SEARCH_QUERY);
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return desktop;
}

export function ConsoleSearchHostProvider({ host, children }: { host: HTMLElement | null; children: ReactNode }) {
  const desktop = useDesktopSearchViewport();
  const value = useMemo(() => (desktop ? host : null), [desktop, host]);
  return <ConsoleSearchHostContext.Provider value={value}>{children}</ConsoleSearchHostContext.Provider>;
}

/** Deskbar search host for the current screen, or `null` for inline rendering. */
export function useConsoleSearchHost(): HTMLElement | null {
  return useContext(ConsoleSearchHostContext);
}
