import { useEffect, useRef, useState, type ReactNode } from 'react';

interface ConsoleShellProps {
  children: ReactNode;
  scenarioControls?: ReactNode;
  railNote?: ReactNode;
  activeDestination?: 'Products' | 'Orders' | 'Third-party logs';
  onOpenProducts: (trigger: HTMLElement) => boolean;
  onOpenOrders?: (trigger: HTMLElement) => boolean;
  onOpenThirdPartyLogs?: (trigger: HTMLElement) => boolean;
  identity?: { userName: string; storeName: string; role: 'owner' | 'staff' };
  onSignOut?: () => void;
  onOpenOwnerInvitation?: (trigger: HTMLElement) => void;
}

export function ConsoleShell({
  children,
  scenarioControls,
  railNote,
  activeDestination = 'Products',
  onOpenProducts,
  onOpenOrders,
  onOpenThirdPartyLogs,
  identity,
  onSignOut,
  onOpenOwnerInvitation,
}: ConsoleShellProps) {
  const sessionIdentity = identity ?? { userName: 'Nexus', storeName: 'Store', role: 'owner' as const };
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

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

  return (
    <div className="console-shell">
      <a className="skip-link" href="#console-content">
        Skip to main content
      </a>

      <aside className="console-rail" aria-label="Console navigation">
        <div className="console-rail-top">
          <div className="console-brand">
            <strong>Nexus</strong>
            <span>Operations Console</span>
          </div>
          <div className="console-role-pill">
            <span>{sessionIdentity.storeName} · {sessionIdentity.role === 'owner' ? 'Owner' : 'Staff'}</span>
            <span>Role: {sessionIdentity.role === 'owner' ? 'Owner' : 'Staff'}.</span>
          </div>
          <nav className="console-nav">
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
            {identity?.role === 'owner' && onOpenThirdPartyLogs ? (
              <button
                className={activeDestination === 'Third-party logs' ? 'active' : undefined}
                aria-current={activeDestination === 'Third-party logs' ? 'page' : undefined}
                type="button"
                onClick={(event) => onOpenThirdPartyLogs(event.currentTarget)}
              >
                Third-party logs
              </button>
            ) : null}
          </nav>
        </div>
        <div className="console-rail-bottom">
          <div className="console-account">
            <span className="console-avatar" aria-hidden="true">
              <span className="icon-glyph">person</span>
            </span>
            <div>
              <div className="console-account-name">{sessionIdentity.userName}</div>
              <div className="console-account-meta">{sessionIdentity.storeName} · {sessionIdentity.role === 'owner' ? 'Owner' : 'Staff'}</div>
            </div>
          </div>
          {identity?.role === 'owner' && onOpenOwnerInvitation ? (
            <button className="button" type="button" aria-haspopup="dialog" onClick={(event) => onOpenOwnerInvitation(event.currentTarget)}>
              Invite owner
            </button>
          ) : null}
          {onSignOut ? <button className="button" type="button" onClick={onSignOut}>Sign out</button> : null}
          {railNote ? <p className="console-rail-note">{railNote}</p> : null}
        </div>
      </aside>

      <header className="console-deskbar">
        <span className="console-deskbar-kicker">Nexus Operations Console · {activeDestination}</span>
        <div className="console-deskbar-tools">
          <button
            className="console-icon-button"
            type="button"
            aria-label="Jump to query field"
            onClick={() => document.getElementById('product-search')?.focus() ?? document.getElementById('order-search')?.focus()}
          >
            <span className="icon-glyph" aria-hidden="true">search</span>
          </button>
          <span className="console-avatar" aria-hidden="true">
            <span className="icon-glyph">person</span>
          </span>
          {onSignOut ? <button className="button" type="button" onClick={onSignOut}>Sign out</button> : null}
        </div>
      </header>

      <header className="console-topbar">
        <strong>Nexus · {activeDestination}</strong>
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
          {identity?.role === 'owner' && onOpenThirdPartyLogs ? (
            <button
              className="button"
              type="button"
              aria-current={activeDestination === 'Third-party logs' ? 'page' : undefined}
              onClick={(event) => {
                onOpenThirdPartyLogs(menuButtonRef.current ?? event.currentTarget);
                closeMenu();
              }}
            >
              Third-party logs
            </button>
          ) : null}
          {identity?.role === 'owner' && onOpenOwnerInvitation ? (
            <button
              className="button"
              type="button"
              aria-haspopup="dialog"
              onClick={(event) => {
                const trigger = menuButtonRef.current ?? event.currentTarget;
                closeMenu();
                onOpenOwnerInvitation(trigger);
              }}
            >
              Invite owner
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
        {scenarioControls ?? null}
        {children}
      </main>
    </div>
  );
}
