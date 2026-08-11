"use strict";
/** Embedding serialization + cosine helpers for the local store. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EMBEDDING_BYTES = exports.EMBEDDING_DIM = void 0;
exports.embeddingToBlob = embeddingToBlob;
exports.blobToEmbedding = blobToEmbedding;
exports.cosine = cosine;
exports.EMBEDDING_DIM = 512;
exports.EMBEDDING_BYTES = exports.EMBEDDING_DIM * 4;
function embeddingToBlob(emb) {
    return Buffer.from(emb.buffer, emb.byteOffset, emb.byteLength);
}
function blobToEmbedding(buf) {
    const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}
function cosine(a, b) {
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
