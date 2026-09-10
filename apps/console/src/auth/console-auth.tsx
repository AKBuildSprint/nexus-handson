import { createAuthClient } from 'better-auth/react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { CONSOLE_SESSION_EXPIRED } from './session-events';
import './console-auth.css';

interface ConsoleUser {
  id: string;
  email: string;
  name: string;
}

interface ConsoleSession {
  user: ConsoleUser;
  signOut: () => Promise<void>;
  signingOut: boolean;
  signOutError: string | null;
}

type SessionState =
  | { kind: 'checking' | 'signed-out' | 'denied' | 'unconfigured' | 'unavailable' }
  | { kind: 'signed-in'; user: ConsoleUser };

const ConsoleSessionContext = createContext<ConsoleSession | null>(null);

export function useConsoleSession(): ConsoleSession | null {
  return useContext(ConsoleSessionContext);
}

function consoleReturnPath(): string {
  const { pathname, search } = window.location;
  return pathname.startsWith('/console/') && pathname !== '/console/login'
    ? `${pathname}${search}`
    : '/console/products';
}

export function ConsoleAuthBoundary({ children }: { children: ReactNode }) {
  const [authClient] = useState(() => createAuthClient({ basePath: '/api/auth' }));
  const [session, setSession] = useState<SessionState>({ kind: 'checking' });
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).has('error')
      ? 'Google sign-in was canceled or could not be completed. Try again with an authorized Google account.'
      : null,
  );
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const signOutPending = useRef(false);

  const checkSession = useCallback(async (hidePrivateContent = false) => {
    if (signOutPending.current) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    if (hidePrivateContent) setSession({ kind: 'checking' });
    try {
      const response = await fetch('/api/console/session', {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
      });
      const body = await response.json() as { user?: ConsoleUser; error?: { code?: string } };
      if (controller.signal.aborted) return;
      if (response.ok && body.user?.id && body.user.email && typeof body.user.name === 'string') {
        if (window.location.pathname === '/console/login') {
          window.history.replaceState(null, '', '/console/products');
        }
        setSession({ kind: 'signed-in', user: body.user });
      } else if (response.status === 401) {
        setSession({ kind: 'signed-out' });
      } else if (response.status === 403) {
        setSession({ kind: 'denied' });
      } else {
        setSession({ kind: body.error?.code === 'auth_not_configured' ? 'unconfigured' : 'unavailable' });
      }
    } catch {
      if (!controller.signal.aborted) setSession({ kind: 'unavailable' });
    }
  }, []);

  useEffect(() => {
    void checkSession();
    const onRejected = () => {
      setSignInError('Your session expired or access changed. Sign in again to continue. Unsaved changes could not be saved.');
      if (signOutPending.current) {
        setSession({ kind: 'signed-out' });
        return;
      }
      void checkSession(true);
    };
    const onFocus = () => { void checkSession(); };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void checkSession();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      setSigningIn(false);
      void checkSession(true);
    };
    window.addEventListener(CONSOLE_SESSION_EXPIRED, onRejected);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      requestRef.current?.abort();
      window.removeEventListener(CONSOLE_SESSION_EXPIRED, onRejected);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [checkSession]);

  const signOut = async () => {
    if (signOutPending.current) return;
    signOutPending.current = true;
    requestRef.current?.abort();
    setSigningOut(true);
    setSignOutError(null);
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error('Sign-out failed');
      setSession({ kind: 'signed-out' });
      setSignInError(null);
      window.history.replaceState(null, '', '/console/login');
    } catch {
      setSignOutError('Sign-out could not be completed. Try again.');
    } finally {
      signOutPending.current = false;
      setSigningOut(false);
    }
  };

  const signIn = async () => {
    if (signingIn || signOutPending.current) return;
    setSigningIn(true);
    setSignInError(null);
    try {
      if (session.kind === 'denied') {
        const cleared = await authClient.signOut();
        if (cleared.error) throw new Error('Could not clear the denied session');
      }
      const result = await authClient.signIn.social({
        provider: 'google',
        callbackURL: consoleReturnPath(),
        errorCallbackURL: '/console/login?error=google_sign_in_failed',
      });
      if (result.error) throw new Error('Google sign-in failed');
    } catch {
      setSignInError('Google sign-in could not start. Check your connection and try again.');
      setSigningIn(false);
    }
  };

  const canSignIn = session.kind === 'signed-out' || session.kind === 'denied';

  return session.kind === 'signed-in' ? (
    <ConsoleSessionContext.Provider value={{ user: session.user, signOut, signingOut, signOutError }}>
      {children}
    </ConsoleSessionContext.Provider>
  ) : (
    <div className="console-auth-page">
      <a className="skip-link" href="#console-login">Skip to main content</a>
      <header className="console-auth-brand console-brand">
        <strong>Nexus</strong>
        <span>Operations Console</span>
      </header>
      <main id="console-login" className="console-auth-card" tabIndex={-1}>
        <p className="console-auth-kicker">Operations Console</p>
        <h1>{session.kind === 'checking' ? 'Checking your session' : 'Sign in to Nexus'}</h1>
        {session.kind === 'checking' ? <p id="console-auth-status" role="status">Checking access to your Console…</p> : null}
        {canSignIn ? <p>Use your authorized Google account to manage Products and Orders.</p> : null}
        {session.kind === 'denied' ? (
          <p className="console-auth-notice" role="alert">This Google account does not have Console access. Ask the Console administrator for access or sign in with a different account.</p>
        ) : null}
        {session.kind === 'unconfigured' ? (
          <p id="console-auth-status" className="console-auth-notice" role="alert">Google sign-in is not configured yet. The sign-in button will be available once the Console administrator completes setup.</p>
        ) : null}
        {session.kind === 'unavailable' ? (
          <p id="console-auth-status" className="console-auth-notice" role="alert">We could not verify your Console session. Check your connection and try again.</p>
        ) : null}
        {signInError && session.kind !== 'checking' ? <p className="console-auth-notice" role="alert">{signInError}</p> : null}
        <button
          className="button button-primary"
          type="button"
          disabled={!canSignIn || signingIn || signingOut}
          aria-describedby={!canSignIn ? 'console-auth-status' : undefined}
          onClick={() => void signIn()}
        >
          {signingOut ? 'Signing out…' : signingIn ? 'Connecting to Google…' : 'Continue with Google'}
        </button>
        {session.kind === 'unconfigured' || session.kind === 'unavailable' ? (
          <button className="button" type="button" onClick={() => void checkSession(true)}>Try again</button>
        ) : null}
      </main>
    </div>
  );
}

export function ConsoleAccountControl() {
  const session = useConsoleSession();
  return session ? (
    <div className="console-auth-account">
      <div className="console-account-name">{session.user.name || session.user.email}</div>
      <div className="console-account-meta">{session.user.email}</div>
      <button className="button" type="button" disabled={session.signingOut} onClick={() => void session.signOut()}>
        {session.signingOut ? 'Signing out…' : 'Sign out'}
      </button>
      {session.signOutError ? <p className="console-auth-notice" role="alert">{session.signOutError}</p> : null}
    </div>
  ) : null;
}
