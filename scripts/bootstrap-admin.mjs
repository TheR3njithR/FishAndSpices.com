import bcrypt from 'bcryptjs';
import pg from 'pg';

const { Client } = pg;
const email = String(process.env.ADMIN_BOOTSTRAP_EMAIL || '').trim().toLowerCase();
const password = String(process.env.ADMIN_BOOTSTRAP_PASSWORD || '');
const displayName = String(process.env.ADMIN_BOOTSTRAP_NAME || 'Platform Administrator').trim();
const role = process.env.ADMIN_BOOTSTRAP_ROLE || 'super_admin';
const connectionString = process.env.DATABASE_UNPOOLED_URL || process.env.DATABASE_URL;

if (!connectionString) throw new Error('DATABASE_UNPOOLED_URL or DATABASE_URL is required.');
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('ADMIN_BOOTSTRAP_EMAIL must be a valid email.');
if (password.length < 16) throw new Error('ADMIN_BOOTSTRAP_PASSWORD must contain at least 16 characters.');
if (!['administrator', 'super_admin', 'reviewer'].includes(role)) throw new Error('ADMIN_BOOTSTRAP_ROLE is invalid.');

const client = new Client({ connectionString, application_name: 'fish-and-spices-admin-bootstrap' });
await client.connect();
try {
  const existing = await client.query('select id from administrator_users where email=$1', [email]);
  if (existing.rowCount && process.env.ADMIN_BOOTSTRAP_ROTATE !== 'true') {
    throw new Error('Administrator already exists. Set ADMIN_BOOTSTRAP_ROTATE=true explicitly to rotate its password.');
  }
  const passwordHash = await bcrypt.hash(password, 12);
  if (existing.rowCount) {
    await client.query(`update administrator_users set password_hash=$1, display_name=$2, role=$3, active=true where id=$4`, [passwordHash, displayName, role, existing.rows[0].id]);
    console.log('Administrator password rotated successfully.');
  } else {
    await client.query(`insert into administrator_users (email,password_hash,display_name,role) values ($1,$2,$3,$4)`, [email, passwordHash, displayName, role]);
    console.log('Administrator created successfully.');
  }
} finally {
  await client.end();
}
