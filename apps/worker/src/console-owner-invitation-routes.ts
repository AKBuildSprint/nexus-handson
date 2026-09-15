import { createOwnerInvitation, OwnerInvitationError } from '@nexus/identity/invitations';
import { NEXUS_STORE_ID } from '@nexus/identity/identity-types';
import type { ConsoleRequestContext } from './auth';
import { jsonError, jsonResponse } from './http-response';

export async function routeConsoleOwnerInvitationRequest(
  request: Request,
  database: D1Database,
  consoleOrigin: string,
  secret: string,
  context: ConsoleRequestContext,
): Promise<Response | null> {
  if (request.method !== 'POST' || new URL(request.url).pathname !== '/api/console/owner-invitations') return null;
  if (
    context.identity.role !== 'owner'
    || context.identity.membershipStatus !== 'active'
    || context.identity.storeId !== NEXUS_STORE_ID
  ) return jsonError(403, 'issuer_not_owner', 'Active Owner access is required to invite an Owner.');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'invalid_json', 'The request body is not valid JSON.');
  }
  if (
    body === null
    || typeof body !== 'object'
    || Array.isArray(body)
    || !('targetEmail' in body)
    || typeof body.targetEmail !== 'string'
    || Object.keys(body).some((key) => key !== 'targetEmail')
  ) {
    return jsonError(422, 'validation_failed', 'Provide only the target email.', [
      { path: '/targetEmail', code: 'invalid_email', message: 'Enter the Google account email to invite.' },
    ]);
  }

  try {
    const invitation = await createOwnerInvitation({
      database,
      secret,
      issuer: context.identity,
      targetEmail: body.targetEmail,
    });
    const invitationUrl = new URL('/console/login', consoleOrigin);
    invitationUrl.hash = `invite=${encodeURIComponent(invitation.token)}`;
    return jsonResponse({
      id: invitation.id,
      invitationUrl: invitationUrl.href,
      expiresAt: invitation.expiresAt,
      targetEmail: invitation.targetEmail,
    }, { status: 201, headers: { 'Referrer-Policy': 'no-referrer' } });
  } catch (error) {
    if (error instanceof OwnerInvitationError) {
      if (error.code === 'issuer_not_owner') {
        return jsonError(403, 'issuer_not_owner', 'Active Owner access is required to invite an Owner.');
      }
      if (error.code === 'invalid_email') {
        return jsonError(422, 'invalid_email', 'Enter a valid Google account email.', [
          { path: '/targetEmail', code: 'invalid_email', message: 'Enter a valid Google account email.' },
        ]);
      }
      if (error.code === 'target_unavailable') {
        return jsonError(409, 'target_unavailable', 'This Google account cannot be invited.');
      }
      if (error.code === 'store_unavailable') {
        return jsonError(503, 'store_unavailable', 'The Store is unavailable. Try again later.');
      }
    }
    return jsonError(503, 'create_failed', 'The invitation could not be created. Try again.');
  }
}
