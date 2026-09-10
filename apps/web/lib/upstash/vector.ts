import { Index } from "@upstash/vector";

// Lazy on purpose: unlike the Redis/QStash clients elsewhere in this repo
// (which just log a warning when unconfigured), @upstash/vector's Index
// constructor throws a hard error when the token is missing. Constructing
// it eagerly at module scope meant importing this file at all — even just
// via find-relevant-docs.ts's import chain — crashed the entire production
// build ("Failed to collect page data for /api/ai/support-chat") on any
// environment without Upstash Vector configured. Deferring construction to
// first real use means it only fails if something actually calls it.
let _vectorIndex: Index | null = null;

export function getVectorIndex(): Index {
  if (!_vectorIndex) {
    _vectorIndex = new Index({
      url: process.env.UPSTASH_VECTOR_REST_URL!,
      token: process.env.UPSTASH_VECTOR_REST_TOKEN!,
    });
  }
  return _vectorIndex;
}
