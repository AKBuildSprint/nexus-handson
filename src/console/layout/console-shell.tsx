import { useEffect, useRef, useState, type ReactNode } from 'react';

interface ConsoleShellProps {
  children: ReactNode;
  scenarioControls?: ReactNode;
  railNote?: ReactNode;
  onOpenProducts: (trigger: HTMLElement) => boolean;
}

export function ConsoleShell({ children, scenarioControls, railNote, onOpenProducts }: ConsoleShellProps) {
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
        <div className="console-brand">
          <strong>Nexus</strong>
          <span>Operations Console</span>
        </div>
        <nav className="console-nav">
          <button className="active" type="button" onClick={(event) => onOpenProducts(event.currentTarget)}>
            Products
          </button>
        </nav>
        <p className="console-rail-note">
          {railNote ?? 'Frontend design prototype. Scenario data is isolated from future production inputs.'}
        </p>
      </aside>

      <header className="console-topbar">
        <strong>Nexus · Products</strong>
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
            onClick={(event) => {
              onOpenProducts(menuButtonRef.current ?? event.currentTarget);
              closeMenu();
            }}
          >
            Products
          </button>
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
