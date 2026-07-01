import type {
  CapKind,
  DbInspection,
  MessageUsage,
  ResetEvent,
  UsageMarker,
  User,
  UsageSample,
} from "../types.js";

/**
 * The schema version this CLI understands. v1 is the single baseline: the whole
 * schema — `ccshare_meta` (with the account-binding `accountId`), `users`,
 * `usage_samples`, `message_usage`, `usage_markers`, `reset_events` — is created
 * up front by `initializeSchema`, so there are no historical migration steps.
 *
 * When a future change needs one, bump this and add an additive, idempotent step
 * to each adapter's `migrate` (nullable columns / `CREATE … IF NOT EXISTS`), per
 * the migration rules in CLAUDE.md. `migrate` is retained for exactly that.
 */
export const SCHEMA_VERSION = 1;

/**
 * The one boundary that must stay strict: adapters are interchangeable behind
 * this interface. Async even where local SQLite is synchronous, so a remote
 * adapter fits unchanged.
 */
export interface Storage {
  // lifecycle / setup
  inspect(): Promise<DbInspection>; // empty | ccshare | foreign
  /** Create tables + write ccshare_meta, binding the ledger to `accountId` (§1.5). */
  initializeSchema(accountId?: string | null): Promise<void>;
  /** Claim an unbound ledger for `accountId` (only sets it when currently null). */
  bindAccount(accountId: string): Promise<void>;
  migrate(toVersion: number): Promise<void>;
  close(): Promise<void>;

  // participants — identity is just a name (alphanumeric + hyphens)
  upsertUser(name: string): Promise<void>;
  getUsers(): Promise<User[]>;

  // shared tank (account-scoped truth)
  recordUsageSample(s: UsageSample): Promise<void>;
  getLatestSamples(): Promise<UsageSample[]>;
  /** The tank trajectory since `since` (all caps, ascending) — drives attribution. */
  getUsageSamplesSince(since: string): Promise<UsageSample[]>;
  recordReset(e: ResetEvent): Promise<void>;
  /** Recorded resets since `since` (all caps) — bound the attribution window. */
  getResetsSince(since: string): Promise<ResetEvent[]>;

  // per-person attribution (Code surface; batch + idempotent on uuid)
  recordMessageUsage(rows: MessageUsage[]): Promise<void>;
  /** Raw measured Code activity since `since`, for time-correlated attribution. */
  getMessageUsageSince(since: string): Promise<MessageUsage[]>;

  // daemon activity markers (fallback attribution; idempotent on id)
  recordUsageMarker(m: UsageMarker): Promise<void>;
  /** Activity markers since `since` — fill rises with no measured activity (§7). */
  getUsageMarkersSince(since: string): Promise<UsageMarker[]>;
}
