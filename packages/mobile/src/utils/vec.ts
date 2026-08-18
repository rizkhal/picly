// Embedding vector helpers for the mobile store — mirrors desktop
// packages/desktop/src/main/db/vec.ts but without Buffer (not a global in RN).

export const EMBEDDING_DIM = 512;

/**
 * Uint8Array / ArrayBuffer (as stored in sqlite BLOB) -> Float32Array view.
 *
 * Hermes (RN) can hand back blobs as either a Uint8Array or a raw ArrayBuffer;
 * handle both and return null for anything malformed instead of throwing.
 */
export function blobToEmbedding(bytes: Uint8Array | ArrayBuffer | null | undefined): Float32Array | null {
  if (bytes == null) return null;
  const isArrayBuffer = bytes instanceof ArrayBuffer;
  const buf: ArrayBuffer = isArrayBuffer
    ? (bytes as ArrayBuffer)
    : ((bytes as Uint8Array).buffer as ArrayBuffer);
  const byteOffset = isArrayBuffer ? 0 : (bytes as Uint8Array).byteOffset;
  const byteLength = isArrayBuffer ? (bytes as ArrayBuffer).byteLength : (bytes as Uint8Array).byteLength;
  if (byteLength === 0 || byteLength % 4 !== 0) return null;
  return new Float32Array(buf, byteOffset, byteLength / 4);
}

/** Float32Array -> Uint8Array (for sqlite BLOB storage). */
export function embeddingToBlob(emb: Float32Array): Uint8Array {
  return new Uint8Array(emb.buffer.slice(emb.byteOffset, emb.byteOffset + emb.byteLength));
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}
