import { useState } from 'react';

interface SignInScreenProps {
  expired: boolean;
  onSignIn: () => Promise<void>;
}

export function SignInScreen({ expired, onSignIn }: SignInScreenProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).has('error')
      ? 'Google sign-in was canceled or could not be completed.'
      : null,
  );

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await onSignIn();
    } catch {
      setError('Google sign-in could not start. Try again.');
      setSubmitting(false);
    }
  };

  return (
    <main className="console-auth-page">
      <section className="console-auth-card" aria-labelledby="console-sign-in-title">
        <p className="page-kicker">Nexus · Operations Console</p>
        <h1 id="console-sign-in-title">Sign in</h1>
        <p>Continue with the Google account provisioned for your Store.</p>
        {expired ? <div className="notice notice-error" role="alert">Your session ended. Sign in again.</div> : null}
        {error ? <div className="notice notice-error" role="alert">{error}</div> : null}
        <button className="button button-primary" type="button" disabled={submitting} onClick={() => void submit()}>
          {submitting ? 'Connecting to Google…' : 'Continue with Google'}
        </button>
      </section>
    </main>
  );
}
