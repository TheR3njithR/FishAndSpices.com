import pg from 'pg';

const { Client } = pg;
const connectionString = process.env.DATABASE_UNPOOLED_URL || process.env.DATABASE_URL;
const references = String(process.env.TEST_PUBLIC_REFERENCES || '').split(',').map(value => value.trim()).filter(Boolean);
const administratorEmail = String(process.env.TEST_ADMIN_EMAIL || '').trim().toLowerCase();

if (!connectionString) throw new Error('DATABASE_UNPOOLED_URL or DATABASE_URL is required.');
if (process.env.CONFIRM_TEST_CLEANUP !== 'true') throw new Error('CONFIRM_TEST_CLEANUP=true is required.');
if (!references.length && !administratorEmail) throw new Error('Provide TEST_PUBLIC_REFERENCES and/or TEST_ADMIN_EMAIL.');
if (references.some(reference => !/^FAS-[BS]-[0-9]{8}-[A-Z0-9]{8,12}$/.test(reference))) throw new Error('Every test reference must be a complete FAS public reference.');
if (administratorEmail && !administratorEmail.endsWith('@example.invalid')) throw new Error('Test administrator cleanup is restricted to @example.invalid.');

const client = new Client({ connectionString, application_name: 'fish-and-spices-test-cleanup' });
await client.connect();
try {
  await client.query('begin');
  let deletedLeads = 0;
  let deletedAdministrators = 0;

  if (references.length) {
    const leads = await client.query(`select id, contact_id, organisation_id, customer_user_id from leads where public_reference = any($1::text[]) for update`, [references]);
    if (leads.rowCount !== references.length) throw new Error(`Expected ${references.length} exact test leads but found ${leads.rowCount}.`);
    const leadIds = leads.rows.map(row => row.id);
    const contactIds = leads.rows.map(row => row.contact_id);
    const organisationIds = leads.rows.map(row => row.organisation_id);
    const customerUserIds = leads.rows.map(row => row.customer_user_id).filter(Boolean);
    const locationRows = await client.query('select distinct location_id from fas_lead_locations where lead_id = any($1::uuid[])', [leadIds]);
    const locationIds = locationRows.rows.map(row => row.location_id);
    const matches = await client.query('delete from matches where buyer_lead_id = any($1::uuid[]) or seller_lead_id = any($1::uuid[]) returning id', [leadIds]);
    await client.query('delete from audit_log where entity_identifier = any($1::text[])', [[...references, ...leadIds, ...matches.rows.map(row => row.id)]]);
    deletedLeads = (await client.query('delete from leads where id = any($1::uuid[])', [leadIds])).rowCount;
    if (locationIds.length) {
      await client.query('delete from fas_user_locations where location_id = any($1::uuid[])', [locationIds]);
      await client.query('delete from fas_organisation_locations where location_id = any($1::uuid[])', [locationIds]);
      await client.query(`delete from fas_locations where id = any($1::uuid[])
        and not exists (select 1 from fas_lead_locations where location_id = fas_locations.id)
        and not exists (select 1 from fas_buyer_requirement_locations where location_id = fas_locations.id)
        and not exists (select 1 from fas_seller_offer_locations where location_id = fas_locations.id)
        and not exists (select 1 from fas_business_site_locations where location_id = fas_locations.id)`, [locationIds]);
    }
    await client.query('delete from contacts where id = any($1::uuid[]) and not exists (select 1 from leads where contact_id = contacts.id)', [contactIds]);
    await client.query(`delete from fas_organisation_members where organisation_id = any($1::uuid[])
      and not exists (select 1 from leads where organisation_id = fas_organisation_members.organisation_id)`, [organisationIds]);
    await client.query('delete from organisations where id = any($1::uuid[]) and not exists (select 1 from leads where organisation_id = organisations.id)', [organisationIds]);
    if (customerUserIds.length) {
      await client.query(`delete from fas_user_identities i using fas_customer_users u
        where i.user_id = u.id and u.id = any($1::uuid[]) and u.status = 'guest'
        and not exists (select 1 from leads where customer_user_id = u.id)
        and not exists (select 1 from fas_organisation_members where user_id = u.id)`, [customerUserIds]);
      await client.query(`delete from fas_customer_users u where u.id = any($1::uuid[]) and u.status = 'guest'
        and not exists (select 1 from leads where customer_user_id = u.id)
        and not exists (select 1 from fas_organisation_members where user_id = u.id)`, [customerUserIds]);
    }
  }

  if (administratorEmail) {
    const administrator = await client.query('select id from administrator_users where email = $1 for update', [administratorEmail]);
    if (administrator.rowCount !== 1) throw new Error('Expected exactly one test administrator.');
    await client.query('delete from audit_log where administrator_id = $1', [administrator.rows[0].id]);
    deletedAdministrators = (await client.query('delete from administrator_users where id = $1', [administrator.rows[0].id])).rowCount;
  }

  await client.query('commit');
  console.log(`Removed ${deletedLeads} explicit test lead(s) and ${deletedAdministrators} test administrator(s).`);
} catch (error) {
  await client.query('rollback');
  throw error;
} finally {
  await client.end();
}