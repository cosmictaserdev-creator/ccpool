import {
  resolveAccount,
  resolveConfigDir,
  SCHEMA_VERSION,
  type Config,
  type StorageDriver,
} from "@ccshare/core";
import { newConfig, saveConfig } from "./config.js";
import { makeStorage } from "./storage.js";
import { validateUrl } from "./validate.js";

/**
 * Shared, non-interactive setup core used by the TUI onboarding wizard and the
 * storage-reconfigure screen. It mirrors the account-binding rules enforced by
 * the `init` flag command (see commands/init.ts and ALGORITHM.md §1.5) so both
 * entry points behave identically: an empty DB is initialized, an existing
 * ccshare DB is joined (migrated forward / claimed if unbound), and a foreign or
 * account-mismatched DB is refused.
 */

/** A connection inspection classified for the UI. Never writes. */
export type Classification =
  | { kind: "empty" }
  | { kind: "ccshare" } // joinable: compatible schema, same or unbound account
  | { kind: "ccshare-newer" } // schema newer than this build understands
  | { kind: "ccshare-foreign-account"; account: string | null } // bound elsewhere
  | { kind: "foreign" }
  | { kind: "error"; message: string };

export interface ConnInput {
  driver: StorageDriver;
  url: string;
  token?: string;
}

function probeConfig(input: ConnInput, configDir: string): Config {
  return newConfig({
    driver: input.driver,
    url: input.url,
    token: input.token,
    name: "probe",
    configDirs: [configDir],
  });
}

/**
 * Validate the URL, connect, and classify the target — the pre-write check the
 * wizard's "database" step and the reconfigure screen's "test connection" both
 * run before they let you proceed. Never writes.
 */
export async function inspectFor(input: ConnInput): Promise<Classification> {
  const urlErr = validateUrl(input.driver, input.url);
  if (urlErr) return { kind: "error", message: urlErr };

  const configDir = resolveConfigDir();
  const acct = await resolveAccount(configDir);
  const localAccountId = acct?.hydrated ? acct.id : null;

  const storage = makeStorage(probeConfig(input, configDir));
  try {
    const info = await storage.inspect();
    switch (info.kind) {
      case "empty":
        return { kind: "empty" };
      case "foreign":
        return { kind: "foreign" };
      case "ccshare":
        if (info.schemaVersion > SCHEMA_VERSION) return { kind: "ccshare-newer" };
        if (info.accountId != null && localAccountId != null && info.accountId !== localAccountId) {
          return { kind: "ccshare-foreign-account", account: acct?.email ?? null };
        }
        return { kind: "ccshare" };
    }
  } catch (err) {
    return { kind: "error", message: (err as Error).message };
  } finally {
    await storage.close();
  }
}

export type ApplyResult =
  | { ok: true; config: Config; note?: string }
  | { ok: false; error: string };

/**
 * Set up / join the target for `cfg`, then persist `cfg`. The caller builds the
 * config (a fresh `newConfig` for onboarding, or a spread of the existing one for
 * a storage change) so identity, poll interval, and log level are preserved.
 */
export async function applySetup(cfg: Config): Promise<ApplyResult> {
  const urlErr = validateUrl(cfg.storage.driver, cfg.storage.url);
  if (urlErr) return { ok: false, error: urlErr };

  const configDir = cfg.configDirs[0] ?? resolveConfigDir();
  // Bind the ledger to the Claude *account* (accountUuid), never the email or the
  // ccshare person. Only a hydrated (onboarded) account has a real accountUuid.
  const acct = await resolveAccount(configDir);
  const localAccountId = acct?.hydrated ? acct.id : null;
  let note: string | undefined;

  const storage = makeStorage(cfg);
  try {
    const info = await storage.inspect();
    switch (info.kind) {
      case "empty":
        await storage.initializeSchema(localAccountId);
        await storage.upsertUser(cfg.name);
        if (!localAccountId) {
          note =
            "No Claude account detected yet — the ledger is unbound and will bind " +
            "to the first onboarded account that joins.";
        }
        break;
      case "ccshare": {
        if (info.schemaVersion > SCHEMA_VERSION) {
          return {
            ok: false,
            error:
              "This database uses a newer ccshare schema than this build understands. " +
              "Update ccshare.",
          };
        }
        if (info.accountId != null && localAccountId != null && info.accountId !== localAccountId) {
          return {
            ok: false,
            error:
              "This ccshare database is bound to a different Claude account than " +
              `${acct?.email ?? "this machine"}. A shared ledger tracks a single account.`,
          };
        }
        if (info.schemaVersion < SCHEMA_VERSION) await storage.migrate(SCHEMA_VERSION);
        // Claim an unbound ledger for this account (no-op when already bound).
        if (info.accountId == null && localAccountId != null) {
          await storage.bindAccount(localAccountId);
        }
        await storage.upsertUser(cfg.name);
        break;
      }
      case "foreign":
        return {
          ok: false,
          error:
            "This database already contains another project. ccshare needs its own " +
            "clean, dedicated database.",
        };
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  } finally {
    await storage.close();
  }

  await saveConfig(cfg);
  return { ok: true, config: cfg, note };
}
