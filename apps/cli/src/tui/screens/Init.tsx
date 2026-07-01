import React, { useEffect, useState } from "react";
import { Box, Text, useInput, useStdin } from "ink";
import { isValidName, resolveConfigDir, type Config, type StorageDriver } from "@ccshare/core";
import { newConfig } from "../../lib/config.js";
import { applySetup, inspectFor, type Classification } from "../../lib/setup.js";
import { spawnDaemon } from "../../commands/daemon.js";
import { Clawd, Cell } from "../designs/parts.js";
import { P } from "../designs/palette.js";
import { useTermSize } from "../use-term-size.js";
import { DRIVERS, DRIVER_DESC, driverUrl, needsToken } from "../parts-extra.js";

/**
 * Guided, one-question-at-a-time onboarding. Fields start empty and reveal step
 * by step; answered steps stack as a checklist above the active question. The DB
 * step actually connects and inspects (empty → initialize, ccshare → join,
 * foreign / mismatch → refuse), and the final "continue" commits: it writes the
 * schema / joins, saves config, and starts the daemon — then hands the saved
 * config up so the app opens on the live view.
 */

type StepKey = "name" | "driver" | "url" | "token" | "inspect" | "daemon" | "done";
const ORDER: StepKey[] = ["name", "driver", "url", "token", "inspect", "daemon", "done"];
const STEP_LABEL: Record<StepKey, string> = {
  name: "name",
  driver: "storage",
  url: "url",
  token: "token",
  inspect: "database",
  daemon: "daemon",
  done: "done",
};

interface Answers {
  name?: string;
  driver?: StorageDriver;
  url?: string;
  token?: string;
  dbAction?: "initialize" | "join";
  daemonRunning?: boolean;
}

const stepVisible = (k: StepKey, a: Answers): boolean =>
  k === "token" ? needsToken(a.driver ?? "libsql", a.url ?? "") : true;

