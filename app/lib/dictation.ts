/** Browser-safe dictation rules shared by the composer and its tests. */

export const RECORDING_WARNING_MS = 270_000;
export const RECORDING_LIMIT_MS = 300_000;

/** Upload ceiling for one recording; five minutes of browser speech audio is far smaller. */
export const MAX_AUDIO_BYTES = 5 * 1024 * 1024;

/** Appends a transcript without ever removing existing composer text. */
export function appendTranscript(existing: string, transcript: string): string {
  const text = transcript.trim();
  if (!text) return existing;
  if (!existing || /\s$/.test(existing)) return existing + text;
  return `${existing}${/[.!?:;]$/.test(existing) ? "\n" : " "}${text}`;
}

/**
 * Character edit distance between the text the composer would hold without
 * edits and the sent text, relative to the longer of the two. Zero means sent
 * unchanged, one means entirely replaced. Rounded to four decimals.
 */
export function editRatio(expected: string, sent: string): number {
  const a = [...expected.trim()], b = [...sent.trim()];
  const longest = Math.max(a.length, b.length);
  if (!longest) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return Math.round((previous[b.length] / longest) * 10_000) / 10_000;
}

/** What the composer would contain if the Artisan had not edited any transcript. */
export type DictationTracking = { expected: string };

/** Starts from the composer text at the first dictation, so earlier typing is not counted as an edit. */
export function trackTranscript(tracking: DictationTracking | null, composer: string, transcript: string): DictationTracking {
  return { expected: appendTranscript(tracking?.expected ?? composer, transcript) };
}

export type DictationMetadata = { editRatio: number };

export function dictationForSend(tracking: DictationTracking | null, sent: string): DictationMetadata | undefined {
  return tracking ? { editRatio: editRatio(tracking.expected, sent) } : undefined;
}

export function recordingPhase(elapsedMs: number): "recording" | "warning" | "limit" {
  if (elapsedMs >= RECORDING_LIMIT_MS) return "limit";
  if (elapsedMs >= RECORDING_WARNING_MS) return "warning";
  return "recording";
}

export function formatRecordingTime(elapsedMs: number): string {
  const seconds = Math.floor(Math.max(0, elapsedMs) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Native formats: webm/opus on Chrome and Android, mp4/aac on iOS Safari, ogg/opus on Firefox. */
const recordingTypes = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"] as const;

export function preferredAudioMimeType(isTypeSupported: (type: string) => boolean): string | undefined {
  return recordingTypes.find((type) => isTypeSupported(type));
}
