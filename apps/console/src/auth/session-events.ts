export const CONSOLE_SESSION_EXPIRED = 'nexus:console-session-expired';

export function notifySessionRejected(status: number): void {
  if ((status === 401 || status === 403) && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(CONSOLE_SESSION_EXPIRED));
  }
}