export function InitScreen({
  onDone,
  onQuit,
}: {
  onDone: (cfg: Config) => void;
  onQuit: () => void;
}): React.ReactElement {
  const { isRawModeSupported } = useStdin();
  const { cols, rows } = useTermSize();

  const [answers, setAnswers] = useState<Answers>({});
  const [step, setStep] = useState<StepKey>("name");
  const [buf, setBuf] = useState("");
  const [sel, setSel] = useState(0);
  const [yes, setYes] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [inspect, setInspect] = useState<Classification | "checking">("checking");
  const [commit, setCommit] = useState<"idle" | "saving" | "error">("idle");
  const [commitErr, setCommitErr] = useState<string | null>(null);

  const visible = ORDER.filter((k) => stepVisible(k, answers));
  const stepNo = visible.indexOf(step) + 1;

  const enter = (key: StepKey, a: Answers): void => {
    setStep(key);
    setErr(null);
    setBuf(
      key === "url"
        ? (a.url ?? "")
        : key === "token"
          ? (a.token ?? "")
          : key === "name"
            ? (a.name ?? "")
            : ""
    );
    setSel(Math.max(0, DRIVERS.indexOf(a.driver ?? "libsql")));
    setYes(a.daemonRunning ?? true);
    if (key === "inspect") setInspect("checking");
    if (key === "done") {
      setCommit("idle");
      setCommitErr(null);
    }
  };

  const advance = (patch: Answers): void => {
    const next = { ...answers, ...patch };
    setAnswers(next);
    const vis = ORDER.filter((k) => stepVisible(k, next));
    const nk = vis[vis.indexOf(step) + 1];
    if (nk) enter(nk, next);
  };

  const back = (): void => {
    const idx = visible.indexOf(step);
    if (idx <= 0) return onQuit();
    enter(visible[idx - 1]!, answers);
  };

  // connect + inspect when we reach (or retry) the database step
  useEffect(() => {
    if (step !== "inspect" || inspect !== "checking") return;
    let cancelled = false;
    void inspectFor({
      driver: answers.driver ?? "libsql",
      url: answers.url ?? "",
      token: answers.token,
    }).then((c) => {
      if (!cancelled) setInspect(c);
    });
    return () => {
      cancelled = true;
    };
  }, [step, inspect, answers.driver, answers.url, answers.token]);

  const finish = async (): Promise<void> => {
    setCommit("saving");
    setCommitErr(null);
    const cfg = newConfig({
      driver: answers.driver!,
      url: answers.url!,
      token: answers.token || undefined,
      name: answers.name!,
      configDirs: [resolveConfigDir()],
    });
    const res = await applySetup(cfg);
    if (!res.ok) {
      setCommitErr(res.error);
      setCommit("error");
      return;
    }
    if (answers.daemonRunning ?? true) spawnDaemon(res.config);
    onDone(res.config);
  };

  const inspectKind = typeof inspect === "string" ? inspect : inspect.kind;

  useInput(
    (input, key) => {
      if (step === "name" || step === "url" || step === "token") {
        if (key.return) {
          if (step === "name") {
            const v = buf.trim();
            if (!isValidName(v)) return setErr("letters, digits, and hyphens only");
            advance({ name: v });
          } else if (step === "url") {
            advance({ url: buf.trim() || driverUrl(answers.driver ?? "libsql") });
          } else {
            advance({ token: buf.trim() });
          }
        } else if (key.escape) back();
        else if (key.backspace || key.delete) setBuf((b) => b.slice(0, -1));
        else if (input && !key.ctrl && !key.meta) setBuf((b) => b + input);
        return;
      }
      if (step === "driver") {
        if (key.upArrow || input === "k") setSel((c) => (c + DRIVERS.length - 1) % DRIVERS.length);
        else if (key.downArrow || input === "j") setSel((c) => (c + 1) % DRIVERS.length);
        else if (/[1-9]/.test(input) && Number(input) <= DRIVERS.length) setSel(Number(input) - 1);
        else if (key.return) advance({ driver: DRIVERS[sel]! });
        else if (key.escape) back();
        return;
      }
      if (step === "inspect") {
        if (inspectKind === "empty") {
          if (input === "y" || input === "Y") advance({ dbAction: "initialize" });
          else if (input === "n" || input === "N" || key.escape) back();
        } else if (inspectKind === "ccshare") {
          if (input === "y" || input === "Y") advance({ dbAction: "join" });
          else if (input === "n" || input === "N" || key.escape) back();
        } else if (inspectKind === "error") {
          if (key.return) setInspect("checking");
          else if (key.escape) back();
        } else if (key.return || key.escape) back(); // foreign / newer / mismatch: only back
        return;
      }
      if (step === "daemon") {
        if (input === "y" || input === "Y") advance({ daemonRunning: true });
        else if (input === "n" || input === "N") advance({ daemonRunning: false });
        else if (key.leftArrow || key.rightArrow || input === " ") setYes((v) => !v);
        else if (key.return) advance({ daemonRunning: yes });
        else if (key.escape) back();
        return;
      }
      // done
      if (commit === "saving") return;
      if (key.return) void finish();
      else if (key.escape) {
        if (commit === "error") setCommit("idle");
        else back();
      }
    },
    { isActive: !!isRawModeSupported }
  );

  const w = Math.min(74, cols - 4);
  const answered = visible.slice(0, stepNo - 1);
  const value = (k: StepKey): string =>
    k === "name"
      ? answers.name!
      : k === "driver"
        ? answers.driver!
        : k === "url"
          ? answers.url!
          : k === "token"
            ? answers.token || "none"
            : k === "inspect"
              ? answers.dbAction === "join"
                ? "join existing"
                : "initialize (empty)"
              : k === "daemon"
                ? answers.daemonRunning
                  ? "start now"
                  : "don't start"
                : "";

  const isField = step === "name" || step === "driver" || step === "url" || step === "token";
  const question =
    step === "name"
      ? "what should we call you?"
      : step === "driver"
        ? "where to store data?"
        : step === "url"
          ? "database url?"
          : "auth token?";
  const heading = isField
    ? `${stepNo}. ${question}`
    : step === "inspect"
      ? "check the database"
      : step === "daemon"
        ? "start the daemon now?"
        : "ready";
  const hint =
    step === "driver"
      ? "↑↓ select · ⏎ next · esc back"
      : step === "daemon"
        ? "y / n · esc back"
        : step === "inspect"
          ? inspectKind === "empty" || inspectKind === "ccshare"
            ? "y / n · esc back"
            : inspectKind === "error"
              ? "⏎ retry · esc back"
              : "esc back"
          : step === "done"
            ? commit === "saving"
              ? "setting up…"
              : "⏎ continue · esc back"
            : "⏎ next · esc back";

  return (
    <Box flexDirection="column" width={cols} height={rows} paddingX={1}>
      <Box flexGrow={1} />
      <Box
        alignSelf="center"
        flexDirection="column"
        width={w}
        borderStyle="round"
        borderColor={P.orange}
        paddingX={2}
        paddingY={1}
      >
        <Box>
          <Clawd color={P.orange} />
          <Box flexDirection="column" marginLeft={3} flexGrow={1}>
            <Box justifyContent="space-between">
              <Text color={P.orange} bold>
                ccshare setup
              </Text>
              <Text color={P.faint}>
                {stepNo}/{visible.length}
              </Text>
            </Box>
            <Text color={P.dim}>not configured on this machine yet.</Text>
          </Box>
        </Box>
        <Box height={1} />

        {answered.map((k) => (
          <Box key={k}>
            <Text color={P.green}>✓ </Text>
            <Cell w={12}>
              <Text color={P.dim}>{STEP_LABEL[k]}</Text>
            </Cell>
            <Text color={P.cream}>{value(k)}</Text>
          </Box>
        ))}

        <Box height={answered.length ? 1 : 0} />

        <Text color={P.orange} bold>
          {heading}
        </Text>
        <Box height={1} />

        {step === "driver" ? (
          <Box flexDirection="column">
            {DRIVERS.map((d, i) => (
              <Box key={d}>
                <Text color={i === sel ? P.orange : P.faint}>{i === sel ? "▸ " : "  "}</Text>
                <Cell w={12}>
                  <Text color={i === sel ? P.cream : P.dim} bold={i === sel}>
                    {d}
                  </Text>
                </Cell>
                <Text color={i === sel ? P.dim : P.faint}>{DRIVER_DESC[d]}</Text>
              </Box>
            ))}
          </Box>
        ) : step === "daemon" ? (
          <Box>
            <Text color={yes ? P.green : P.faint} bold={yes}>
              {yes ? "▸ Yes" : "  Yes"}
            </Text>
            <Text color={P.faint}>{"     "}</Text>
            <Text color={!yes ? P.red : P.faint} bold={!yes}>
              {!yes ? "▸ No" : "  No"}
            </Text>
            <Text color={P.faint}> records usage in the background</Text>
          </Box>
        ) : step === "inspect" ? (
          <InspectView inspect={inspect} url={answers.url ?? ""} />
        ) : step === "done" ? (
          <Box flexDirection="column">
            {commit === "error" ? (
              <>
                <Text color={P.red}>✗ {commitErr}</Text>
                <Text color={P.dim}>esc to go back and change the connection.</Text>
              </>
            ) : commit === "saving" ? (
              <Text color={P.amber}>writing config and starting the daemon…</Text>
            ) : (
              <>
                <Text color={P.green}>✓ everything checks out.</Text>
                <Box marginTop={1}>
                  <Text backgroundColor={P.ghost} color={P.green} bold>
                    {"  continue  "}
                  </Text>
                  <Text color={P.faint}>{"  ⏎ open the dashboard"}</Text>
                </Box>
              </>
            )}
          </Box>
        ) : (
          <Box flexDirection="column">
            <Text>
              <Text color={P.faint}>{"  › "}</Text>
              {buf.length ? (
                <Text color={P.cream}>{step === "token" ? "•".repeat(buf.length) : buf}</Text>
              ) : (
                <Text color={P.faint}>
                  {step === "name"
                    ? "letters, digits, hyphens"
                    : step === "url"
                      ? `⏎ for ${driverUrl(answers.driver ?? "libsql")}`
                      : "blank if none"}
                </Text>
              )}
              <Text color={P.orange}>▏</Text>
            </Text>
            {err ? <Text color={P.red}>{"  " + err}</Text> : null}
          </Box>
        )}
      </Box>
      <Box flexGrow={1} />
      <Box justifyContent="center">
        <Text color={P.faint}>{hint}</Text>
      </Box>
    </Box>
  );
}

