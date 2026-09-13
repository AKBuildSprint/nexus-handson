import { betterAuth, type Account, type User } from 'better-auth';
import { resolveActiveMembership } from '@nexus/identity/membership-store';
import type { ConsoleIdentityContext } from '@nexus/identity/identity-types';
import type { Env } from './environment';

export type AuthEnv = Pick<Env, 'DB' | 'CONSOLE_ORIGIN' | 'BETTER_AUTH_SECRET'> &
  Partial<Pick<Env, 'GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_SECRET'>>;

export function createAuth(env: AuthEnv) {
  const googleClientId = env.GOOGLE_CLIENT_ID?.trim();
  const googleClientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  return betterAuth({
    database: env.DB,
    baseURL: env.CONSOLE_ORIGIN,
    secret: env.BETTER_AUTH_SECRET,
    socialProviders: googleClientId && googleClientSecret ? {
      google: {
        clientId: googleClientId,
        clientSecret: googleClientSecret,
        prompt: 'select_account',
        disableSignUp: true,
        disableIdTokenSignIn: true,
      },
    } : {},
    user: {
      validateUserInfo: async ({ user, source }) => {
        if (source.method !== 'oauth') return;
        const subject = source.oauth?.profile?.['sub'];
        if (
          source.oauth?.providerId !== 'google'
          || user.emailVerified !== true
          || typeof user.email !== 'string'
          || typeof subject !== 'string'
          || subject.length === 0
        ) return { error: 'access_denied', errorDescription: 'This Google account cannot access the Console.' };

        const binding = await env.DB.prepare(
          `SELECT user.email
             FROM account
             JOIN "user" user ON user.id=account.userId
             JOIN store_memberships membership ON membership.user_id=user.id
            WHERE account.providerId='google'
              AND account.accountId=?
              AND membership.status='active'`,
        ).bind(subject).first<{ email: string }>();
        if (!binding || binding.email.toLowerCase() !== user.email.trim().toLowerCase()) {
          return { error: 'access_denied', errorDescription: 'This Google account cannot access the Console.' };
        }
      },
    },
    account: {
      encryptOAuthTokens: true,
      accountLinking: { enabled: false },
    },
    trustedOrigins: [env.CONSOLE_ORIGIN],
    rateLimit: {
      enabled: true,
      storage: 'database',
    },
    advanced: {
      database: { validateSchema: true },
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
    },
  });
}

export type NexusAuth = ReturnType<typeof createAuth>;

export interface ConsoleRequestContext {
  identity: ConsoleIdentityContext;
  user: { id: string; name: string };
  store: { id: string; name: string };
}

export type ConsoleContextResolution =
  | { kind: 'resolved'; context: ConsoleRequestContext; authHeaders: Headers }
  | { kind: 'unauthenticated'; authHeaders: Headers }
  | { kind: 'store-access-denied'; authHeaders: Headers }
  | { kind: 'service-unavailable'; authHeaders: Headers };

export async function resolveConsoleRequestContext(
  request: Request,
  env: AuthEnv,
): Promise<ConsoleContextResolution> {
  const authHeaders = new Headers();
  try {
    const sessionResult = await createAuth(env).api.getSession({
      headers: request.headers,
      returnHeaders: true,
    });
    for (const cookie of sessionResult.headers.getSetCookie()) authHeaders.append('Set-Cookie', cookie);
    const session = sessionResult.response;
    if (session === null) return { kind: 'unauthenticated', authHeaders };

    const membership = await resolveActiveMembership(env.DB, session.user.id);
    if (membership.kind !== 'resolved') return { kind: 'store-access-denied', authHeaders };
    const current = membership.membership;
    return {
      kind: 'resolved',
      authHeaders,
      context: {
        identity: {
          kind: 'console',
          userId: session.user.id,
          storeId: current.storeId,
          membershipId: current.id,
          role: current.role,
          membershipStatus: current.status,
        },
        user: { id: session.user.id, name: session.user.name },
        store: { id: current.storeId, name: current.storeName },
      },
    };
  } catch {
    return { kind: 'service-unavailable', authHeaders };
  }
}

type ExistingIdentity = { user: User; accounts: Account[] };

export type GoogleAccountInput = {
  email: string;
  name: string;
  googleSubject: string;
};

export type ProvisionedGoogleAccount = {
  created: boolean;
  recovered: boolean;
  userId: string;
};

export class GoogleProvisioningError extends Error {
  constructor(readonly code: 'invalid_identity' | 'identity_conflict' | 'provisioning_failed') {
    super(code);
    this.name = 'GoogleProvisioningError';
  }
}

