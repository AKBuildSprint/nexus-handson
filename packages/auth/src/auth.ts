import { betterAuth } from 'better-auth';

export interface AuthConfiguration {
  BETTER_AUTH_URL?: string;
  BETTER_AUTH_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  CONSOLE_ALLOWED_EMAILS?: string;
}

export class AuthConfigurationError extends Error {
  constructor() {
    super('Console sign-in is not configured.');
    this.name = 'AuthConfigurationError';
  }
}

export function consoleAuthOrigin(configuration: AuthConfiguration): string {
  try {
    const url = new URL(configuration.BETTER_AUTH_URL ?? '');
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (
      (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash
    ) throw new AuthConfigurationError();
    return url.origin;
  } catch {
    throw new AuthConfigurationError();
  }
}

export function consoleEmailAllowed(configuration: AuthConfiguration, email: string): boolean {
  const allowed = (configuration.CONSOLE_ALLOWED_EMAILS ?? '')
    .split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(email.trim().toLowerCase());
}

export function createConsoleAuth(database: D1Database, configuration: AuthConfiguration) {
  const origin = consoleAuthOrigin(configuration);
  if (
    !configuration.BETTER_AUTH_SECRET || configuration.BETTER_AUTH_SECRET.length < 32
    || !configuration.GOOGLE_CLIENT_ID?.trim() || !configuration.GOOGLE_CLIENT_SECRET?.trim()
    || !configuration.CONSOLE_ALLOWED_EMAILS?.split(',').some((email) => email.trim())
  ) throw new AuthConfigurationError();

  return betterAuth({
    appName: 'Nexus',
    baseURL: origin,
    basePath: '/api/auth',
    secret: configuration.BETTER_AUTH_SECRET,
    trustedOrigins: [origin],
    database,
    onAPIError: { errorURL: `${origin}/console/login` },
    socialProviders: {
      google: {
        clientId: configuration.GOOGLE_CLIENT_ID,
        clientSecret: configuration.GOOGLE_CLIENT_SECRET,
        prompt: 'select_account',
        overrideUserInfoOnSignIn: true,
      },
    },
    user: {
      modelName: 'nexus_auth_user',
      validateUserInfo: ({ user, source }) => {
        if (
          source.oauth?.providerId !== 'google' || !user.emailVerified
          || !user.email || !consoleEmailAllowed(configuration, user.email)
        ) return { error: 'access_denied', errorDescription: 'This account cannot access the Console.' };
      },
    },
    session: {
      modelName: 'nexus_auth_session',
      expiresIn: 60 * 60 * 24 * 7,
      disableSessionRefresh: true,
      cookieCache: { enabled: false },
    },
    account: {
      modelName: 'nexus_auth_account',
      encryptOAuthTokens: true,
      accountLinking: { enabled: false },
    },
    verification: { modelName: 'nexus_auth_verification' },
    rateLimit: { enabled: true, storage: 'database', modelName: 'nexus_auth_rate_limit' },
    advanced: {
      cookiePrefix: 'nexus',
      useSecureCookies: origin.startsWith('https:'),
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', path: '/' },
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
    },
    logger: { disabled: true },
  });
}
