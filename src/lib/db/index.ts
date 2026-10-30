import { Pool, type QueryResult, type QueryResultRow } from 'pg';
// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
import { initMortgageSchema } from './mortgage.ts';

let poolInstance: Pool | null = null;

export function getPool(): Pool {
  if (!poolInstance) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('[DB] DATABASE_URL environment variable is required');
    }

    poolInstance = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    poolInstance.on('error', (err) => {
      console.error('[DB] Unexpected error on idle database client', err);
    });
  }

  return poolInstance;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  const pool = getPool();
  return pool.query<T>(text, params);
}

export async function initSchema(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(255) PRIMARY KEY,
      username VARCHAR(255) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS processed_slips (
      drive_file_id VARCHAR(255) PRIMARY KEY,
      account VARCHAR(100) NOT NULL,
      amount NUMERIC(15, 2),
      transaction_date VARCHAR(50),
      md5_checksum VARCHAR(100),
      status VARCHAR(50) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    ALTER TABLE processed_slips ADD COLUMN IF NOT EXISTS md5_checksum VARCHAR(100);

    CREATE INDEX IF NOT EXISTS idx_processed_slips_status ON processed_slips(status);
    CREATE INDEX IF NOT EXISTS idx_processed_slips_dedup ON processed_slips(amount, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_processed_slips_md5 ON processed_slips(md5_checksum);

    CREATE TABLE IF NOT EXISTS processed_statements (
      file_id VARCHAR(255) PRIMARY KEY,
      file_name TEXT NOT NULL,
      modified_time VARCHAR(100) NOT NULL,
      md5_checksum VARCHAR(100),
      transactions_count INTEGER DEFAULT 0,
      processed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await initMortgageSchema();
}

export async function isSlipProcessed(driveFileId: string): Promise<boolean> {
  const res = await query(
    'SELECT drive_file_id FROM processed_slips WHERE drive_file_id = $1 LIMIT 1',
    [driveFileId]
  );
  return res.rows.length > 0;
}

/**
 * Returns a Set of drive_file_ids that are already recorded in the database
 */
export async function getProcessedSlipIds(driveFileIds: string[]): Promise<Set<string>> {
  if (!driveFileIds || driveFileIds.length === 0) return new Set();
  
  const res = await query(
    'SELECT drive_file_id FROM processed_slips WHERE drive_file_id = ANY($1)',
    [driveFileIds]
  );
  return new Set(res.rows.map((r) => r.drive_file_id));
}

/**
 * Returns a Set of md5_checksums that have already been processed successfully
 */
export async function getProcessedSlipMd5s(md5Checksums: string[]): Promise<Set<string>> {
  const cleanMd5s = (md5Checksums || []).filter(Boolean);
  if (cleanMd5s.length === 0) return new Set();

  const res = await query(
    "SELECT md5_checksum FROM processed_slips WHERE md5_checksum = ANY($1) AND status = 'SUCCESS'",
    [cleanMd5s]
  );
  return new Set(res.rows.map((r) => r.md5_checksum));
}

export async function markSlipsProcessedBatch(driveFileIds: string[]): Promise<void> {
  const cleanIds = (driveFileIds || []).map((id) => id?.trim()).filter(Boolean);
  if (cleanIds.length === 0) return;

  const BATCH_SIZE = 500;
  for (let i = 0; i < cleanIds.length; i += BATCH_SIZE) {
    const batch = cleanIds.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map((_, idx) => `($${idx + 1}, 'SHEET_SYNC', 'SUCCESS')`).join(', ');

    await query(
      `INSERT INTO processed_slips (drive_file_id, account, status)
       VALUES ${placeholders}
       ON CONFLICT (drive_file_id) DO NOTHING`,
      batch
    );
  }
}

export async function markSlipProcessed(data: {
  driveFileId: string;
  account: string;
  amount?: number;
  transactionDate?: string;
  md5Checksum?: string;
  status: 'SUCCESS' | 'FAILED' | 'IGNORED_ZERO' | 'DUPLICATE_IGNORED';
}): Promise<void> {
  await query(
    `INSERT INTO processed_slips (drive_file_id, account, amount, transaction_date, md5_checksum, status)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (drive_file_id) DO UPDATE SET
       account = EXCLUDED.account,
       amount = EXCLUDED.amount,
       transaction_date = EXCLUDED.transaction_date,
       md5_checksum = COALESCE(EXCLUDED.md5_checksum, processed_slips.md5_checksum),
       status = EXCLUDED.status`,
    [
      data.driveFileId,
      data.account,
      data.amount ?? null,
      data.transactionDate ?? null,
      data.md5Checksum ?? null,
      data.status,
    ]
  );
}

export async function checkRecentTransferDuplicate(
  amount: number,
  windowMinutes: number = 3
): Promise<boolean> {
  const res = await query(
    `SELECT drive_file_id FROM processed_slips 
     WHERE amount = $1 
       AND status = 'TRANSFER_SUCCESS' 
       AND created_at >= NOW() - ($2 || ' minutes')::INTERVAL
     LIMIT 1`,
    [amount, windowMinutes]
  );
  return res.rows.length > 0;
}

export async function recordTransferSlip(
  txId: string,
  account: string,
  amount: number,
  dateStr: string
): Promise<void> {
  await query(
    `INSERT INTO processed_slips (drive_file_id, account, amount, transaction_date, status)
     VALUES ($1, $2, $3, $4, 'TRANSFER_SUCCESS')
     ON CONFLICT (drive_file_id) DO NOTHING`,
    [txId, account, amount, dateStr]
  );
}

export async function isStatementProcessed(
  fileId: string,
  modifiedTime?: string
): Promise<boolean> {
  if (!modifiedTime) {
    const res = await query(
      'SELECT file_id FROM processed_statements WHERE file_id = $1 LIMIT 1',
      [fileId]
    );
    return res.rows.length > 0;
  }
  const res = await query(
    'SELECT file_id FROM processed_statements WHERE file_id = $1 AND modified_time = $2 LIMIT 1',
    [fileId, modifiedTime]
  );
  return res.rows.length > 0;
}

/**
 * Returns a Set of file_ids that are already recorded in processed_statements
 */
export async function getProcessedStatementIds(fileIds: string[]): Promise<Set<string>> {
  if (!fileIds || fileIds.length === 0) return new Set();

  const res = await query(
    'SELECT file_id FROM processed_statements WHERE file_id = ANY($1)',
    [fileIds]
  );
  return new Set(res.rows.map((r) => r.file_id));
}

export async function markStatementProcessed(data: {
  fileId: string;
  fileName: string;
  modifiedTime: string;
  md5Checksum?: string;
  transactionsCount?: number;
}): Promise<void> {
  await query(
    `INSERT INTO processed_statements (file_id, file_name, modified_time, md5_checksum, transactions_count)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (file_id) DO UPDATE SET
       file_name = EXCLUDED.file_name,
       modified_time = EXCLUDED.modified_time,
       md5_checksum = EXCLUDED.md5_checksum,
       transactions_count = EXCLUDED.transactions_count,
       processed_at = CURRENT_TIMESTAMP`,
    [
      data.fileId,
      data.fileName,
      data.modifiedTime,
      data.md5Checksum ?? null,
      data.transactionsCount ?? 0,
    ]
  );
}

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  created_at: string;
}

export async function getUserByUsername(username: string): Promise<UserRow | undefined> {
  const res = await query<UserRow>(
    'SELECT id, username, password_hash, created_at FROM users WHERE username = $1 LIMIT 1',
    [username]
  );
  if (res.rows.length === 0) return undefined;
  return res.rows[0];
}

export async function createUser(
  id: string,
  username: string,
  passwordHash: string
): Promise<void> {
  await query(
    'INSERT INTO users (id, username, password_hash) VALUES ($1, $2, $3)',
    [id, username, passwordHash]
  );
}

// @ts-expect-error - node test runner requires .ts extension for ESM strip-types
export * from './mortgage.ts';