function normalizeGoogleInput(input: GoogleAccountInput) {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  const googleSubject = input.googleSubject.trim();
  if (
    email.length < 3
    || email.length > 320
    || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)
    || name.length < 1
    || name.length > 128
    || googleSubject.length < 1
    || googleSubject.length > 255
    || /\s/.test(googleSubject)
  ) {
    throw new GoogleProvisioningError('invalid_identity');
  }
  return { email, name, googleSubject };
}

export async function provisionGoogleAccount(
  auth: NexusAuth,
  input: GoogleAccountInput,
): Promise<ProvisionedGoogleAccount> {
  const identity = normalizeGoogleInput(input);
  const context = await auth.$context;
  const database = context.options.database as D1Database;

  const removeUnboundUser = async (userId: string): Promise<void> => {
    await database.prepare(
      `DELETE FROM "user"
        WHERE id=?
          AND NOT EXISTS (SELECT 1 FROM account WHERE userId=?)
          AND NOT EXISTS (SELECT 1 FROM session WHERE userId=?)
          AND NOT EXISTS (SELECT 1 FROM store_memberships WHERE user_id=?)`,
    ).bind(userId, userId, userId, userId).run();
  };

  const linkGoogleAccount = async (
    userId: string,
    removeUserOnFailure: boolean,
  ): Promise<'linked' | 'already-linked'> => {
    try {
      const linked = await context.internalAdapter.linkAccount({
        accountId: identity.googleSubject,
        providerId: 'google',
        userId,
      });
      if (
        !linked
        || linked.accountId !== identity.googleSubject
        || linked.providerId !== 'google'
        || linked.userId !== userId
      ) throw new Error('Google account binding mismatch.');
      return 'linked';
    } catch {
      const refreshed = await context.internalAdapter.findUserByEmail(identity.email, { includeAccounts: true });
      const googleAccount = refreshed?.accounts.find((account) => account.providerId === 'google');
      if (refreshed?.user.id === userId && googleAccount?.accountId === identity.googleSubject) {
        return 'already-linked';
      }
      if (googleAccount || await context.internalAdapter.findAccountByKey({
        providerId: 'google',
        accountId: identity.googleSubject,
      })) {
        if (removeUserOnFailure) await removeUnboundUser(userId);
        throw new GoogleProvisioningError('identity_conflict');
      }
      if (removeUserOnFailure) await removeUnboundUser(userId);
      throw new GoogleProvisioningError('provisioning_failed');
    }
  };

  const finishExisting = async (
    existing: ExistingIdentity | null,
  ): Promise<ProvisionedGoogleAccount | null> => {
    if (existing === null) return null;
    if (existing.user.email !== identity.email || existing.user.name !== identity.name) {
      throw new GoogleProvisioningError('identity_conflict');
    }

    const googleAccount = existing.accounts.find(
      (account) => account.providerId === 'google',
    );
    if (googleAccount) {
      if (googleAccount.accountId !== identity.googleSubject) throw new GoogleProvisioningError('identity_conflict');
      return { created: false, recovered: false, userId: existing.user.id };
    }

    await linkGoogleAccount(existing.user.id, false);
    return { created: false, recovered: true, userId: existing.user.id };
  };

  const subjectOwner = await context.internalAdapter.findAccountByKey({
    providerId: 'google',
    accountId: identity.googleSubject,
  });
  if (subjectOwner) {
    const owner = await context.internalAdapter.findUserById(subjectOwner.userId);
    if (!owner || owner.email !== identity.email || owner.name !== identity.name) {
      throw new GoogleProvisioningError('identity_conflict');
    }
  }

  const existing = await context.internalAdapter.findUserByEmail(identity.email, { includeAccounts: true });
  const completedExisting = await finishExisting(existing);
  if (completedExisting) return completedExisting;

  let user;
  try {
    const now = new Date();
    user = await context.adapter.create<User>({
      model: 'user',
      data: {
        email: identity.email,
        emailVerified: false,
        name: identity.name,
        createdAt: now,
        updatedAt: now,
      },
    });
  } catch {
    const raced = await context.internalAdapter.findUserByEmail(identity.email, { includeAccounts: true });
    const completedRace = await finishExisting(raced);
    if (completedRace) return completedRace;
    throw new GoogleProvisioningError('provisioning_failed');
  }

  await linkGoogleAccount(user.id, true);
  return { created: true, recovered: false, userId: user.id };
}
