import { type Config, type ViewSource } from "@ccshare/core";
import { loadConfig } from "./config.js";
import { makeViewSource } from "./backend.js";

/**
 * Most commands require a completed `init`. Returns the config + an open
 * ViewSource, or null after printing guidance. Caller owns closing the source.
 *
 * Gates on config + token presence; server reachability problems surface through
 * the view's existing `stale` path instead of blocking startup.
 */
export async function requireInit(): Promise<{ cfg: Config; viewSource: ViewSource } | null> {
  const cfg = await loadConfig();
  if (!cfg) {
    console.error("Not initialized. Run `ccshare init` first.");
    process.exitCode = 1;
    return null;
  }
  if (!cfg.server?.url || !cfg.server.token) {
    console.error("ccshare setup is incomplete. Run `ccshare init` again.");
    process.exitCode = 1;
    return null;
  }
  return { cfg, viewSource: makeViewSource(cfg) };
}
