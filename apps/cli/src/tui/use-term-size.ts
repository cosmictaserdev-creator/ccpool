import { useEffect, useState } from "react";
import { useStdout } from "ink";

/**
 * Current terminal size, updated on every resize. Ink's `useStdout` alone doesn't
 * re-render on resize, so screens that read `stdout.columns` once look frozen when
 * the window changes — this subscribes to the stream's `resize` event so anything
 * using it reflows live.
 */
export function useTermSize(): { cols: number; rows: number } {
  const { stdout } = useStdout();
  const [size, setSize] = useState({
    cols: stdout?.columns ?? 80,
    rows: stdout?.rows ?? 24,
  });

  useEffect(() => {
    if (!stdout) return;
    const onResize = (): void => setSize({ cols: stdout.columns ?? 80, rows: stdout.rows ?? 24 });
    onResize();
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);

  return size;
}
