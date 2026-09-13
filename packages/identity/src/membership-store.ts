import type {
  ActiveMembership,
  ActiveMembershipResolution,
  StoreRole,
} from './identity-types';

interface ActiveMembershipRow {
  id: string;
  store_id: string;
  store_name: string;
  user_id: string;
  role: StoreRole;
  status: 'active';
  created_at: string;
  updated_at: string;
}

function membershipFromRow(row: ActiveMembershipRow): ActiveMembership {
  return {
    id: row.id,
    storeId: row.store_id,
    storeName: row.store_name,
    userId: row.user_id,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function resolveActiveMembership(
  database: D1Database,
  userId: string,
): Promise<ActiveMembershipResolution> {
  const rows = await database.prepare(
    `SELECT membership.id,
            membership.store_id,
            store.name AS store_name,
            membership.user_id,
            membership.role,
            membership.status,
            membership.created_at,
            membership.updated_at
       FROM store_memberships membership
       JOIN stores store ON store.id = membership.store_id
      WHERE membership.user_id = ? AND membership.status = 'active'
      ORDER BY membership.id
      LIMIT 2`,
  ).bind(userId).all<ActiveMembershipRow>();

  if (rows.results.length === 0) return { kind: 'absent' };
  if (rows.results.length !== 1) return { kind: 'ambiguous' };
  return { kind: 'resolved', membership: membershipFromRow(rows.results[0]) };
}

function checkedAlias(alias: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new TypeError('Invalid SQL alias.');
  return alias;
}

export function activeMembershipPredicate(alias = 'membership'): string {
  const safeAlias = checkedAlias(alias);
  return `${safeAlias}.status = 'active'`;
}

export function activeStaffMembershipPredicate(alias = 'membership'): string {
  const safeAlias = checkedAlias(alias);
  return `${safeAlias}.status = 'active' AND ${safeAlias}.role = 'staff'`;
}
