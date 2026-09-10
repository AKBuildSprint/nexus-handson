import { useEffect, useRef, useState, type ReactNode } from 'react';

interface ConsoleShellProps {
  children: ReactNode;
  scenarioControls?: ReactNode;
  railNote?: ReactNode;
  activeDestination?: 'Products' | 'Orders';
  onOpenProducts: (trigger: HTMLElement) => boolean;
  onOpenOrders?: (trigger: HTMLElement) => boolean;
}

export function ConsoleShell({
  children,
  scenarioControls,
  railNote,
  activeDestination = 'Products',
  onOpenProducts,
  onOpenOrders,
}: ConsoleShellProps) {
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
            <span>Viewing as Store operator</span>
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
          </nav>
        </div>
        <div className="console-rail-bottom">
          <div className="console-account">
            <span className="console-avatar" aria-hidden="true">
              <span className="icon-glyph">person</span>
            </span>
            <div>
              <div className="console-account-name">Nexus</div>
              <div className="console-account-meta">Store operator</div>
            </div>
          </div>
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
          <button className="button" type="button" onClick={closeMenu}>
            Close menu
          </button>
        </nav>
      ) : null}

      <main id="console-content" className="console-main" tabIndex={-1}>
        {scenarioControls ?? null}
        {children}
      </main>
    </div>
  );
}
