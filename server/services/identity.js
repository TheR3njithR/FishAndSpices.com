import { parsePhoneNumberFromString } from 'libphonenumber-js';

export function normalizeEmail(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null;
}

export function normalizeMobile(value, defaultCountry = 'IN') {
  const input = String(value || '').trim();
  if (!input) return null;
  const phone = parsePhoneNumberFromString(input, defaultCountry);
  return phone?.isPossible() ? phone.number : null;
}

export function maskIdentity(type, value) {
  if (type === 'email') {
    const [local, domain] = value.split('@');
    return `${local.slice(0, 2)}${'*'.repeat(Math.max(2, local.length - 2))}@${domain}`;
  }
  return `${value.slice(0, Math.min(3, value.length - 4))}${'*'.repeat(Math.max(3, value.length - 7))}${value.slice(-4)}`;
}

export function identitiesFromLead(data) {
  const identities = [];
  const mobile = normalizeMobile(data.phone, data.country === 'India' ? 'IN' : undefined);
  const email = normalizeEmail(data.businessEmail);
  if (mobile) identities.push({ type: 'mobile', value: mobile, masked: maskIdentity('mobile', mobile) });
  if (email) identities.push({ type: 'email', value: email, masked: maskIdentity('email', email) });
  return identities;
}

export async function createGuestIdentity(client, data) {
  const identities = identitiesFromLead(data);
  if (!identities.length) throw new Error('A valid mobile number or email is required.');

  const verified = await client.query(`
    select distinct user_id from fas_user_identities
    where verification_status = 'verified'
      and (identity_type, normalized_value) in (select * from unnest($1::text[], $2::text[]))
  `, [identities.map(identity => identity.type), identities.map(identity => identity.value)]);

  if (verified.rows.length === 1) return { userId: verified.rows[0].user_id, associatedBy: 'verified_identity' };

  const user = await client.query(`insert into fas_customer_users (status, display_name, preferred_contact_method, country)
    values ('guest', $1, $2, $3) returning id`, [data.fullName || null, identities[0].type, data.country || null]);
  const userId = user.rows[0].id;
  for (const [index, identity] of identities.entries()) {
    await client.query(`insert into fas_user_identities (
      user_id, identity_type, normalized_value, masked_value, verification_status, is_primary
    ) values ($1,$2,$3,$4,'unverified',$5)`, [userId, identity.type, identity.value, identity.masked, index === 0]);
  }
  return { userId, associatedBy: 'new_guest' };
}
