import { createClient, type Client } from "@libsql/client";
import { ensureFileDir, normalizeUrl } from "@ccshare/storage-libsql";
import { randomUUID } from "node:crypto";
import type { GroupRow, MemberRow, Registry } from "./deps.js";

/**
 * The libSQL implementation of the server-owned registry (groups / members /
 * tokens). Lives in the same database as the per-group ledgers (which carry a
 * `group_id` referencing `groups(id)`); the ledgers never know tenancy exists.
 */
export class LibsqlRegistry implements Registry {
  private client: Client;

  constructor(url: string, authToken?: string) {
    // Normalize `~` / bare-path `file:` URLs the same way the storage adapter does,
    // so a `DATABASE_URL=file:~/…` works for the registry too (libsql rejects `~`),
    // and make sure the parent directory exists before opening the file.
    const u = normalizeUrl(url);
    ensureFileDir(u);
    this.client = createClient(authToken ? { url: u, authToken } : { url: u });
  }

  /** Create/verify the registry tables. Idempotent; run once at startup. */
  async ensure(): Promise<void> {
    await this.client.batch(
      [
        `CREATE TABLE IF NOT EXISTS groups (
           id TEXT PRIMARY KEY,
           accountId TEXT UNIQUE NOT NULL,
           passwordHash TEXT NOT NULL,
           createdAt TEXT NOT NULL
         )`,
        `CREATE TABLE IF NOT EXISTS members (
           id TEXT PRIMARY KEY,
           groupId TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
           name TEXT NOT NULL,
           passwordHash TEXT NOT NULL,
           createdAt TEXT NOT NULL,
           UNIQUE (groupId, name)
         )`,
        `CREATE TABLE IF NOT EXISTS tokens (
           tokenHash TEXT PRIMARY KEY,
           memberId TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
           createdAt TEXT NOT NULL,
           lastUsedAt TEXT
         )`,
        `CREATE INDEX IF NOT EXISTS idx_tokens_member ON tokens (memberId)`,
      ],
      "write"
    );
  }

  async getGroupByAccount(accountId: string): Promise<GroupRow | null> {
    const { rows } = await this.client.execute({
      sql: `SELECT id, accountId, passwordHash, createdAt FROM groups WHERE accountId = ?`,
      args: [accountId],
    });
    return rows[0] ? toGroup(rows[0]) : null;
  }

  async createGroup(accountId: string, passwordHash: string): Promise<GroupRow> {
    const g: GroupRow = {
      id: randomUUID(),
      accountId,
      passwordHash,
      createdAt: new Date().toISOString(),
    };
    // The UNIQUE(accountId) constraint is the create-race arbiter (throws on a lost race).
    await this.client.execute({
      sql: `INSERT INTO groups (id, accountId, passwordHash, createdAt) VALUES (?, ?, ?, ?)`,
      args: [g.id, g.accountId, g.passwordHash, g.createdAt],
    });
    return g;
  }

  async deleteGroup(id: string): Promise<void> {
    await this.client.execute({ sql: `DELETE FROM groups WHERE id = ?`, args: [id] });
  }

  async getMember(groupId: string, name: string): Promise<MemberRow | null> {
    const { rows } = await this.client.execute({
      sql: `SELECT id, groupId, name, passwordHash, createdAt
            FROM members WHERE groupId = ? AND name = ?`,
      args: [groupId, name],
    });
    return rows[0] ? toMember(rows[0]) : null;
  }

  async createMember(groupId: string, name: string, passwordHash: string): Promise<MemberRow> {
    const m: MemberRow = {
      id: randomUUID(),
      groupId,
      name,
      passwordHash,
      createdAt: new Date().toISOString(),
    };
    await this.client.execute({
      sql: `INSERT INTO members (id, groupId, name, passwordHash, createdAt) VALUES (?, ?, ?, ?, ?)`,
      args: [m.id, m.groupId, m.name, m.passwordHash, m.createdAt],
    });
    return m;
  }

  async resolveToken(tokenHash: string): Promise<{ member: MemberRow; group: GroupRow } | null> {
    const { rows } = await this.client.execute({
      sql: `SELECT m.id AS memberId, m.groupId AS memberGroupId, m.name AS name,
                   m.passwordHash AS memberHash, m.createdAt AS memberCreatedAt,
                   g.id AS gid, g.accountId AS accountId, g.passwordHash AS groupHash,
                   g.createdAt AS groupCreatedAt
            FROM tokens t
            JOIN members m ON m.id = t.memberId
            JOIN groups g ON g.id = m.groupId
            WHERE t.tokenHash = ?`,
      args: [tokenHash],
    });
    const r = rows[0];
    if (!r) return null;
    return {
      member: {
        id: String(r.memberId),
        groupId: String(r.memberGroupId),
        name: String(r.name),
        passwordHash: String(r.memberHash),
        createdAt: String(r.memberCreatedAt),
      },
      group: {
        id: String(r.gid),
        accountId: String(r.accountId),
        passwordHash: String(r.groupHash),
        createdAt: String(r.groupCreatedAt),
      },
    };
  }

  async insertToken(tokenHash: string, memberId: string): Promise<void> {
    await this.client.execute({
      sql: `INSERT INTO tokens (tokenHash, memberId, createdAt) VALUES (?, ?, ?)`,
      args: [tokenHash, memberId, new Date().toISOString()],
    });
  }

  async touchToken(tokenHash: string): Promise<void> {
    await this.client.execute({
      sql: `UPDATE tokens SET lastUsedAt = ? WHERE tokenHash = ?`,
      args: [new Date().toISOString(), tokenHash],
    });
  }

  async close(): Promise<void> {
    this.client.close();
  }
}

function toGroup(r: Record<string, unknown>): GroupRow {
  return {
    id: String(r.id),
    accountId: String(r.accountId),
    passwordHash: String(r.passwordHash),
    createdAt: String(r.createdAt),
  };
}

function toMember(r: Record<string, unknown>): MemberRow {
  return {
    id: String(r.id),
    groupId: String(r.groupId),
    name: String(r.name),
    passwordHash: String(r.passwordHash),
    createdAt: String(r.createdAt),
  };
}
