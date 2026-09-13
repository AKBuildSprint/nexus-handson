export const S4_POPULATED_FIXTURE = {
  stores: {
    a: { id: 'store_nexus', slug: 'nexus', name: 'Nexus' },
    b: { id: 'store_b', slug: 'store-b', name: 'Store B' },
  },
  users: {
    ownerA: { id: 'user_owner_a', email: 'owner-a@fixture.invalid', name: 'Owner A' },
    staffA1: { id: 'user_staff_a1', email: 'staff-a1@fixture.invalid', name: 'Staff A1' },
    staffA2: { id: 'user_staff_a2', email: 'staff-a2@fixture.invalid', name: 'Staff A2' },
    ownerB: { id: 'user_owner_b', email: 'owner-b@fixture.invalid', name: 'Owner B' },
    staffB: { id: 'user_staff_b', email: 'staff-b@fixture.invalid', name: 'Staff B' },
  },
  products: {
    a: {
      id: 'product_a',
      key: 'stores/store_nexus/products/product_a/package.pdf',
      importKey: 'stores/store_nexus/imports/import_a/source.csv',
    },
    b: { id: 'product_b', key: 'stores/store_b/products/product_b/package.zip' },
  },
  orders: {
    a: { id: 'order_a', reference: 'NX-AAAAAAAAAAAAAAAA', capabilityDigest: 'a'.repeat(64) },
    legacy: { id: 'order_legacy', reference: 'NX-CCCCCCCCCCCCCCCC', capabilityDigest: 'c'.repeat(64) },
    b: { id: 'order_b', reference: 'NX-BBBBBBBBBBBBBBBB', capabilityDigest: 'b'.repeat(64) },
  },
} as const;

const NOW = '2026-09-12T00:00:00.000Z';

