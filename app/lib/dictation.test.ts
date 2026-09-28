import { describe, expect, it } from "vitest";

import { appendTranscript, dictationForSend, editRatio, formatRecordingTime, preferredAudioMimeType, recordingPhase, trackTranscript } from "./dictation";

describe("appending a transcript to the composer", () => {
  it("uses the transcript alone in an empty composer", () => {
    expect(appendTranscript("", "Trois portes.")).toBe("Trois portes.");
  });

  it("keeps existing text and separates the transcript with a space", () => {
    expect(appendTranscript("Salle de bain", "trois portes")).toBe("Salle de bain trois portes");
  });

  it("starts a new line after a finished sentence", () => {
    expect(appendTranscript("Salle de bain, trois portes.", "Cuisine, deux fenêtres.")).toBe("Salle de bain, trois portes.\nCuisine, deux fenêtres.");
  });

  it("adds no separator after existing whitespace", () => {
    expect(appendTranscript("Salle de bain\n", "trois portes")).toBe("Salle de bain\ntrois portes");
    expect(appendTranscript("Salle de bain ", "trois portes")).toBe("Salle de bain trois portes");
  });

  it("leaves the composer unchanged for an empty transcript", () => {
    expect(appendTranscript("Salle de bain", "  ")).toBe("Salle de bain");
  });
});

describe("edit ratio", () => {
  it("is zero when the transcript is sent unchanged", () => {
    expect(editRatio("Trois portes.", "Trois portes.")).toBe(0);
  });

  it("ignores surrounding whitespace", () => {
    expect(editRatio("Trois portes. ", "  Trois portes.")).toBe(0);
  });

  it("is the character edit distance relative to the longer text", () => {
    // One substitution in ten characters.
    expect(editRatio("abcdefghij", "abcdefghiX")).toBe(0.1);
    expect(editRatio("trois", "trois portes")).toBe(0.5833);
  });

  it("is one when everything was replaced", () => {
    expect(editRatio("abc", "xyz")).toBe(1);
    expect(editRatio("abc", "")).toBe(1);
  });
});

describe("dictation tracking", () => {
  it("records a dictated message whose transcript was sent unchanged", () => {
    const tracked = trackTranscript(null, "", "Trois portes.");
    expect(dictationForSend(tracked, "Trois portes.")).toEqual({ editRatio: 0 });
  });

  it("does not count typed text before the first dictation as an edit", () => {
    const tracked = trackTranscript(null, "Salle de bain", "trois portes");
    expect(dictationForSend(tracked, "Salle de bain trois portes")).toEqual({ editRatio: 0 });
  });

  it("measures edits across several dictations", () => {
    const first = trackTranscript(null, "", "Trois portes.");
    const second = trackTranscript(first, "Trois portes.", "Deux fenêtres.");
    expect(second.expected).toBe("Trois portes.\nDeux fenêtres.");
    expect(dictationForSend(second, "Trois portes.\nDeux fenêtres.")).toEqual({ editRatio: 0 });
    expect(dictationForSend(second, "Trois portes.\nDeux fenetres.")!.editRatio).toBeGreaterThan(0);
  });

  it("reports a typed message as not dictated", () => {
    expect(dictationForSend(null, "Trois portes.")).toBeUndefined();
  });
});

describe("recording limits", () => {
  it("warns at 4:30 and stops at 5:00", () => {
    expect(recordingPhase(0)).toBe("recording");
    expect(recordingPhase(269_999)).toBe("recording");
    expect(recordingPhase(270_000)).toBe("warning");
    expect(recordingPhase(299_999)).toBe("warning");
    expect(recordingPhase(300_000)).toBe("limit");
  });

  it("formats elapsed time as minutes and seconds", () => {
    expect(formatRecordingTime(0)).toBe("0:00");
    expect(formatRecordingTime(9_999)).toBe("0:09");
    expect(formatRecordingTime(270_000)).toBe("4:30");
    expect(formatRecordingTime(300_000)).toBe("5:00");
  });
});

describe("recording format", () => {
  it("prefers webm/opus, then mp4, then ogg/opus", () => {
    expect(preferredAudioMimeType(() => true)).toBe("audio/webm;codecs=opus");
    expect(preferredAudioMimeType((type) => type === "audio/mp4")).toBe("audio/mp4");
    expect(preferredAudioMimeType((type) => type === "audio/ogg;codecs=opus")).toBe("audio/ogg;codecs=opus");
  });

  it("leaves the choice to the browser when none is reported", () => {
    expect(preferredAudioMimeType(() => false)).toBeUndefined();
  });
});