function InspectView({
  inspect,
  url,
}: {
  inspect: Classification | "checking";
  url: string;
}): React.ReactElement {
  if (inspect === "checking") return <Text color={P.amber}>connecting to {url}…</Text>;
  switch (inspect.kind) {
    case "error":
      return <Text color={P.red}>✗ {inspect.message}</Text>;
    case "foreign":
      return (
        <Box flexDirection="column">
          <Text color={P.red}>✗ this database already contains other tables.</Text>
          <Text color={P.dim}>
            ccshare needs its own empty database — go back and change the url.
          </Text>
        </Box>
      );
    case "ccshare-newer":
      return (
        <Box flexDirection="column">
          <Text color={P.red}>✗ this database uses a newer ccshare schema.</Text>
          <Text color={P.dim}>update ccshare, or point at a different database.</Text>
        </Box>
      );
    case "ccshare-foreign-account":
      return (
        <Box flexDirection="column">
          <Text color={P.red}>✗ bound to a different Claude account.</Text>
          <Text color={P.dim}>
            this ledger tracks {inspect.account ?? "another account"} — use that account or a
            different database.
          </Text>
        </Box>
      );
    default:
      return (
        <Box flexDirection="column">
          <Text color={P.green}>
            ✓ connected ·{" "}
            {inspect.kind === "empty"
              ? "the database is empty"
              : "found an existing ccshare database"}
          </Text>
          <Box marginTop={1}>
            <Text color={P.cream}>{inspect.kind === "empty" ? "initialize it?" : "join it?"}</Text>
            <Text color={P.faint}>{"  "}[y/n]</Text>
          </Box>
        </Box>
      );
  }
}
