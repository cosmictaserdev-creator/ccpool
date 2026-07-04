import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiRequestError, type Config, type SharedView, type ViewSource } from "@ccshare/core";
import { gatherView } from "../src/lib/view.js";

/** A ViewSource whose fetch always rejects with the given error. */
function failingSource(err: unknown): ViewSource {
  return {
    fetchView: () => Promise.reject(err),
    close: () => Promise.resolve(),
  };
}

let dir: string;
let cfg: Config;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ccshare-view-"));
  process.env.CCSHARE_DIR = join(dir, ".ccshare");
  cfg = {
    server: { url: "https://api.example.test", token: "tok" },
    name: "sam",
    pollIntervalMs: 60_000,
    configDirs: [join(dir, "cfg")], // empty → no state.json, no creds
    logLevel: "info",
  };
});

afterEach(() => {
  delete process.env.CCSHARE_DIR;
});

describe("gatherView error classification", () => {
  it("treats a 401 (unknown/revoked token) as logged out, not unreachable", async () => {
    const vm = await gatherView(
      cfg,
      failingSource(new ApiRequestError(401, "auth", "unknown token"))
    );
    expect(vm.loggedOut).toBe(true);
    expect(vm.stale).toBe(false);
    // No shared data and no fabrication.
    expect(vm.members).toEqual([]);
    expect(vm.shares).toEqual([]);
  });

  it("treats a non-auth failure as unreachable (stale), not logged out", async () => {
    const vm = await gatherView(cfg, failingSource(new Error("fetch failed")));
    expect(vm.stale).toBe(true);
    expect(vm.loggedOut).toBe(false);
  });

  it("treats a 500 as unreachable, not logged out", async () => {
    const vm = await gatherView(cfg, failingSource(new ApiRequestError(500, "invalid", "boom")));
    expect(vm.stale).toBe(true);
    expect(vm.loggedOut).toBe(false);
  });
});
