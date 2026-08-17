import { useCallback, useState } from "react";
import type { ActionResult } from "../types";

interface Options<T> {
  /** Performs the write. Whatever it returns is passed to `describe`. */
  run: () => Promise<T>;
  /** Banner title on success, e.g. "SLO created". */
  successTitle: string;
  /** Banner title on failure, e.g. "Failed to create SLO". */
  failureTitle: string;
  /** Detail line, derived from the API response. */
  describe?: (result: T) => string;
}

/**
 * The create-something-in-Dynatrace pattern, in one place.
 *
 * Every panel was repeating the same block: flip a busy flag, clear the last
 * result, await one write call, unwrap the response, and turn any throw into a
 * readable banner instead of an unhandled rejection. Five copies meant five
 * chances for the error branch to drift — and the error branch is the one that
 * matters, since it's what the user sees when a payload is rejected.
 */
export function useCreateAction<T>({
  run,
  successTitle,
  failureTitle,
  describe,
}: Options<T>) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);

  const execute = useCallback(async () => {
    setBusy(true);
    setResult(null);
    try {
      const value = await run();
      setResult({
        ok: true,
        title: successTitle,
        detail: describe?.(value),
      });
      return value;
    } catch (err) {
      setResult({
        ok: false,
        title: failureTitle,
        // API errors arrive as Error, as plain objects, or as response bodies —
        // stringify whatever it is rather than rendering "[object Object]".
        detail: err instanceof Error ? err.message : JSON.stringify(err),
      });
      return undefined;
    } finally {
      setBusy(false);
    }
  }, [run, successTitle, failureTitle, describe]);

  return { busy, result, setResult, execute };
}

/** Pulls the objectId out of a Settings API create response. */
export function settingsObjectId(res: unknown): string | undefined {
  const first = Array.isArray(res) ? res[0] : undefined;
  return (first as { objectId?: string } | undefined)?.objectId;
}
