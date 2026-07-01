import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render } from "ink-testing-library";
import type { Config } from "@ccshare/core";
import { InitScreen } from "../src/tui/screens/Init.js";
import { ConfigScreen } from "../src/tui/screens/Config.js";

let ccshareDir: string;
let cfg: Config;

beforeEach(() => {
  ccshareDir = mkdtempSync(join(tmpdir(), "ccshare-screens-"));
  process.env.CCSHARE_DIR = ccshareDir;
  cfg = {
    storage: { driver: "memory", url: "" },
    name: "sam",
    pollIntervalMs: 60_000,
    configDirs: [join(ccshareDir, "config")],
    logLevel: "info",
  };
});

afterEach(() => {
  delete process.env.CCSHARE_DIR;
});

describe("onboarding screen", () => {
  it("opens on the first question with empty fields", () => {
    const { lastFrame, unmount } = render(<InitScreen onDone={() => {}} onQuit={() => {}} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("ccshare setup");
    expect(frame).toContain("not configured on this machine yet.");
    expect(frame).toContain("1. what should we call you?");
    unmount();
  });
});

describe("config screen", () => {
  it("renders the general tab with the current identity and storage", () => {
    const { lastFrame, unmount } = render(
      <ConfigScreen config={cfg} onChange={() => {}} onBack={() => {}} />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("configure");
    expect(frame).toContain("general");
    expect(frame).toContain("daemon");
    expect(frame).toContain("your name");
    expect(frame).toContain("sam");
    expect(frame).toContain("log level");
    unmount();
  });
});
