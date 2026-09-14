import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ConsoleSearchHostProvider } from './console-search-host';

interface ConsoleShellProps {
  children: ReactNode;
  railNote?: ReactNode;
  activeDestination?: 'Products' | 'Orders';
  onOpenProducts: (trigger: HTMLElement) => boolean;
  onOpenOrders?: (trigger: HTMLElement) => boolean;
  identity?: { userName: string; storeName: string; role: 'owner' | 'staff' };
  onSignOut?: () => void;
}

function roleLabel(role: 'owner' | 'staff'): string {
  return role === 'owner' ? 'Owner' : 'Staff';
}

function initialsOf(userName: string): string {
  const initials = userName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => Array.from(part)[0] ?? '')
    .join('');
  return initials.toLocaleUpperCase() || 'N';
}

export function ConsoleShell({
  children,
  railNote,
  activeDestination = 'Products',
  onOpenProducts,
  onOpenOrders,
  identity,
  onSignOut,
}: ConsoleShellProps) {
  const sessionIdentity = identity ?? { userName: 'Nexus', storeName: 'Store', role: 'owner' as const };
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchHost, setSearchHost] = useState<HTMLElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const attachSearchHost = useCallback((node: HTMLDivElement | null) => setSearchHost(node), []);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };

    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [menuOpen]);

  const closeMenu = () => {
    setMenuOpen(false);
    menuButtonRef.current?.focus();
  };

  const destinationLabel = activeDestination === 'Orders' ? 'Orders' : 'Products';

  return (
    <div className="console-shell">
      <a className="skip-link" href="#console-content">
        Skip to main content
      </a>

      <aside className="console-rail" aria-label="Console navigation">
        <div className="console-rail-top">
          <div className="console-identity">
            <span className="console-mark" aria-hidden="true">N</span>
            <div className="console-identity-copy">
              <strong>{sessionIdentity.storeName}</strong>
              <span>{roleLabel(sessionIdentity.role)}</span>
            </div>
          </div>
          <nav className="console-nav">
            <span className="console-nav-label">Navigation</span>
            <button
              className={activeDestination === 'Products' ? 'active' : undefined}
              aria-current={activeDestination === 'Products' ? 'page' : undefined}
              type="button"
              onClick={(event) => onOpenProducts(event.currentTarget)}
            >
              Products
            </button>
            {onOpenOrders ? (
              <button
                className={activeDestination === 'Orders' ? 'active' : undefined}
                aria-current={activeDestination === 'Orders' ? 'page' : undefined}
                type="button"
                onClick={(event) => onOpenOrders(event.currentTarget)}
              >
                Orders
              </button>
            ) : null}
          </nav>
        </div>
        <div className="console-rail-bottom">
          <div className="console-account">
            <span className="console-avatar" aria-hidden="true">{initialsOf(sessionIdentity.userName)}</span>
            <div className="console-account-copy">
              <div className="console-account-name">{sessionIdentity.userName}</div>
              {onSignOut ? (
                <button className="console-account-signout" type="button" onClick={onSignOut}>
                  Sign out
                </button>
              ) : null}
            </div>
          </div>
          {railNote ? <p className="console-rail-note">{railNote}</p> : null}
        </div>
      </aside>

      <header className="console-deskbar">
        <div className="console-deskbar-search" ref={attachSearchHost} />
        <p className="console-deskbar-context">{sessionIdentity.storeName} · {roleLabel(sessionIdentity.role)}</p>
      </header>

      <header className="console-topbar">
        <strong>Nexus · {destinationLabel}</strong>
        <button
          ref={menuButtonRef}
          className="button"
          type="button"
          aria-expanded={menuOpen}
          aria-controls="compact-console-nav"
          onClick={() => setMenuOpen((open) => !open)}
        >
          Menu
        </button>
      </header>

      {menuOpen ? (
        <nav id="compact-console-nav" className="mobile-nav-panel" aria-label="Compact Console navigation">
          <button
            className="button"
            type="button"
            aria-current={activeDestination === 'Products' ? 'page' : undefined}
            onClick={(event) => {
              onOpenProducts(menuButtonRef.current ?? event.currentTarget);
              closeMenu();
            }}
          >
            Products
          </button>
          {onOpenOrders ? (
            <button
              className="button"
              type="button"
              aria-current={activeDestination === 'Orders' ? 'page' : undefined}
              onClick={(event) => {
                onOpenOrders(menuButtonRef.current ?? event.currentTarget);
                closeMenu();
              }}
            >
              Orders
            </button>
          ) : null}
          <button className="button" type="button" onClick={closeMenu}>
            Close menu
          </button>
          {onSignOut ? <button className="button" type="button" onClick={() => { closeMenu(); onSignOut(); }}>
            Sign out
          </button> : null}
        </nav>
      ) : null}

      <main id="console-content" className="console-main" tabIndex={-1}>
        <ConsoleSearchHostProvider host={searchHost}>{children}</ConsoleSearchHostProvider>
      </main>
    </div>
  );
}
