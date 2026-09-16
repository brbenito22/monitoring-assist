import { useEffect, useState } from "react";
import { queryExecutionClient } from "@dynatrace-sdk/client-query";

const POLL_MS = 1000;
const MAX_POLLS = 20;
const PENDING = new Set(["RUNNING", "NOT_STARTED"]);

export interface DqlState<T> {
  data: T[] | null;
  isLoading: boolean;
  error: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs one DQL query to completion, polling while it is pending.
 * Exported so callers that need N queries in sequence (the methodology sets)
 * share the same execution path as the hook.
 */
export async function runDql<T = Record<string, unknown>>(
  query: string,
  isCancelled: () => boolean = () => false,
): Promise<T[]> {
  let res = await queryExecutionClient.queryExecute({ body: { query } });

  for (let i = 0; i < MAX_POLLS && res.state !== "SUCCEEDED"; i++) {
    if (!PENDING.has(res.state)) {
      throw new Error(`Query ${res.state.toLowerCase()}`);
    }
    if (!res.requestToken) throw new Error("Query pending without a request token");
    await sleep(POLL_MS);
    if (isCancelled()) return [];
    res = await queryExecutionClient.queryPoll({ requestToken: res.requestToken });
  }

  if (res.state !== "SUCCEEDED") throw new Error("Query timed out");
  return (res.result?.records ?? []) as T[];
}

/** Runs a DQL query with async polling. Pass `null` to skip execution. */
export function useDql<T = Record<string, unknown>>(query: string | null): DqlState<T> {
  const [state, setState] = useState<DqlState<T>>({ data: null, isLoading: !!query, error: null });

  useEffect(() => {
    if (!query) {
      setState({ data: null, isLoading: false, error: null });
      return;
    }
    let cancelled = false;
    setState({ data: null, isLoading: true, error: null });

    (async () => {
      try {
        const data = await runDql<T>(query, () => cancelled);
        if (cancelled) return;
        setState({ data, isLoading: false, error: null });
      } catch (err) {
        if (cancelled) return;
        setState({
          data: null,
          isLoading: false,
          error: err instanceof Error ? err.message : "Query failed",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [query]);

  return state;
}
