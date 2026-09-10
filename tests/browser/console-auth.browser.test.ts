import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { ConsoleAuthBoundary } from '../../apps/console/src/auth/console-auth';
import { ConsoleShell } from '../../apps/console/src/layout/console-shell';
import { ProductionConsoleApp } from '../../apps/console/src/production-console-app';
import { downloadCsvTemplate, fetchProducts, importCsvProducts } from '../../apps/console/src/api-client';
import '../../apps/console/src/styles/design-tokens.css';
import '../../apps/console/src/styles/console-layout.css';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;
const user = { id: 'auth-user', email: 'operator@example.com', name: 'Store operator' };

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function rejected(status = 401, code = 'authentication_required') {
  return response({ error: { code, message: 'Access is unavailable.', fields: [], incidentId: null } }, status);
}

function stubFetch(handler: (path: string, init?: RequestInit) => Response | Promise<Response>) {
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return Promise.resolve(handler(new URL(raw, window.location.origin).pathname, init));
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

function button(label: string) {
  const found = [...container.querySelectorAll('button')].find((element) => element.textContent?.trim() === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

async function settle(predicate: () => boolean) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (predicate()) return;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
  expect(predicate()).toBe(true);
}

async function renderBoundary(production = false) {
  await act(async () => root.render(createElement(ConsoleAuthBoundary, {
    children: production ? createElement(ProductionConsoleApp) : createElement(ConsoleShell, {
      onOpenProducts: () => true,
      onOpenOrders: () => true,
      children: createElement('h1', null, 'Private Console content'),
    }),
  })));
  if (!production) await settle(() => !container.textContent?.includes('Checking your session'));
}

beforeEach(async () => {
  window.history.replaceState(null, '', '/console/products');
  await page.viewport(1280, 900);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Console Google sign-in', () => {
  it('does not mount or fetch the private app before session verification', async () => {
    let resolveSession!: (value: Response) => void;
    const fetch = stubFetch(() => new Promise<Response>((resolve) => { resolveSession = resolve; }));
    await renderBoundary(true);
    expect(container.textContent).toContain('Checking your session');
    expect(container.querySelector('.console-shell')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => resolveSession(rejected()));
    await settle(() => container.textContent?.includes('Continue with Google') ?? false);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.console-shell')).toBeNull();
  });

  it('starts Google OAuth with the current Console destination and reports network failure', async () => {
    window.history.replaceState(null, '', '/console/orders/NX-example');
    let socialBody: unknown;
    stubFetch((path, init) => {
      if (path === '/api/console/session') return rejected();
      if (path === '/api/auth/sign-in/social') {
        socialBody = JSON.parse(String(init?.body));
        return response({ message: 'Provider unavailable', code: 'provider_unavailable' }, 503);
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    await renderBoundary();
    await act(async () => button('Continue with Google').click());
    await settle(() => container.textContent?.includes('Google sign-in could not start') ?? false);
    expect(socialBody).toMatchObject({
      provider: 'google',
      callbackURL: '/console/orders/NX-example',
      errorCallbackURL: '/console/login?error=google_sign_in_failed',
    });
    expect(button('Continue with Google').disabled).toBe(false);
  });

  it('allows another sign-in after restoring the pending login page from bfcache', async () => {
    let restored = false;
    let finishCheck!: (value: Response) => void;
    stubFetch((path) => {
      if (path === '/api/console/session') {
        return restored ? new Promise<Response>((resolve) => { finishCheck = resolve; }) : rejected();
      }
      // Keep this document mounted while simulating the provider round trip.
      return response({ redirect: false });
    });
    await renderBoundary();
    await act(async () => button('Continue with Google').click());
    expect(button('Connecting to Google…').disabled).toBe(true);
    restored = true;
    await act(async () => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    expect(container.textContent).toContain('Checking your session');
    expect(container.querySelector('.console-shell')).toBeNull();
    await act(async () => finishCheck(rejected()));
    await settle(() => container.textContent?.includes('Continue with Google') ?? false);
    expect(button('Continue with Google').disabled).toBe(false);
    await act(async () => button('Continue with Google').click());
    expect(button('Connecting to Google…').disabled).toBe(true);
  });

  it('shows cancellation feedback and uses a safe fallback from the login route', async () => {
    window.history.replaceState(null, '', '/console/login?error=access_denied&returnTo=https://other.example');
    let callbackURL: unknown;
    stubFetch((path, init) => {
      if (path === '/api/console/session') return rejected();
      callbackURL = JSON.parse(String(init?.body)).callbackURL;
      return response({ message: 'Could not connect', code: 'provider_unavailable' }, 503);
    });
    await renderBoundary();
    expect(container.textContent).toContain('Google sign-in was canceled');
    await act(async () => button('Continue with Google').click());
    await settle(() => container.textContent?.includes('Google sign-in could not start') ?? false);
    expect(callbackURL).toBe('/console/products');
  });

  it('fails closed for configuration and connection errors and recovers through retry', async () => {
    let attempt = 0;
    stubFetch(() => {
      attempt += 1;
      if (attempt === 1) return rejected(503, 'auth_not_configured');
      if (attempt === 2) return Promise.reject(new Error('offline'));
      return response({ user });
    });
    await renderBoundary();
    expect(container.textContent).toContain('Google sign-in is not configured yet');
    expect(container.querySelector('.console-shell')).toBeNull();
    await act(async () => button('Try again').click());
    await settle(() => container.textContent?.includes('We could not verify your Console session') ?? false);
    expect(container.textContent).toContain('We could not verify your Console session');
    await act(async () => button('Try again').click());
    await settle(() => container.querySelector('.console-shell') !== null);
    expect(container.textContent).toContain('Private Console content');
  });

  it('keeps the Google button visible until configuration is ready, then enables sign-in', async () => {
    await page.viewport(375, 812);
    let configured = false;
    const fetch = stubFetch(() => configured ? rejected() : rejected(503, 'auth_not_configured'));
    await renderBoundary();
    const google = button('Continue with Google');
    expect(google.disabled).toBe(true);
    expect(document.getElementById(google.getAttribute('aria-describedby') ?? '')?.textContent)
      .toContain('Google sign-in is not configured yet');
    await act(async () => google.click());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.console-shell')).toBeNull();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    configured = true;
    await act(async () => button('Try again').click());
    await settle(() => !button('Continue with Google').disabled);
    expect(container.querySelector('.console-shell')).toBeNull();
  });

  it('explains denied access and clears the denied session before a different Google sign-in', async () => {
    const paths: string[] = [];
    stubFetch((path) => {
      paths.push(path);
      if (path === '/api/console/session') return rejected(403, 'access_denied');
      if (path === '/api/auth/sign-out') return response({ success: true });
      return response({ message: 'Provider unavailable' }, 503);
    });
    await renderBoundary();
    expect(container.textContent).toContain('This Google account does not have Console access');
    await act(async () => button('Continue with Google').click());
    await settle(() => container.textContent?.includes('Google sign-in could not start') ?? false);
    expect(paths.indexOf('/api/auth/sign-out')).toBeLessThan(paths.indexOf('/api/auth/sign-in/social'));
  });

  it('keeps a failed sign-out recoverable and removes private content after successful sign-out', async () => {
    let failSignOut = true;
    stubFetch((path) => {
      if (path === '/api/console/session') return response({ user });
      return failSignOut ? response({ message: 'Unavailable' }, 503) : response({ success: true });
    });
    await renderBoundary();
    expect(container.textContent).toContain(user.email);
    await act(async () => button('Sign out').click());
    await settle(() => container.textContent?.includes('Sign-out could not be completed') ?? false);
    expect(container.textContent).toContain('Private Console content');
    failSignOut = false;
    await act(async () => button('Sign out').click());
    await settle(() => container.querySelector('.console-shell') === null);
    expect(container.textContent).toContain('Continue with Google');
    expect(window.location.pathname).toBe('/console/login');
  });

  it.each(['products', 'template', 'import'] as const)('hides private content when the %s request loses access, before the session check finishes', async (operation) => {
    let expired = false;
    let finishCheck!: (value: Response) => void;
    stubFetch((path) => {
      if (path === '/api/console/session') {
        return expired ? new Promise<Response>((resolve) => { finishCheck = resolve; }) : response({ user });
      }
      return rejected();
    });
    await renderBoundary();
    expired = true;
    await act(async () => {
      const request = operation === 'products' ? fetchProducts()
        : operation === 'template' ? downloadCsvTemplate()
          : importCsvProducts(new File(['slug'], 'products.csv'), false);
      await expect(request).rejects.toMatchObject({ status: 401 });
    });
    expect(container.querySelector('.console-shell')).toBeNull();
    expect(container.textContent).toContain('Checking your session');
    await act(async () => finishCheck(rejected()));
    await settle(() => container.textContent?.includes('Your session expired or access changed') ?? false);
    expect(container.textContent).toContain('Your session expired or access changed');
  });

  it('removes access after a window-focus recheck', async () => {
    let expired = false;
    stubFetch(() => expired ? rejected(403, 'access_denied') : response({ user }));
    await renderBoundary();
    expired = true;
    await act(async () => window.dispatchEvent(new Event('focus')));
    await settle(() => container.querySelector('.console-shell') === null);
    expect(container.querySelector('.console-shell')).toBeNull();
    expect(container.textContent).toContain('This Google account does not have Console access');
  });

  it('ignores a stale successful session check after sign-out', async () => {
    let checkingAgain = false;
    let finishCheck!: (value: Response) => void;
    stubFetch((path) => {
      if (path === '/api/auth/sign-out') return response({ success: true });
      return checkingAgain ? new Promise<Response>((resolve) => { finishCheck = resolve; }) : response({ user });
    });
    await renderBoundary();
    checkingAgain = true;
    await act(async () => window.dispatchEvent(new Event('focus')));
    await act(async () => button('Sign out').click());
    await settle(() => container.querySelector('.console-shell') === null);
    await act(async () => {
      finishCheck(response({ user }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.querySelector('.console-shell')).toBeNull();
    expect(container.textContent).toContain('Continue with Google');
  });

  it('hides rejected private content during sign-out and prevents overlapping sign-in', async () => {
    let finishSignOut!: (value: Response) => void;
    stubFetch((path) => {
      if (path === '/api/console/session') return response({ user });
      if (path === '/api/auth/sign-out') return new Promise<Response>((resolve) => { finishSignOut = resolve; });
      return rejected();
    });
    await renderBoundary();
    await act(async () => button('Sign out').click());
    await settle(() => finishSignOut !== undefined);
    await act(async () => { await expect(fetchProducts()).rejects.toMatchObject({ status: 401 }); });
    expect(container.querySelector('.console-shell')).toBeNull();
    expect(button('Signing out…').disabled).toBe(true);
    await act(async () => finishSignOut(response({ success: true })));
    await settle(() => container.textContent?.includes('Continue with Google') ?? false);
    expect(button('Continue with Google').disabled).toBe(false);
  });

  it('keeps login and the compact account menu within 375px and uses the primary token colors', async () => {
    await page.viewport(375, 812);
    let signedIn = false;
    stubFetch(() => signedIn ? response({ user: { ...user, email: 'a-very-long-operator-email-address@example.com' } }) : rejected());
    await renderBoundary();
    const primary = getComputedStyle(button('Continue with Google'));
    const tokens = getComputedStyle(document.documentElement);
    const probe = document.createElement('span');
    probe.style.backgroundColor = tokens.getPropertyValue('--color-accent');
    probe.style.color = tokens.getPropertyValue('--color-accent-ink');
    container.appendChild(probe);
    expect(primary.backgroundColor).toBe(getComputedStyle(probe).backgroundColor);
    expect(primary.color).toBe(getComputedStyle(probe).color);
    probe.remove();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    signedIn = true;
    await act(async () => window.dispatchEvent(new Event('focus')));
    await settle(() => container.querySelector('.console-shell') !== null);
    await act(async () => button('Menu').click());
    const menu = container.querySelector<HTMLElement>('#compact-console-nav');
    expect(menu?.textContent).toContain('Sign out');
    expect(menu?.getBoundingClientRect().right).toBeLessThanOrEqual(375);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(container.querySelector('#compact-console-nav')).toBeNull();
    expect(document.activeElement).toBe(button('Menu'));
  });
});
