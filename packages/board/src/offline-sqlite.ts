import type { BoardCheckpoint, LocalBoardStorage } from "./offline";

/**
 * Minimal structural subset of Expo SDK 58's SQLiteDatabase and native
 * Transaction. This package does not import expo-sqlite at runtime.
 * Host apps can inject their EXISTING Expo SQLite database connection.
 */
export type BoardSqliteBind = string | number | null | Uint8Array;
export interface BoardSqliteTransaction {
  runAsync(sql: string, ...parameters: BoardSqliteBind[]): Promise<unknown>;
}
export interface BoardSqliteDatabase {
  execAsync(sql: string): Promise<void>;
  getFirstAsync<T>(sql: string, ...parameters: BoardSqliteBind[]): Promise<T | null>;
  withExclusiveTransactionAsync(task: (transaction: BoardSqliteTransaction) => Promise<void>): Promise<void>;
}

interface CheckpointRow {
  schema_version: number;
  document_id: string;
  revision: number;
  synced_revision: number;
  data: Uint8Array;
}

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS nitroforge_board_checkpoints (
    document_id TEXT PRIMARY KEY NOT NULL,
    schema_version INTEGER NOT NULL,
    revision INTEGER NOT NULL,
    synced_revision INTEGER NOT NULL,
    data BLOB NOT NULL
  )
`;

const LOAD = `
  SELECT schema_version, document_id, revision, synced_revision, data
  FROM nitroforge_board_checkpoints WHERE document_id = ?
`;

const UPSERT = `
  INSERT INTO nitroforge_board_checkpoints
    (document_id, schema_version, revision, synced_revision, data)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(document_id) DO UPDATE SET
    schema_version = excluded.schema_version,
    revision = excluded.revision,
    synced_revision = excluded.synced_revision,
    data = excluded.data
`;

/**
 * Use after the host creates its persistent SQLiteDatabase. Transaction
 * callbacks MUST execute on the supplied txn, never the parent connection.
 * withExclusiveTransactionAsync is native-only (iOS/Android/macOS/tvOS),
 * not Expo SQLite's browser interface.
 *
 * The caller owns the database lifecycle, encryption, backups, and SQL schema
 * upgrades; do not close the shared database from this adapter.
 */
export async function createExpoSQLiteLocalBoardStorage(
  database: BoardSqliteDatabase,
): Promise<LocalBoardStorage> {
  await database.execAsync(CREATE_TABLE);
  return {
    async load(documentId) {
      const row = await database.getFirstAsync<CheckpointRow>(LOAD, documentId);
      if (row === null) return null;
      if (!(row.data instanceof Uint8Array)) {
        throw new TypeError("Local SQLite board BLOB is not Uint8Array");
      }
      return {
        schemaVersion: row.schema_version as 1,
        documentId: row.document_id,
        revision: row.revision,
        syncedRevision: row.synced_revision,
        data: new Uint8Array(row.data),
      };
    },
    async replaceAtomically(documentId, checkpoint: BoardCheckpoint) {
      if (checkpoint.documentId !== documentId || !(checkpoint.data instanceof Uint8Array)) {
        throw new TypeError("Cannot persist a checkpoint under the wrong document ID");
      }
      await database.withExclusiveTransactionAsync(async (transaction) => {
        await transaction.runAsync(
          UPSERT, documentId, checkpoint.schemaVersion, checkpoint.revision,
          checkpoint.syncedRevision, new Uint8Array(checkpoint.data),
        );
      });
    },
  };
}
