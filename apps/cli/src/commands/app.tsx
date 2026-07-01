import React from "react";
import { render } from "ink";
import { loadConfig } from "../lib/config.js";
import { Root } from "../tui/Root.js";

/**
 * The default entry (bare `ccshare`): open the TUI. Loads config to decide the
 * first screen — onboarding when unconfigured, the live view otherwise — and
 * lets Root own storage for the session.
 */
export async function runApp(): Promise<void> {
  const cfg = await loadConfig();
  process.stdout.write("\x1B[2J\x1B[H");
  const app = render(<Root initialConfig={cfg} />);
  await app.waitUntilExit();
}