export async function seedSchemaSeven(database: D1Database, files: R2Bucket): Promise<void> {
  const fixture = S4_POPULATED_FIXTURE;
  const statements = [
    database.prepare('INSERT INTO stores (id,slug,name,created_at) VALUES (?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(fixture.stores.b.id, fixture.stores.b.slug, fixture.stores.b.name, NOW),
    database.prepare(`INSERT INTO products (id,store_id,slug,name,name_search_key,slug_search_key,status,product_type,currency,base_price_minor,public_description,delivery_access_title,delivery_access_instructions,delivery_file_key,delivery_file_filename,delivery_file_size,delivery_file_kind,delivery_file_checksum,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(fixture.products.a.id, fixture.stores.a.id, 'fixture-a', 'Fixture A', 'fixture a', 'fixture-a', 'active', 'simple', 'USD', 1200, 'Public A', 'Package A', 'Private A', fixture.products.a.key, 'package.pdf', 4, 'pdf', 'a'.repeat(64), 3, NOW, NOW),
    database.prepare(`INSERT INTO products (id,store_id,slug,name,name_search_key,slug_search_key,status,product_type,currency,base_price_minor,public_description,delivery_access_title,delivery_access_instructions,delivery_file_key,delivery_file_filename,delivery_file_size,delivery_file_kind,delivery_file_checksum,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(fixture.products.b.id, fixture.stores.b.id, 'fixture-b', 'Fixture B', 'fixture b', 'fixture-b', 'active', 'simple', 'USD', 900, 'Public B', 'Package B', 'Private B', fixture.products.b.key, 'package.zip', 4, 'zip', 'b'.repeat(64), 2, NOW, NOW),
    database.prepare("INSERT INTO product_option_groups (id,store_id,product_id,name,comparison_key,position,participating,active) VALUES ('csvgrp_fixture_a','store_nexus','product_a','Format','format',0,1,0)"),
    database.prepare("INSERT INTO product_option_values (id,store_id,product_id,group_id,label,comparison_key,position,active) VALUES ('csvval_fixture_pdf','store_nexus','product_a','csvgrp_fixture_a','PDF','pdf',0,1)"),
    database.prepare("INSERT INTO product_variants (id,store_id,product_id,combination_key,sku,status,current_schema,price_override_minor,delivery_source,created_at,updated_at) VALUES ('csvvar_fixture_pdf','store_nexus','product_a','format=pdf','FIXTURE-PDF','enabled',0,NULL,'product_default',?,?)").bind(NOW, NOW),
    database.prepare("INSERT INTO product_variant_values (variant_id,value_id,group_id,product_id,store_id) VALUES ('csvvar_fixture_pdf','csvval_fixture_pdf','csvgrp_fixture_a','product_a','store_nexus')"),
    database.prepare('INSERT INTO imports (id,store_id,original_filename,size_bytes,detected_type,added_count,duplicate_count,rejected_count,private_object_key,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind('import_a', fixture.stores.a.id, 'fixture.csv', 24, 'variant', 1, 0, 0, fixture.products.a.importKey, NOW),
    database.prepare('INSERT INTO customers (id,store_id,name,email_normalized,created_at,updated_at) VALUES (?,?,?,?,?,?)').bind('customer_a', fixture.stores.a.id, 'Customer A', 'customer-a@fixture.invalid', NOW, NOW),
    database.prepare('INSERT INTO customers (id,store_id,name,email_normalized,created_at,updated_at) VALUES (?,?,?,?,?,?)').bind('customer_b', fixture.stores.b.id, 'Customer B', 'customer-b@fixture.invalid', NOW, NOW),
    database.prepare(`INSERT INTO order_lines (id,store_id,order_id,product_id,product_name,variant_id,variant_sku,selected_options_json,quantity,unit_price_minor,line_total_minor,currency,access_title,access_instructions,private_file_key,position) VALUES (?,?,?,?,?,NULL,NULL,'[]',1,?,?,?,'Package','Private',?,0)`).bind('line_a', fixture.stores.a.id, fixture.orders.a.id, fixture.products.a.id, 'Fixture A', 1200, 1200, 'USD', fixture.products.a.key),
    database.prepare(`INSERT INTO order_lines (id,store_id,order_id,product_id,product_name,variant_id,variant_sku,selected_options_json,quantity,unit_price_minor,line_total_minor,currency,access_title,access_instructions,private_file_key,position) VALUES (?,?,?,?,?,NULL,NULL,'[]',1,?,?,?,'Package','Private',?,0)`).bind('line_legacy', fixture.stores.a.id, fixture.orders.legacy.id, fixture.products.a.id, 'Fixture A legacy', 1200, 1200, 'USD', fixture.products.a.key),
    database.prepare(`INSERT INTO order_lines (id,store_id,order_id,product_id,product_name,variant_id,variant_sku,selected_options_json,quantity,unit_price_minor,line_total_minor,currency,access_title,access_instructions,private_file_key,position) VALUES (?,?,?,?,?,NULL,NULL,'[]',1,?,?,?,'Package','Private',?,0)`).bind('line_b', fixture.stores.b.id, fixture.orders.b.id, fixture.products.b.id, 'Fixture B', 900, 900, 'USD', fixture.products.b.key),
    database.prepare('INSERT INTO orders (id,store_id,reference,customer_id,customer_name,customer_email_normalized,status,currency,total_minor,created_at,payment_reference) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(fixture.orders.a.id, fixture.stores.a.id, fixture.orders.a.reference, 'customer_a', 'Customer A', 'customer-a@fixture.invalid', 'paid', 'USD', 1200, NOW, 'NPAFIXTURE'),
    database.prepare('INSERT INTO orders (id,store_id,reference,customer_id,customer_name,customer_email_normalized,status,currency,total_minor,created_at,payment_reference) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(fixture.orders.legacy.id, fixture.stores.a.id, fixture.orders.legacy.reference, 'customer_a', 'Customer A', 'customer-a@fixture.invalid', 'paid', 'USD', 1200, NOW, 'NPLEGACYFIXTURE'),
    database.prepare('INSERT INTO orders (id,store_id,reference,customer_id,customer_name,customer_email_normalized,status,currency,total_minor,created_at,payment_reference) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(fixture.orders.b.id, fixture.stores.b.id, fixture.orders.b.reference, 'customer_b', 'Customer B', 'customer-b@fixture.invalid', 'paid', 'USD', 900, NOW, 'NPBFIXTURE'),
    ...Object.entries(fixture.orders).map(([key, order]) => database.prepare('INSERT INTO order_access (id,store_id,order_id,capability_digest,created_at) VALUES (?,?,?,?,?)').bind(`access_${key}`, key === 'b' ? fixture.stores.b.id : fixture.stores.a.id, order.id, order.capabilityDigest, NOW)),
    database.prepare("INSERT INTO order_idempotency (id,store_id,request_key,order_id,capability_digest,created_at) VALUES ('idempotency_a','store_nexus','fixture_order_0001','order_a',?,?)").bind(fixture.orders.a.capabilityDigest, NOW),
    database.prepare("INSERT INTO order_refund_requests (id,store_id,order_id,status,reason,created_at,actor_source,actor_id) VALUES ('refund_a',?,?, 'pending','Preserve pending request',?,'storefront',NULL)").bind(fixture.stores.a.id, fixture.orders.a.id, NOW),
    database.prepare("INSERT INTO order_history (id,store_id,order_id,status,created_at,action,source,from_status,actor_id,contract_version,refund_request_id) VALUES ('history_a_created',?,?,'pending',?,'order_created','storefront',NULL,NULL,2,NULL)").bind(fixture.stores.a.id, fixture.orders.a.id, NOW),
    database.prepare("INSERT INTO order_history (id,store_id,order_id,status,created_at,action,source,from_status,actor_id,contract_version,refund_request_id) VALUES ('history_a_paid',?,?,'paid',?,'order_paid','bootstrap_owner','pending',NULL,2,NULL)").bind(fixture.stores.a.id, fixture.orders.a.id, NOW),
    database.prepare("INSERT INTO order_history (id,store_id,order_id,status,created_at,action,source,from_status,actor_id,contract_version,refund_request_id) VALUES ('history_a_refund',?,?,'paid',?,'refund_requested','storefront','paid',NULL,2,'refund_a')").bind(fixture.stores.a.id, fixture.orders.a.id, NOW),
    database.prepare("INSERT INTO order_history (id,store_id,order_id,status,created_at,action,source,from_status,actor_id,contract_version,refund_request_id) VALUES ('history_legacy_paid',?,?,'paid',?,'order_paid','bootstrap_owner','pending',NULL,2,NULL)").bind(fixture.stores.a.id, fixture.orders.legacy.id, NOW),
    database.prepare("INSERT INTO order_history (id,store_id,order_id,status,created_at,action,source,from_status,actor_id,contract_version,refund_request_id) VALUES ('history_b_paid',?,?,'paid',?,'order_paid','bootstrap_owner','pending',NULL,2,NULL)").bind(fixture.stores.b.id, fixture.orders.b.id, NOW),
    database.prepare("INSERT INTO order_commands (id,store_id,request_key,order_id,action,payload_hash,result_history_id,created_at,contract_version,result_refund_request_id) VALUES ('command_a_paid',?,'fixture_mark_paid_0001',?,'mark_paid',?,'history_a_paid',?,2,NULL)").bind(fixture.stores.a.id, fixture.orders.a.id, '1'.repeat(64), NOW),
    database.prepare("INSERT INTO order_commands (id,store_id,request_key,order_id,action,payload_hash,result_history_id,created_at,contract_version,result_refund_request_id) VALUES ('command_a_refund',?,'fixture_refund_req_0001',?,'request_refund',?,'history_a_refund',?,2,'refund_a')").bind(fixture.stores.a.id, fixture.orders.a.id, '2'.repeat(64), NOW),
    database.prepare("INSERT INTO payments (id,store_id,order_id,source,method,external_reference,amount_minor,currency,status,history_id,recorded_actor_source,recorded_actor_id,recorded_at) VALUES ('payment_a',?,?,'manual','Bank transfer','WIRE-A',1200,'USD','succeeded','history_a_paid','bootstrap_owner',NULL,?)").bind(fixture.stores.a.id, fixture.orders.a.id, NOW),
  ];
  await database.batch(statements);
  await files.put(fixture.products.a.key, new Uint8Array([1, 2, 3, 4]));
  await files.put(fixture.products.a.importKey, 'sku,format\nFIXTURE-PDF,pdf\n');
  await files.put(fixture.products.b.key, new Uint8Array([5, 6, 7, 8]));
}

export async function seedSchemaNineAssignment(database: D1Database): Promise<void> {
  const fixture = S4_POPULATED_FIXTURE;
  const users = Object.values(fixture.users);
  await database.batch([
    ...users.map((user) => database.prepare('INSERT INTO "user" (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,1,?,?)').bind(user.id, user.name, user.email, NOW, NOW)),
    database.prepare("INSERT INTO store_memberships (id,store_id,user_id,role,status) VALUES ('membership_owner_a','store_nexus','user_owner_a','owner','active')"),
    database.prepare("INSERT INTO store_memberships (id,store_id,user_id,role,status) VALUES ('membership_staff_a1','store_nexus','user_staff_a1','staff','active')"),
    database.prepare("INSERT INTO store_memberships (id,store_id,user_id,role,status) VALUES ('membership_staff_a2','store_nexus','user_staff_a2','staff','active')"),
    database.prepare("INSERT INTO store_memberships (id,store_id,user_id,role,status) VALUES ('membership_owner_b','store_b','user_owner_b','owner','active')"),
    database.prepare("INSERT INTO store_memberships (id,store_id,user_id,role,status) VALUES ('membership_staff_b','store_b','user_staff_b','staff','active')"),
    database.prepare("INSERT INTO order_history (id,store_id,order_id,status,created_at,action,source,from_status,actor_id,contract_version,refund_request_id,assignee_user_id) VALUES ('history_assign_a','store_nexus','order_a','paid',?,'assigned','user','paid','user_owner_a',2,NULL,'user_staff_a1')").bind(NOW),
    database.prepare("INSERT INTO order_commands (id,store_id,request_key,order_id,action,payload_hash,result_history_id,created_at,contract_version,result_refund_request_id) VALUES ('command_assign_a','store_nexus','fixture_assign_000001','order_a','assign',?,'history_assign_a',?,2,NULL)").bind('3'.repeat(64), NOW),
    database.prepare("INSERT INTO order_assignments (store_id,order_id,assignee_user_id,assigned_by_user_id,history_id,assigned_at) VALUES ('store_nexus','order_a','user_staff_a1','user_owner_a','history_assign_a',?)").bind(NOW),
  ]);
}
