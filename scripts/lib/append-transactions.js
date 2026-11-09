// Writes rows produced by the slip scripts into Postgres, in the same transaction as their Sheet
// outbox entries, as the app does (see src/lib/db/transactions.ts). Rows use the Sheet's columns:
// [date, time, type label, amount, category, account, note, slip link, id, Drive file id, source].
const LEDGER_LOCK_KEY = 736401;

function typeFromLabel(label) {
  if (String(label).includes('รายรับ')) return 'INCOME';
  if (String(label).includes('โอนย้าย')) return 'TRANSFER';
  return 'EXPENSE';
}

async function appendTransactions(pool, rows) {
  if (rows.length === 0) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [LEDGER_LOCK_KEY]);

    const state = await client.query('SELECT migrated_at FROM sheet_mirror_state WHERE id = 1');
    if (!state.rows[0] || !state.rows[0].migrated_at) {
      throw new Error('Run the Sheet import first: POST /api/cron/sheet-migrate (see README)');
    }

    for (const [date, time, typeLabel, amount, category, account, note, slipLink, id, driveFileId, source] of rows) {
      if (driveFileId) {
        const existing = await client.query('SELECT 1 FROM transactions WHERE drive_file_id = $1 LIMIT 1', [driveFileId]);
        if (existing.rows.length > 0) continue;
      }
      const inserted = await client.query(
        `INSERT INTO transactions (id, txn_date, txn_time, tx_type, amount, category, account, note, slip_url, drive_file_id, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (id) DO NOTHING RETURNING id`,
        [id, date, time, typeFromLabel(typeLabel), amount, category, account, note, slipLink || null, driveFileId || null, source],
      );
      if (inserted.rows.length > 0) {
        await client.query(`INSERT INTO sheet_outbox (entity, entity_id, op) VALUES ('transaction', $1, 'insert')`, [id]);
      }
    }
    await client.query('UPDATE sheet_mirror_state SET first_app_write_at = CURRENT_TIMESTAMP WHERE id = 1 AND first_app_write_at IS NULL');
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { appendTransactions };
