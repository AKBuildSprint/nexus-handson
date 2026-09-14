import { useState } from 'react';

interface SignInScreenProps {
  expired: boolean;
  onSignIn: () => Promise<void>;
}

interface SignInFailure {
  title: string;
  message: string;
}

export function SignInScreen({ expired, onSignIn }: SignInScreenProps) {
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<SignInFailure | null>(() =>
    new URLSearchParams(window.location.search).has('error')
      ? {
        title: 'Google sign-in was canceled',
        message: 'Google sign-in was canceled or could not be completed. Try again.',
      }
      : null,
  );

  const submit = async () => {
    setSubmitting(true);
    setFailure(null);
    try {
      await onSignIn();
    } catch {
      setFailure({ title: 'Google sign-in could not start', message: 'Google sign-in could not start. Try again.' });
      setSubmitting(false);
    }
  };

  return (
    <main className="console-auth-page">
      <section className="console-auth-card" aria-labelledby="console-sign-in-title">
        <span className="console-auth-mark" aria-hidden="true">N</span>
        <div className="console-auth-intro">
          <p className="console-auth-kicker">Nexus · Operations Console</p>
          <h1 id="console-sign-in-title">Sign in</h1>
          <p className="console-auth-lede">Continue with the Google account provisioned for your Store.</p>
        </div>

        {expired ? (
          <div className="console-auth-notice console-auth-notice-info" role="status">
            <strong>Your session ended</strong>
            <p>Sign in again to return to the Console.</p>
          </div>
        ) : null}

        {failure ? (
          <div className="console-auth-notice console-auth-notice-error" role="alert">
            <strong>{failure.title}</strong>
            <p>{failure.message}</p>
          </div>
        ) : null}

        <button
          className="button console-auth-google"
          type="button"
          disabled={submitting}
          aria-busy={submitting}
          onClick={() => void submit()}
        >
          {submitting ? 'Connecting to Google…' : 'Continue with Google'}
        </button>

        <div className="console-auth-help">
          <span className="console-auth-help-title">How access works</span>
          <p>Google authenticates the account. An active Nexus Store membership authorizes it — Owners manage the Store, Staff see Products read-only and work only assigned Orders.</p>
          <p>No signup here. Ask an Owner to provision your Google account against this Store.</p>
        </div>
      </section>
    </main>
  );
}
