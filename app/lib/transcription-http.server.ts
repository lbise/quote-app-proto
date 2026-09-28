import { getAuth } from "./auth.server";
import { type Database, getDatabase } from "./db.server";
import { MAX_AUDIO_BYTES } from "./dictation";
import { BodyLimitError, readLimitedBytes } from "./limited-body.server";
import { assertMutationOrigin, authorised, failureResponse, RequestFailure, type SessionAuth } from "./quotes.server";
import { audioFormat, configuredTranscriber, TranscriptionError, type Transcriber, type TranscriptionFailure } from "./transcription.server";

const failures: Record<TranscriptionFailure, [number, string]> = {
  spend_limit_reached: [503, "spend_limit_reached"],
  spend_ledger_unavailable: [503, "transcription_unavailable"],
  timeout: [504, "transcription_timeout"],
  cancelled: [499, "transcription_cancelled"],
  provider_failed: [502, "transcription_failed"],
  invalid_response: [502, "transcription_failed"],
};

/**
 * `POST /api/transcriptions` with raw webm, mp4 or ogg audio of at most 5 MB:
 * returns `{ text }`. The audio stays in memory for this request only. It is
 * never stored or logged, and neither is the transcript.
 */
export function createTranscriptionHandler(dependencies: { database?: Database; auth?: SessionAuth; transcriber?: Transcriber | null } = {}) {
  const database = dependencies.database ?? getDatabase();
  const auth = dependencies.auth ?? getAuth();
  const transcriber = () => dependencies.transcriber !== undefined ? dependencies.transcriber : configuredTranscriber();

  return async function transcriptionHandler(request: Request): Promise<Response> {
    try {
      await authorised(request, auth, database);
      if (request.method !== "POST") throw new RequestFailure(405, "method_not_allowed");
      assertMutationOrigin(request);
      let data: Uint8Array;
      try { data = await readLimitedBytes(request, MAX_AUDIO_BYTES); }
      catch (error) {
        if (error instanceof BodyLimitError) throw new RequestFailure(413, "audio_too_large");
        throw new RequestFailure(400, "invalid_request");
      }
      const format = audioFormat(data);
      if (!format) throw new RequestFailure(415, "unsupported_audio_type");
      const transcribe = transcriber();
      if (!transcribe) throw new RequestFailure(503, "transcription_unavailable");
      try {
        const { text } = await transcribe({ data, format }, { signal: request.signal });
        return Response.json({ text }, { headers: { "cache-control": "no-store" } });
      } catch (error) {
        if (error instanceof TranscriptionError) throw new RequestFailure(...failures[error.code]);
        throw error;
      }
    } catch (error) {
      return failureResponse(error, "transcription_failed");
    }
  };
}
