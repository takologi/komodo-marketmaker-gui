"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { UiApiResponse } from "@/lib/kdf/types";

const DEFAULT_POLL_MS = Number.parseInt(process.env.NEXT_PUBLIC_POLL_MS ?? "5000", 10);

interface PollingState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  fetchedAt: string | null;
  refresh: () => Promise<void>;
}

export function usePolling<T>(url: string): PollingState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  const pollMs = useMemo(() => {
    if (Number.isFinite(DEFAULT_POLL_MS) && DEFAULT_POLL_MS > 0) return DEFAULT_POLL_MS;
    return 5000;
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const response = await fetch(url, { cache: "no-store" });
      const json = (await response.json()) as UiApiResponse<T>;

      if (!json.ok) {
        throw new Error(json.message || "Request failed");
      }

      setData(json.data ?? null);
      setFetchedAt(json.fetchedAt ?? null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown request error");
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    void fetchData();
    const timer = setInterval(() => {
      void fetchData();
    }, pollMs);

    return () => clearInterval(timer);
  }, [fetchData, pollMs]);

  return { data, loading, error, fetchedAt, refresh: fetchData };
}
