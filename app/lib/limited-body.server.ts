export class BodyLimitError extends Error {
  constructor() { super('Request or response body exceeds its size limit.'); }
}

/** Checks streamed bytes as well as the optional declared size before decoding. */
export async function readLimitedBody(
  source: Pick<Request, 'headers' | 'body'>,
  maximumBytes: number,
): Promise<string> {
  const declared = source.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximumBytes)) throw new BodyLimitError();
  if (!source.body) throw new Error('Missing body.');
  const reader = source.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) {
        await reader.cancel();
        throw new BodyLimitError();
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}
