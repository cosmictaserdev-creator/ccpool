import { copyFile } from "node:fs/promises";
import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  target: "node20",
  platform: "node",
  outDir: "dist",
  clean: true,
  // Bundle the internal workspace packages (they are devDependencies) into the
  // single published `ccpool-server` package; keep real runtime deps external
  // (hono, @hono/node-server, @libsql/client) so npm installs them normally.
  noExternal: [/^@ccpool\//],
  // The entry file already carries `#!/usr/bin/env node`; tsup preserves it so
  // the published `ccpool-server` bin runs directly.
  // Pull the canonical LICENSE from the repo root into the package root at
  // build time so it ships in the tarball without committing a duplicate here
  // (it's gitignored). The README is committed alongside this package.
  async onSuccess() {
    await copyFile("../../LICENSE", "LICENSE");
  },
});
