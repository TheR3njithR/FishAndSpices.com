import { getCountries } from 'libphonenumber-js';

const ISO_COUNTRIES = new Set(getCountries());

export const MANAGEABLE_SETS = [
  { key: 'countries', label: 'Countries', valueLabel: 'ISO code (e.g. IN)', valueEditable: false },
  { key: 'calling_codes', label: 'Mobile calling codes', valueLabel: 'Code (e.g. +91)', valueEditable: false },
  { key: 'buyer_types', label: 'Buyer types', valueLabel: 'Value', valueEditable: true },
  { key: 'seller_types', label: 'Seller types', valueLabel: 'Value', valueEditable: true },
  { key: 'incoterms', label: 'Incoterms', valueLabel: 'Value', valueEditable: true }
];

const SET_META = new Map(MANAGEABLE_SETS.map(set => [set.key, set]));

export class MasterDataError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.name = 'MasterDataError';
    this.status = status;
  }
}

function text(value, limit, label) {
  if (typeof value !== 'string') throw new MasterDataError(`${label} is required.`);
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) throw new MasterDataError(`${label} is required.`);
  if (trimmed.length > limit) throw new MasterDataError(`${label} is too long.`);
  return trimmed;
}

function validateValue(setKey, rawValue) {
  const value = text(rawValue, 80, 'Value');
  if (setKey === 'countries') {
    const code = value.toUpperCase();
    if (!/^[A-Z]{2}$/.test(code) || !ISO_COUNTRIES.has(code)) throw new MasterDataError('Enter a valid two-letter ISO country code.');
    return code;
  }
  if (setKey === 'calling_codes') {
    if (!/^\+\d{1,4}$/.test(value)) throw new MasterDataError('Enter a valid calling code such as +91.');
    return value;
  }
  return value;
}

export async function getPublicOptions(pool) {
  if (!pool) return {};
  const result = await pool.query(
    `select set_key, value, label from fas_master_options where is_active = true order by set_key, sort_order, value`
  );
  const grouped = {};
  for (const row of result.rows) {
    (grouped[row.set_key] ||= []).push({ value: row.value, label: row.label });
  }
  return grouped;
}

export async function getAdminOptions(pool) {
  const result = await pool.query(
    `select id, set_key, value, label, sort_order, is_active from fas_master_options order by set_key, sort_order, value`
  );
  return MANAGEABLE_SETS.map(set => ({
    key: set.key,
    label: set.label,
    valueLabel: set.valueLabel,
    valueEditable: set.valueEditable,
    options: result.rows
      .filter(row => row.set_key === set.key)
      .map(row => ({ id: row.id, value: row.value, label: row.label, sortOrder: row.sort_order, isActive: row.is_active }))
  }));
}

export async function createOption(pool, { setKey, value, label, sortOrder }) {
  if (!SET_META.has(setKey)) throw new MasterDataError('Unknown option set.');
  const cleanValue = validateValue(setKey, value);
  const cleanLabel = text(label, 120, 'Label');
  const order = Number.isFinite(Number(sortOrder)) ? Math.trunc(Number(sortOrder)) : 0;
  try {
    const result = await pool.query(
      `insert into fas_master_options (set_key, value, label, sort_order) values ($1,$2,$3,$4)
       returning id, set_key, value, label, sort_order, is_active`,
      [setKey, cleanValue, cleanLabel, order]
    );
    const row = result.rows[0];
    return { id: row.id, setKey: row.set_key, value: row.value, label: row.label, sortOrder: row.sort_order, isActive: row.is_active };
  } catch (error) {
    if (error.code === '23505') throw new MasterDataError('That value already exists in this list.', 409);
    throw error;
  }
}

export async function updateOption(pool, id, { label, sortOrder, isActive }) {
  const updates = [];
  const values = [];
  if (label !== undefined) { values.push(text(label, 120, 'Label')); updates.push(`label = $${values.length}`); }
  if (sortOrder !== undefined) {
    if (!Number.isFinite(Number(sortOrder))) throw new MasterDataError('Sort order must be a number.');
    values.push(Math.trunc(Number(sortOrder))); updates.push(`sort_order = $${values.length}`);
  }
  if (isActive !== undefined) {
    if (typeof isActive !== 'boolean') throw new MasterDataError('Active must be true or false.');
    values.push(isActive); updates.push(`is_active = $${values.length}`);
  }
  if (!updates.length) throw new MasterDataError('No supported changes provided.');
  values.push(id);
  const result = await pool.query(
    `update fas_master_options set ${updates.join(', ')} where id = $${values.length}
     returning id, set_key, value, label, sort_order, is_active`,
    values
  );
  if (!result.rowCount) throw new MasterDataError('Option not found.', 404);
  const row = result.rows[0];
  return { id: row.id, setKey: row.set_key, value: row.value, label: row.label, sortOrder: row.sort_order, isActive: row.is_active };
}
