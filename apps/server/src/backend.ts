import { LibsqlStorage } from "@ccshare/storage-libsql";
import { PostgresStorage } from "@ccshare/storage-postgres";
import type { ServerDeps } from "./deps.js";
import { PgRegistry } from "./registry-pg.js";
import { LibsqlRegistry } from "./registry-libsql.js";
import { StorageTenantProvider } from "./tenants.js";

/** The databases the server can run on. Both use the same relational group_id model. */
export type ServerDriver = "postgres" | "libsql";

/** Pool sizing for a group's Postgres connection (many tenants, one small pool each). */
const TENANT_POOL_MAX = 2;
const TENANT_IDLE_SECS = 60;

export interface ServerBackendConfig {
  driver: ServerDriver;
  /** postgres://… (postgres) or file:/libsql://… (libsql). */
  url: string;
  /** libsql only: auth token for a remote Turso database. */
  authToken?: string;
}

/**
 * Pick the driver + connection from the environment. `CCSHARE_DB_DRIVER` forces
 * it; otherwise a `postgres://` / `postgresql://` `DATABASE_URL` is Postgres and
 * anything else (a `file:` path, `libsql://…`) is libSQL.
 */
export function resolveServerBackend(env = process.env): ServerBackendConfig {
  const url = env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "DATABASE_URL is required — postgres://… for Postgres, or file:/…/libsql://… for libSQL"
    );
  }
  const forced = env.CCSHARE_DB_DRIVER?.trim().toLowerCase();
  const driver: ServerDriver =
    forced === "postgres" || forced === "libsql"
      ? forced
      : url.startsWith("postgres://") || url.startsWith("postgresql://")
        ? "postgres"
        : "libsql";
  return { driver, url, authToken: env.CCSHARE_DB_AUTH_TOKEN?.trim() || undefined };
}

/**
 * Compose the server's two dependencies for a driver. The registry and the
 * per-group ledgers share ONE physical database; the tenant provider only differs
 * per driver in how a group id becomes a group-scoped `Storage`.
 */
export function makeServerDeps(cfg: ServerBackendConfig): ServerDeps {
  if (cfg.driver === "postgres") {
    return {
      registry: new PgRegistry(cfg.url),
      tenants: new StorageTenantProvider(
        (groupId) =>
          new PostgresStorage(cfg.url, {
            groupId,
            max: TENANT_POOL_MAX,
            idleTimeoutSecs: TENANT_IDLE_SECS,
          })
      ),
    };
  }
  return {
    registry: new LibsqlRegistry(cfg.url, cfg.authToken),
    tenants: new StorageTenantProvider(
      (groupId) => new LibsqlStorage(cfg.url, { groupId, authToken: cfg.authToken })
    ),
  };
}
