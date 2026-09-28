import { createTranscriptionHandler } from "../lib/transcription-http.server";

const handler = createTranscriptionHandler();

export async function loader({ request }: { request: Request }) {
  return handler(request);
}

export async function action({ request }: { request: Request }) {
  return handler(request);
}
