// Offline clustering — TRUE average-linkage HAC, ported 1:1 from the desktop
// store (packages/desktop/src/main/db/store.ts -> clusterAllFaces). The desktop version
// is the frozen, benchmarked production pipeline (CLUSTER_LINKAGE_THRESHOLD =
// 0.45, LOW_JOIN_SIM = 0.6, quality-aware gates) — mobile must behave the same.
//
// This module is pure (no sqlite): the scan loop calls clusterFaces() with the
// scanned faces and writes the resulting person assignment back to the DB.

import type { FaceQuality } from 'picly-ml';
import { cosine, EMBEDDING_DIM } from '../utils/vec';

export interface ClusterFace {
  id: string;
  embedding: Float32Array | null; // null for very_low (never clustered)
  quality: FaceQuality;
}

export interface PersonCluster {
  id: string;
  name: string;
  faceIds: string[];
  centroid: Float32Array;
}

/** Mirrors desktop LOW_JOIN_SIM — a LOW face may only join a strong cluster. */
export const LOW_JOIN_SIM = 0.6;

/** HAC average-linkage cutoff. Production default 0.45 (tuned 2026-08). */
export const CLUSTER_LINKAGE_THRESHOLD = 0.45;

/**
 * Average-linkage HAC over the given faces.
 *
 *   1. Every embeddable face starts as its own cluster.
 *   2. Repeatedly merge the two clusters whose CENTROIDS are most similar while
 *      sim >= threshold; after each merge the survivor centroid is recomputed
 *      as the size-weighted mean direction, re-L2-normalized.
 *   3. Stop when the best centroid sim < threshold.
 *
 * Quality-aware gates (same as desktop):
 *   - faces with null embedding (very_low) never participate;
 *   - a LOW-quality face may only JOIN an existing high/medium cluster when
 *     sim >= LOW_JOIN_SIM, and can never seed or anchor a merge by itself.
 */
export function clusterFaces(
  faces: ClusterFace[],
  threshold = CLUSTER_LINKAGE_THRESHOLD,
): PersonCluster[] {
  if (faces.length === 0) return [];

  // Only embeddable faces join the pool.
  const embedIdx: number[] = [];
  for (let i = 0; i < faces.length; i++) {
    if (faces[i].embedding) embedIdx.push(i);
  }
  const m = embedIdx.length;
  if (m === 0) return [];

  const parent = Array.from({ length: m }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };

  const emb = embedIdx.map((i) => faces[i].embedding as Float32Array);
  const centroid = emb.map((e) => new Float32Array(e));
  const clusterSize = new Array<number>(m).fill(1);
  const clusterLow = embedIdx.map((i) => {
    const q = faces[i].quality;
    return q === 'low' || q === 'very_low';
  });

  const canJoin = (ia: number, ib: number, s: number): boolean => {
    const qa = faces[embedIdx[ia]].quality;
    const qb = faces[embedIdx[ib]].quality;
    const aIsLow = qa === 'low' || qa === 'very_low';
    const bIsLow = qb === 'low' || qb === 'very_low';
    if (aIsLow && !bIsLow) return s >= LOW_JOIN_SIM;
    if (bIsLow && !aIsLow) return s >= LOW_JOIN_SIM;
    if (aIsLow && bIsLow) return false;
    return true;
  };

  const sims: Float32Array = new Float32Array(m * m);
  const setSim = (i: number, j: number, s: number) => {
    sims[i * m + j] = s;
    sims[j * m + i] = s;
  };
  for (let i = 0; i < m; i++) {
    for (let j = i + 1; j < m; j++) {
      setSim(i, j, cosine(emb[i], emb[j]));
    }
  }

  const nClusters = m;
  for (;;) {
    let bestI = -1;
    let bestJ = -1;
    let bestS = threshold;
    for (let i = 0; i < nClusters; i++) {
      const ri = find(i);
      for (let j = i + 1; j < nClusters; j++) {
        const rj = find(j);
        if (rj === ri) continue;
        const s = sims[ri * m + rj];
        if (s > bestS) {
          bestS = s;
          bestI = ri;
          bestJ = rj;
        }
      }
    }
    if (bestI < 0) break;
    const lowI = clusterLow[bestI];
    const lowJ = clusterLow[bestJ];
    const needGate =
      (clusterSize[bestI] === 1 && clusterSize[bestJ] === 1) || lowI || lowJ;
    if (needGate && !canJoin(bestI, bestJ, bestS)) {
      sims[bestI * m + bestJ] = threshold;
      sims[bestJ * m + bestI] = threshold;
      continue;
    }
    // Merge: larger survives; recompute size-weighted mean, re-L2-normalize.
    if (clusterSize[bestI] >= clusterSize[bestJ]) {
      mergeClusters(bestI, bestJ, parent, centroid, clusterSize);
      clusterLow[bestI] = lowI || lowJ;
    } else {
      mergeClusters(bestJ, bestI, parent, centroid, clusterSize);
      clusterLow[bestJ] = lowI || lowJ;
    }
  }

  // Build final clusters: root -> member face indices.
  const clusters = new Map<number, number[]>();
  for (let i = 0; i < m; i++) {
    const r = find(i);
    const list = clusters.get(r);
    if (list) list.push(embedIdx[i]);
    else clusters.set(r, [embedIdx[i]]);
  }

  const result: PersonCluster[] = [];
  let seq = 0;
  for (const members of clusters.values()) {
    const c = new Float32Array(EMBEDDING_DIM);
    for (const mi of members) {
      const e = emb[mi];
      for (let k = 0; k < EMBEDDING_DIM; k++) c[k] += e[k];
    }
    for (let k = 0; k < EMBEDDING_DIM; k++) c[k] /= members.length;
    let norm = 0;
    for (let k = 0; k < EMBEDDING_DIM; k++) norm += c[k] * c[k];
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let k = 0; k < EMBEDDING_DIM; k++) c[k] /= norm;
    }
    seq += 1;
    result.push({
      id: `p-${seq}-${Date.now().toString(36)}`,
      name: `Person ${seq}`,
      faceIds: members.map((mi) => faces[embedIdx[mi]].id),
      centroid: c,
    });
  }
  return result;
}

function mergeClusters(
  y: number,
  x: number,
  parent: number[],
  centroid: Float32Array[],
  clusterSize: number[],
): void {
  const rootOf = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const ry = rootOf(y);
  const rx = rootOf(x);
  if (ry === rx) return;
  parent[rx] = ry;
  const cy = centroid[ry];
  const cx = centroid[rx];
  const ny = clusterSize[ry];
  const nx = clusterSize[rx];
  const out = new Float32Array(EMBEDDING_DIM);
  for (let k = 0; k < EMBEDDING_DIM; k++) out[k] = (cy[k] * ny + cx[k] * nx) / (ny + nx);
  let norm = 0;
  for (let k = 0; k < EMBEDDING_DIM; k++) norm += out[k] * out[k];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let k = 0; k < EMBEDDING_DIM; k++) out[k] /= norm;
  }
  centroid[ry] = out;
  clusterSize[ry] = ny + nx;
}
