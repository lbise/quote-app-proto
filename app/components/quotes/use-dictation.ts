import { useCallback, useEffect, useRef, useState } from "react";

import { MAX_AUDIO_BYTES, preferredAudioMimeType, recordingPhase } from "../../lib/dictation";

export type DictationFailure = "failed" | "cancelled" | "spend_limit" | "too_large" | "unavailable";
export type DictationBlocked = "denied" | "insecure" | "unsupported" | "no_microphone" | "error";
export type DictationNotice = "empty" | "nothing_recorded" | "limit";

/**
 * Audio lives only in this state, in memory in this tab. It is never written
 * to storage; closing or reloading the tab loses it.
 */
export type DictationState =
  | { status: "idle"; blocked?: DictationBlocked; notice?: DictationNotice }
  | { status: "requesting" }
  | { status: "recording"; startedAt: number }
  | { status: "interrupted"; audio: Blob }
  | { status: "transcribing"; audio: Blob; notice?: DictationNotice }
  | { status: "failed"; audio: Blob; reason: DictationFailure };

type Recording = { recorder: MediaRecorder; stream: MediaStream; chunks: Blob[]; interrupted: boolean; cleanup: () => void };

function blockedReason(error: unknown): DictationBlocked {
  const name = error instanceof DOMException || error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "no_microphone";
  return "error";
}

function failureReason(status: number, code: unknown): DictationFailure {
  if (code === "spend_limit_reached") return "spend_limit";
  if (status === 413 || code === "audio_too_large") return "too_large";
  if (code === "transcription_unavailable") return "unavailable";
  return "failed";
}

/**
 * Tap to record, tap to stop, then transcribe on the server. The transcript is
 * handed to `onTranscript`; nothing is ever sent as a message from here.
 */
export function useDictation(onTranscript: (text: string) => void) {
  const [state, setState] = useState<DictationState>({ status: "idle" });
  const [now, setNow] = useState(() => Date.now());
  const recording = useRef<Recording | null>(null);
  const transcription = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const deliver = useRef(onTranscript);
  deliver.current = onTranscript;

  const update = useCallback((next: DictationState) => { if (alive.current) setState(next); }, []);

  const transcribe = useCallback(async (audio: Blob, notice?: DictationNotice) => {
    if (audio.size > MAX_AUDIO_BYTES) { update({ status: "failed", audio, reason: "too_large" }); return; }
    const controller = new AbortController();
    transcription.current = controller;
    update({ status: "transcribing", audio, ...(notice ? { notice } : {}) });
    try {
      const response = await fetch("/api/transcriptions", {
        method: "POST", headers: { "content-type": audio.type || "application/octet-stream" }, body: audio, signal: controller.signal,
      });
      const data = await response.json().catch(() => ({})) as { text?: unknown; error?: unknown };
      if (!response.ok) { update({ status: "failed", audio, reason: failureReason(response.status, data.error) }); return; }
      const text = typeof data.text === "string" ? data.text.trim() : "";
      if (!alive.current) return;
      if (text) deliver.current(text);
      update(text ? { status: "idle" } : { status: "idle", notice: "empty" });
    } catch {
      update({ status: "failed", audio, reason: controller.signal.aborted ? "cancelled" : "failed" });
    } finally {
      if (transcription.current === controller) transcription.current = null;
    }
  }, [update]);

  const stop = useCallback((interrupted = false) => {
    const current = recording.current;
    if (!current) return;
    current.interrupted ||= interrupted;
    if (current.recorder.state !== "inactive") current.recorder.stop();
  }, []);

  const start = useCallback(async () => {
    if (recording.current || transcription.current) return;
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      update({ status: "idle", blocked: window.isSecureContext === false ? "insecure" : "unsupported" });
      return;
    }
    update({ status: "requesting" });
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (error) { update({ status: "idle", blocked: blockedReason(error) }); return; }
    if (!alive.current) { stream.getTracks().forEach((track) => track.stop()); return; }

    const mimeType = preferredAudioMimeType((type) => MediaRecorder.isTypeSupported(type));
    let recorder: MediaRecorder;
    try {
      // 64 kb/s keeps five minutes of mp4/aac well under the upload limit.
      recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 64_000 });
    } catch {
      stream.getTracks().forEach((track) => track.stop());
      update({ status: "idle", blocked: "unsupported" });
      return;
    }
    const chunks: Blob[] = [];
    // Screen lock, app switch, a revoked permission or a lost device end the
    // recording early. What was captured so far is kept.
    const interrupt = () => stop(true);
    const hidden = () => { if (document.visibilityState === "hidden") interrupt(); };
    const tracks = stream.getAudioTracks();
    tracks.forEach((track) => track.addEventListener("ended", interrupt));
    document.addEventListener("visibilitychange", hidden);
    const cleanup = () => {
      tracks.forEach((track) => track.removeEventListener("ended", interrupt));
      document.removeEventListener("visibilitychange", hidden);
      stream.getTracks().forEach((track) => track.stop());
    };
    const current: Recording = { recorder, stream, chunks, interrupted: false, cleanup };
    recording.current = current;
    const startedAt = Date.now();
    recorder.addEventListener("dataavailable", (event) => { if (event.data.size) chunks.push(event.data); });
    recorder.addEventListener("error", interrupt);
    recorder.addEventListener("stop", () => {
      cleanup();
      recording.current = null;
      if (!alive.current) return;
      const audio = new Blob(chunks, { type: recorder.mimeType || mimeType || chunks[0]?.type || "" });
      const limit = recordingPhase(Date.now() - startedAt) === "limit";
      if (!audio.size) update({ status: "idle", notice: "nothing_recorded" });
      else if (current.interrupted) update({ status: "interrupted", audio });
      else void transcribe(audio, limit ? "limit" : undefined);
    });
    // Regular chunks keep captured audio if the recorder fails later.
    recorder.start(1_000);
    setNow(startedAt);
    update({ status: "recording", startedAt });
  }, [stop, transcribe, update]);

  // The timer drives the visible elapsed time, the warning and the automatic stop.
  useEffect(() => {
    if (state.status !== "recording") return;
    const tick = () => {
      const time = Date.now();
      setNow(time);
      if (recordingPhase(time - state.startedAt) === "limit") stop();
    };
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [state, stop]);

  // Warn before a reload or close would lose audio that is not yet transcribed.
  const holdsAudio = state.status === "recording" || state.status === "interrupted" || state.status === "transcribing" || state.status === "failed";
  useEffect(() => {
    if (!holdsAudio) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [holdsAudio]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      transcription.current?.abort();
      const current = recording.current;
      if (current) { current.cleanup(); if (current.recorder.state !== "inactive") current.recorder.stop(); }
    };
  }, []);

  const elapsedMs = state.status === "recording" ? Math.max(0, now - state.startedAt) : 0;
  return {
    state,
    elapsedMs,
    phase: recordingPhase(elapsedMs),
    start,
    stop: () => stop(),
    cancel: () => transcription.current?.abort(),
    retry: () => { if (state.status === "failed" || state.status === "interrupted") void transcribe(state.audio); },
    discard: () => update({ status: "idle" }),
    dismiss: () => { if (state.status === "idle") update({ status: "idle" }); },
  };
}
