export async function writeAudit(client, { administratorId, action, entityType, entityIdentifier, previousValues = null, newValues = null }) {
  await client.query(`insert into audit_log (
    administrator_id, action, entity_type, entity_identifier, previous_values, new_values
  ) values ($1,$2,$3,$4,$5,$6)`, [administratorId, action, entityType, String(entityIdentifier), previousValues, newValues]);
}
