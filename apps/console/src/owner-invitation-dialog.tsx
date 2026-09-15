import { useEffect, useRef, useState, type RefObject } from 'react';
import { ConsoleApiError, createConsoleOwnerInvitation, type OwnerInvitationView } from './api-client';

interface OwnerInvitationDialogProps {
  dialogRef: RefObject<HTMLDialogElement | null>;
  storeName: string;
  signal: AbortSignal;
  onDismiss: () => void;
  onAuthorizationLost: (error: ConsoleApiError) => void;
}

export function OwnerInvitationDialog({
  dialogRef,
  storeName,
  signal,
  onDismiss,
  onAuthorizationLost,
}: OwnerInvitationDialogProps) {
  const [targetEmail, setTargetEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [invitation, setInvitation] = useState<OwnerInvitationView | null>(null);
  const [copyState, setCopyState] = useState<'ready' | 'copying' | 'copied' | 'error'>('ready');
  const pendingRef = useRef(false);
  const copyingRef = useRef(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const linkRef = useRef<HTMLTextAreaElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (invitation) {
      linkRef.current?.focus();
      linkRef.current?.select();
    } else if (error) errorRef.current?.focus();
  }, [invitation, error]);

  const validateEmail = () => {
    const normalized = targetEmail.trim().toLowerCase();
    setTargetEmail(normalized);
    const valid = normalized.length > 0 && Boolean(emailRef.current?.validity.valid);
    setEmailError(valid ? null : 'Enter a valid Google account email.');
    return valid;
  };

  const submit = async () => {
    if (pendingRef.current || signal.aborted || invitation) return;
    if (!validateEmail()) {
      emailRef.current?.focus();
      return;
    }
    pendingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const result = await createConsoleOwnerInvitation(targetEmail.trim().toLowerCase(), signal);
      if (!signal.aborted) setInvitation(result);
    } catch (failure) {
      if (signal.aborted) return;
      if (failure instanceof ConsoleApiError && (failure.status === 401 || failure.status === 403)) {
        onAuthorizationLost(failure);
      } else if (failure instanceof ConsoleApiError && (failure.code === 'invalid_email' || failure.code === 'validation_failed')) {
        setEmailError('Enter a valid Google account email.');
        setError('Check the Google account email and try again.');
      } else if (failure instanceof ConsoleApiError && failure.code === 'target_unavailable') {
        setError('This Google account cannot be invited.');
      } else {
        setError('The invitation could not be created. Try again.');
      }
    } finally {
      pendingRef.current = false;
      if (!signal.aborted) setSubmitting(false);
    }
  };

  const copyLink = async () => {
    if (!invitation || copyingRef.current || signal.aborted) return;
    copyingRef.current = true;
    setCopyState('copying');
    try {
      await navigator.clipboard.writeText(invitation.invitationUrl);
      if (!signal.aborted) setCopyState('copied');
    } catch {
      if (signal.aborted) return;
      setCopyState('error');
      linkRef.current?.focus();
      linkRef.current?.select();
    } finally {
      copyingRef.current = false;
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="guard-dialog owner-invitation-dialog"
      aria-labelledby="owner-invitation-title"
      aria-describedby="owner-invitation-description"
      onCancel={(event) => { event.preventDefault(); onDismiss(); }}
    >
      <div className="guard-content">
        <h2 id="owner-invitation-title">Invite an Owner</h2>
        <p id="owner-invitation-description">Grant full Owner access to {storeName}. Share the link yourself; no email is sent.</p>
        {invitation ? (
          <div className="guard-content">
            <div className="notice notice-success" role="status">
              <strong>Invitation created</strong>
              <p>Share this one-time link only with {invitation.targetEmail}. Copy it before closing; it cannot be shown again.</p>
            </div>
            <div className="field">
              <label htmlFor="owner-invitation-link">Invitation link</label>
              <textarea
                ref={linkRef}
                id="owner-invitation-link"
                value={invitation.invitationUrl}
                readOnly
                rows={3}
                spellCheck={false}
                autoComplete="off"
                aria-describedby="owner-invitation-expiry owner-invitation-copy-status"
                onFocus={(event) => event.currentTarget.select()}
              />
            </div>
            <p id="owner-invitation-expiry">Expires <time dateTime={invitation.expiresAt}>{new Date(invitation.expiresAt).toLocaleString()}</time>.</p>
            <p id="owner-invitation-copy-status" className={copyState === 'error' ? 'field-error' : 'field-help'} role={copyState === 'error' ? 'alert' : 'status'}>
              {copyState === 'copied' ? 'Link copied.' : copyState === 'error' ? 'Copy was blocked. Select the link above and copy it manually.' : 'The recipient must sign in with the invited Google account.'}
            </p>
            <div className="owner-invitation-actions">
              <button className="button" type="button" onClick={onDismiss}>Close</button>
              <button className="button button-primary" type="button" disabled={copyState === 'copying'} onClick={() => void copyLink()}>
                {copyState === 'copying' ? 'Copying…' : 'Copy link'}
              </button>
            </div>
          </div>
        ) : (
          <form className="guard-content" noValidate onSubmit={(event) => { event.preventDefault(); void submit(); }}>
            <div className="field">
              <label htmlFor="owner-invitation-email">Google account email</label>
              <input
                ref={emailRef}
                id="owner-invitation-email"
                type="email"
                name="targetEmail"
                value={targetEmail}
                required
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                disabled={submitting}
                aria-invalid={emailError !== null}
                aria-describedby={`owner-invitation-email-help${emailError ? ' owner-invitation-email-error' : ''}`}
                onChange={(event) => { setTargetEmail(event.currentTarget.value); setEmailError(null); }}
                onBlur={validateEmail}
              />
              <p id="owner-invitation-email-help" className="field-help">Owner access is fixed. Use the exact Google account email.</p>
              {emailError ? <p id="owner-invitation-email-error" className="field-error" role="alert">{emailError}</p> : null}
            </div>
            {error ? <div ref={errorRef} className="notice notice-error" role="alert" tabIndex={-1}>{error}</div> : null}
            <div className="owner-invitation-actions">
              <button className="button" type="button" onClick={onDismiss}>Cancel</button>
              <button className="button button-primary" type="submit" disabled={submitting}>
                {submitting ? 'Creating invitation…' : 'Create invitation'}
              </button>
            </div>
          </form>
        )}
      </div>
    </dialog>
  );
}
