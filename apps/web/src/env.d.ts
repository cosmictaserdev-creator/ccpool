/// <reference path="../.astro/types.d.ts" />

interface Window {
  posthog?: {
    capture: (event: string, properties?: Record<string, unknown>) => void;
    identify: (id: string, properties?: Record<string, unknown>) => void;
    reset: () => void;
    captureException: (error: unknown) => void;
    [key: string]: unknown;
  };
  __posthog_initialized?: boolean;
}
