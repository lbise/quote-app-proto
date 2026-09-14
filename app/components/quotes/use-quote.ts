import { useCallback, useEffect, useRef, useState } from "react";
import type { QuoteCalculation, QuoteData } from "../../lib/quote";
import { randomUUID } from "../../lib/random-id";

export type ConversationMessage = { role: "artisan" | "assistant" | "note"; fr: string; en: string; changed?: string[]; changedFields?: string[] };
export type QuoteRecord = {
  id: string;
  version: number;
  draft: QuoteData | null;
  revisions: { number: number; publishedAt: string; quote: QuoteData; calculation: QuoteCalculation }[];
  messages: ConversationMessage[];
  pending: boolean;
  canUndo: boolean;
  assistantRequest?: { requestId: string; text: string; status: 'pending' | 'complete' | 'failed' | 'stale'; baseVersion: number } | null;
  reviewPublication?: boolean;
};
export type QuoteList = { quotes: { id: string; reference: string; title: string; customerName: string; hasDraft: boolean; revision: number; updatedAt: string }[] };

export class RequestError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
export async function quoteRequest<T>(body?: Record<string, unknown>, id?: string): Promise<T> {
  const response = await fetch(`/api/quotes${id ? `?id=${encodeURIComponent(id)}` : ""}`, body ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  } : { cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new RequestError(response.status, data.error ?? "request_failed");
  return data as T;
}

type SaveAction = { quote: QuoteData; requestId: string; sequence: number; expectedVersion?: number };

/** Serialises saves without blocking editing. A failed request stays queued with its retry key. */
export function useQuote(initial: QuoteRecord) {
  const [record, setRecord] = useState(initial);
  const [quote, setQuote] = useState(initial.draft ?? initial.revisions.at(-1)!.quote);
  const [save, setSave] = useState<"saved" | "saving" | "error">("saved");
  const [ai, setAi] = useState<"idle" | "processing" | "error" | "stale">(initial.pending ? "processing" : initial.assistantRequest?.status === 'failed' ? 'error' : initial.assistantRequest?.status === 'stale' ? 'stale' : 'idle');
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState<string[]>([]);
  const [changedFields, setChangedFields] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const current = useRef(initial);
  const sequence = useRef(0);
  const queue = useRef<SaveAction[]>([]);
  const saving = useRef<Promise<boolean> | null>(null);
  const alive = useRef(true);
  const lastRequest = useRef<{ text: string; requestId: string; baseVersion: number; locale?: 'fr' | 'en' } | null>(initial.assistantRequest ?? null);
  const actionRetry = useRef<{ action: string; requestId: string; version: number } | null>(null);
  const rejectedSave = useRef(false);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (save === "saved") return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [save]);

  const accept = useCallback((next: QuoteRecord, replaceQuote: boolean) => {
    current.current = next;
    if (!alive.current) return;
    setRecord(next);
    if (replaceQuote) setQuote(next.draft ?? next.revisions.at(-1)!.quote);
  }, []);

  useEffect(() => {
    if (!initial.pending) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function refreshPending() {
      try {
        const next = await quoteRequest<QuoteRecord>(undefined, initial.id);
        if (cancelled) return;
        if (next.version >= current.current.version) accept(next, queue.current.length === 0);
        if (!next.pending) {
          lastRequest.current = next.assistantRequest ?? lastRequest.current;
          setAi(next.assistantRequest?.status === 'failed' ? 'error' : next.assistantRequest?.status === 'stale' ? 'stale' : 'idle');
          return;
        }
      } catch { /* A later poll can recover without discarding local edits. */ }
      if (!cancelled) timer = setTimeout(refreshPending, 1500);
    }
    void refreshPending();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [initial.id, initial.pending, accept]);

  const flush = useCallback((): Promise<boolean> => {
    if (saving.current) return saving.current;
    const work = async () => {
      setSave("saving"); setError(null);
      while (queue.current.length) {
        const action = queue.current[0];
        try {
          action.expectedVersion ??= current.current.version;
          const next = await quoteRequest<QuoteRecord>({ action: "save", id: initial.id, expectedVersion: action.expectedVersion, requestId: action.requestId, quote: action.quote });
          queue.current.shift();
          rejectedSave.current = false;
          accept(next, sequence.current === action.sequence);
        } catch (failure) {
          rejectedSave.current = failure instanceof RequestError && (failure.status === 422 || failure.code === 'conflict' || failure.code === 'reference_in_use');
          if (alive.current) { setSave("error"); setError(failure instanceof RequestError ? failure.code : "connection_failed"); }
          return false;
        }
      }
      if (alive.current) setSave("saved");
      return true;
    };
    saving.current = work().finally(() => { saving.current = null; });
    return saving.current;
  }, [accept, initial.id]);

  function apply(next: QuoteData, ids: string[] = []) {
    if (!current.current.draft || busy) return;
    setQuote(next); setChanged(ids); setChangedFields([]); setSave("saving");
    // A definite validation rejection was never saved. Replace it with the corrected snapshot.
    // An uncertain network failure must instead retry its original key first.
    if (rejectedSave.current) { queue.current = []; rejectedSave.current = false; }
    queue.current.push({ quote: structuredClone(next), requestId: randomUUID(), sequence: ++sequence.current });
    void flush();
  }

  async function mutate(action: "publish" | "new-draft" | "undo") {
    if (busy || ai === "processing") return null;
    setBusy(true); setError(null);
    try {
      if (!(await flush())) return null;
      const retry = actionRetry.current;
      const request = retry?.action === action && retry.version === current.current.version ? retry : { action, requestId: randomUUID(), version: current.current.version };
      actionRetry.current = request;
      const next = await quoteRequest<QuoteRecord>({ action, id: initial.id, expectedVersion: request.version, requestId: request.requestId });
      actionRetry.current = null;
      accept(next, true); setChanged([]); setChangedFields([]);
      return next;
    } catch (failure) {
      setError(failure instanceof RequestError ? failure.code : "connection_failed");
      return null;
    } finally { if (alive.current) setBusy(false); }
  }

  async function runAssistant(text: string, locale: "fr" | "en", retry = false) {
    if (!text.trim() || ai === "processing" || busy || !current.current.draft) return null;
    if (!(await flush())) return null;
    const start = sequence.current;
    // Network retries reuse the request key. A rejected stale response needs a new request against current content.
    const previous = lastRequest.current;
    const replay = retry && ai !== 'stale' && previous?.locale && (previous.baseVersion === current.current.version || current.current.assistantRequest?.status === 'complete');
    const requestId = replay ? previous.requestId : randomUUID();
    const baseVersion = replay ? previous.baseVersion : current.current.version;
    const requestLocale = replay ? previous.locale ?? locale : locale;
    lastRequest.current = { text, requestId, baseVersion, locale: requestLocale };
    setAi("processing"); setError(null);
    if (!retry || ai === 'stale') setRecord(previous => ({ ...previous, messages: [...previous.messages, { role: 'artisan', fr: text, en: text }] }));
    try {
      const next = await quoteRequest<QuoteRecord>({ action: "assistant", id: initial.id, expectedVersion: baseVersion, requestId, text, locale: requestLocale });
      if (sequence.current !== start) {
        // A local edit may not yet have reached the server. Never replace it with an AI result.
        if (next.version > current.current.version) accept(next, false);
        setAi("stale"); return null;
      }
      accept(next, true); setChanged(next.messages.at(-1)?.changed ?? []); setChangedFields(next.messages.at(-1)?.changedFields ?? []); setAi("idle");
      return next;
    } catch (failure) {
      const stale = failure instanceof RequestError && failure.status === 409;
      setAi(stale ? "stale" : "error");
      // Reload only persisted conversation/status, never a newer local edit.
      try {
        const next = await quoteRequest<QuoteRecord>(undefined, initial.id);
        if (next.version >= current.current.version) accept(next, false);
      } catch { /* Local content remains visible until a retry succeeds. */ }
      return null;
    }
  }

  return { record, quote, save, ai, error, changed, changedFields, busy, apply, flush, mutate, runAssistant, lastRequest };
}
