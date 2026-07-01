import React from "react";
import { Box, Text } from "ink";
import type { StorageDriver } from "@ccshare/core";
import { Cell } from "./designs/parts.js";
import { P } from "./designs/palette.js";

/**
 * Extra primitives + constants used only by the interactive screens (onboarding,
 * config, storage). Kept apart from designs/parts.tsx, which is shared with the
 * read-only status designs.
 */

/** Drivers offered in pickers. "memory" is intentionally omitted (tests only). */
export const DRIVERS: StorageDriver[] = ["libsql", "postgres", "sqlite"];
export const LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LEVELS)[number];
/** Poll cadence choices, in seconds. */
export const POLL_OPTIONS = [60, 120, 300];

export const DRIVER_DESC: Record<StorageDriver, string> = {
  libsql: "local file or turso",
  postgres: "postgres server",
  sqlite: "local file",
  memory: "in-memory (tests)",
};

export const driverUrl = (d: StorageDriver): string =>
  d === "postgres" ? "postgres://user:pass@host/db" : "file:~/.ccshare/ccshare.db";

/** True when a remote libsql URL needs an auth token. */
export const needsToken = (driver: StorageDriver, url: string): boolean =>
  driver === "libsql" && url.trim().startsWith("libsql://");

/** Step by `dir` through `arr`, wrapping. */
export const cycle = <T,>(arr: T[], cur: T, dir: 1 | -1): T => {
  const i = arr.indexOf(cur);
  return arr[(i + dir + arr.length) % arr.length]!;
};

/** A left-labelled settings row; the label lights up when focused. */
export function FieldRow({
  label,
  focused,
  editing,
  children,
}: {
  label: string;
  focused: boolean;
  editing?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <Box>
      <Cell w={18}>
        <Text color={focused ? P.orange : P.dim} bold={focused}>
          {focused ? "▸ " : "  "}
          {label}
        </Text>
      </Cell>
      <Text color={editing || focused ? P.cream : P.dim}>{children}</Text>
      {editing ? <Text color={P.orange}>▏</Text> : null}
    </Box>
  );
}
