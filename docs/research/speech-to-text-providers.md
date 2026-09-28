# Speech-to-text providers via OpenRouter

Researched for dictation into the Quote conversation composer. Sources are OpenRouter primary docs and live API listings, fetched during the speech-input grilling session. Verify again before relying on prices or ZDR membership; both change often.

## OpenRouter transcription endpoint

Source: https://openrouter.ai/docs/guides/overview/multimodal/stt.md

- `POST /api/v1/audio/transcriptions`. JSON body with base64 `input_audio` (`data`, `format`), or OpenAI-compatible `multipart/form-data`.
- Formats listed: `wav`, `mp3`, `flac`, `m4a`, `ogg`, `webm`, `aac`. Browser recordings: Chrome/Android produce webm/opus, iOS Safari produces mp4/aac (`m4a`). Per-model support varies.
- `language` (ISO-639-1) is optional; the language is auto-detected if omitted. It forces a language; there is no soft hint.
- `prompt` is accepted but **ignored**. Vocabulary or keyword hints are only possible through provider-specific `provider.options`, and some integrations silently drop options that are not on their allowlist. Test before relying on it.
- Routing preferences (`order`, `only`, `ignore`) are **not applied** to transcription requests.
- Response includes `text` and `usage.cost` (USD), so transcription spend can be counted against the existing spend limit.
- Multipart limit: 25 MB. Upstream providers time out after about 60 seconds of *processing* per request.
- BYOK is supported.

## ZDR and region

Sources: https://openrouter.ai/docs/guides/features/zdr.md, https://openrouter.ai/api/v1/endpoints/zdr, https://openrouter.ai/docs/guides/features/in-region-routing.md

- ZDR can be enforced in account privacy settings or per request. The docs say ZDR enforcement applies to provider routing for inference requests. Whether it applies to the transcription endpoint, given that routing preferences are ignored there, is **unverified**.
- EU in-region routing (`eu.openrouter.ai`) needs the Business or Enterprise plan. There is no Swiss region.

## Candidate models (live listing, `output_modalities=transcription`)

| Model | Listed ZDR endpoint | Listed price field | Notes |
| --- | --- | --- | --- |
| `mistralai/voxtral-mini-transcribe` | Mistral | 0.00005 (~$0.003/min if per second) | French company; Mistral docs claim French support, noise robustness, context biasing |
| `deepgram/nova-3` | Deepgram | 0.0000717 (~$0.0043/min) | Multilingual; Deepgram options allowlist excludes vocabulary hints via OpenRouter |
| `google/chirp-3` | Google | 0.000267 (~$0.016/min) | 24 GA languages |
| `microsoft/mai-transcribe-2` | Azure | listed 0.1 (unit unclear) | Claims #1 on FLEURS multilingual |
| `openai/whisper-large-v3(-turbo)` | Groq, DeepInfra, Together | 0.0000075 / 0.0000033 | Open weights |
| `openai/gpt-4o-transcribe`, `openai/gpt-transcribe` | **not in ZDR list** | token-based / 0.000075 | Only use with synthetic test audio |

The per-minute figures assume the price field is USD per second of audio. That matches `openai/whisper-1` at 0.0001, which is OpenAI's published $0.006/min.

Mistral docs (https://docs.mistral.ai/capabilities/audio_transcription/) list French among 13 languages, context biasing for domain vocabulary, and recordings up to 3 hours.

## Gemini (current assistant model)

Sources: https://ai.google.dev/gemini-api/docs/audio, OpenRouter models API.

- `gemini-3.5-flash-lite` accepts audio input (OpenRouter lists `audio` in its input modalities).
- Transcription is prompt-based ("transcribe this audio"). There is no dedicated endpoint, so the prompt can carry vocabulary hints.
- Inline audio is allowed up to 20 MB total request size; larger files go through the Files API. Supported MIME types include `audio/webm`, `audio/aac`, `audio/m4a`, `audio/ogg` and `audio/opus`.
- `@earendil-works/pi-ai` message content only supports text and image parts, so audio has to be sent with a direct Gemini API call.
- Google's terms differ between the free and paid tiers. See the caution in `docs/quote-ai.md`. This is not a zero-retention setup.

## Infomaniak (Swiss)

Source: https://www.infomaniak.com/en/hosting/ai-services/prices

- Whisper V3 transcription at CHF 0.006/minute, hosted in Switzerland by a Swiss provider.
- API shape (OpenAI-compatible or not) and retention terms are unverified.

## Not verified

- Actual accuracy on Swiss French numbers (septante, huitante, nonante), measurements and joinery vocabulary.
- Whether OpenRouter forwards Mistral's context-biasing option.
- Provider retention terms beyond OpenRouter's ZDR listing.
