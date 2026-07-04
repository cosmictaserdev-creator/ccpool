import { StorageIngestSink, StorageViewSource, type Storage } from "@ccshare/core";
import type { GroupRow, Tenant, TenantProvider } from "./deps.js";

/**
 * Driver-agnostic tenancy. Every group's ledger is a group-scoped `Storage` over
 * one shared physical database (Postgres or libSQL); the only per-driver piece is
 * how a group id becomes a `Storage`, injected as `openStorage`. The composed
 * sink/view-source are the same core pieces used everywhere — the server adds
 * nothing but routing and auth on top.
 *
 * Live tenants are LRU-capped: each holds a small connection pool, and the
 * `group_id` scoping means one shared database backs them all.
 */
const MAX_LIVE_TENANTS = 200;
/** Grace before an evicted tenant's connection is closed, so in-flight requests finish. */
const TENANT_DRAIN_MS = 30_000;

interface TenantEntry {
  tenant: Tenant;
  storage: Storage;
  /** Runs `sink.bootstrap()` (schema heal/migrate) exactly once per open. */
  ready?: Promise<void>;
}

export class StorageTenantProvider implements TenantProvider {
  private tenants = new Map<string, TenantEntry>();

  /** `openStorage(groupId)` builds a group-scoped Storage over the shared DB. */
  constructor(private readonly openStorage: (groupId: string) => Storage) {}

  async provision(group: GroupRow): Promise<void> {
    const entry = this.open(group);
    // Bind the fresh ledger to the group's account (idempotent re-provision: only
    // a group with no ledger yet is initialized).
    if ((await entry.storage.inspect()).kind === "empty") {
      await entry.storage.initializeSchema(group.accountId);
    }
    await this.ready(entry); // heal the schema + prime the binding for ingest re-checks
  }

  async get(group: GroupRow): Promise<Tenant> {
    const entry = this.open(group);
    // Guarantee the schema is migrated to the current version before the tenant
    // serves any ingest/view. Healing on open makes it the server's guarantee, not
    // the daemon's best-effort bootstrap.
    await this.ready(entry);
    return entry.tenant;
  }

  /** Bootstrap (migrate) a tenant's ledger once per open; don't cache a failure. */
  private ready(entry: TenantEntry): Promise<void> {
    if (!entry.ready) {
      entry.ready = entry.tenant.sink.bootstrap().then(
        () => undefined,
        (err) => {
          entry.ready = undefined; // let the next request retry a transient failure
          throw err;
        }
      );
    }
    return entry.ready;
  }

  /** Cached tenant (LRU refresh on access), creating the group-scoped Storage lazily. */
  private open(group: GroupRow): TenantEntry {
    const hit = this.tenants.get(group.id);
    if (hit) {
      // refresh LRU position
      this.tenants.delete(group.id);
      this.tenants.set(group.id, hit);
      return hit;
    }
    const storage = this.openStorage(group.id);
    const view = new StorageViewSource(storage);
    const entry: TenantEntry = {
      tenant: {
        sink: new StorageIngestSink(storage),
        view,
        upsertUser: (name: string) => storage.upsertUser(name),
      },
      storage,
    };
    this.tenants.set(group.id, entry);
    if (this.tenants.size > MAX_LIVE_TENANTS) {
      const [oldestId, oldest] = this.tenants.entries().next().value!;
      this.tenants.delete(oldestId);
      // Don't close the connection out from under a request that grabbed this
      // tenant just before eviction — drain after a grace window.
      const timer = setTimeout(() => void oldest.storage.close().catch(() => {}), TENANT_DRAIN_MS);
      timer.unref?.();
    }
    return entry;
  }

  async close(): Promise<void> {
    await Promise.all([...this.tenants.values()].map((t) => t.storage.close().catch(() => {})));
    this.tenants.clear();
  }
}
