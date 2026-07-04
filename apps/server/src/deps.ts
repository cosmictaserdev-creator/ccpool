import type { IngestSink, StorageViewSource } from "@ccshare/core";

/**
 * The server's two injectable dependencies. Routes in app.ts are written against
 * these interfaces so the whole HTTP surface is testable with in-memory
 * implementations (src/memory.ts); production wires the Postgres pair
 * (registry-pg.ts + tenants-pg.ts).
 */

export interface GroupRow {
  id: string;
  /** The Claude accountUuid this group is bound to (unique per server). */
  accountId: string;
  /** scrypt hash of the shared group password. */
  passwordHash: string;
  createdAt: string;
}

export interface MemberRow {
  id: string;
  groupId: string;
  name: string;
  /** scrypt hash of this member's own password. */
  passwordHash: string;
  createdAt: string;
}

/**
 * Groups, members, and tokens — the server-owned tables OUTSIDE `Storage`. They
 * live in the same physical database as the ledgers; the ledger tables carry a
 * `group_id` that references `groups(id)`.
 */
export interface Registry {
  /** Create/verify the registry tables. Idempotent; run once at startup. */
  ensure(): Promise<void>;
  getGroupByAccount(accountId: string): Promise<GroupRow | null>;
  /** Insert a group row (unique accountId is the concurrency gate). */
  createGroup(accountId: string, passwordHash: string): Promise<GroupRow>;
  /** Compensation for a failed ledger provision — best effort. */
  deleteGroup(id: string): Promise<void>;
  getMember(groupId: string, name: string): Promise<MemberRow | null>;
  createMember(groupId: string, name: string, passwordHash: string): Promise<MemberRow>;
  /** One indexed lookup: token hash -> member + group, or null. */
  resolveToken(tokenHash: string): Promise<{ member: MemberRow; group: GroupRow } | null>;
  insertToken(tokenHash: string, memberId: string): Promise<void>;
  /** Update lastUsedAt (callers throttle; this is just the write). */
  touchToken(tokenHash: string): Promise<void>;
  close(): Promise<void>;
}

/** One group's composed backend: a group-scoped Storage behind the core boundary. */
export interface Tenant {
  sink: IngestSink;
  /** StorageViewSource concretely — its cache key doubles as the ETag. */
  view: StorageViewSource;
  upsertUser(name: string): Promise<void>;
}

export interface TenantProvider {
  /** Create the group's ledger rows (its `group_id` meta), bound to its account. */
  provision(group: GroupRow): Promise<void>;
  /** The (cached) live tenant for a provisioned group. */
  get(group: GroupRow): Promise<Tenant>;
  close(): Promise<void>;
}

export interface ServerDeps {
  registry: Registry;
  tenants: TenantProvider;
}
