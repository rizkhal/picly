// Embedding vector helpers for the mobile store — mirrors desktop
// packages/desktop/src/main/db/vec.ts but without Buffer (not a global in RN).

export const EMBEDDING_DIM = 512;

/** Uint8Array (as stored in sqlite BLOB) -> Float32Array view. */
export function blobToEmbedding(bytes: Uint8Array): Float32Array {
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
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
