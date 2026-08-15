import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { readdirSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { SCHEMA } from './schema'
import { blobToEmbedding, cosine, embeddingToBlob } from './vec'
import type { FaceQuality } from '../ml/types'

/**
 * Lightweight migration for existing DBs: CREATE TABLE IF NOT EXISTS won't add
 * new columns to a table that already exists, so older databases (created
 * before face_quality columns) need ALTER TABLE. Idempotent + additive only.
 */
function migrate(db: Database.Database): void {
  const cols = new Set(
    (db.prepare(`PRAGMA table_info(faces)`).all() as Array<{ name: string }>).map((c) => c.name),
  )
  if (!cols.has('face_quality')) db.exec(`ALTER TABLE faces ADD COLUMN face_quality TEXT NOT NULL DEFAULT 'medium'`)
  if (!cols.has('low_quality')) db.exec(`ALTER TABLE faces ADD COLUMN low_quality INTEGER NOT NULL DEFAULT 0`)
  if (!cols.has('quality_score')) db.exec(`ALTER TABLE faces ADD COLUMN quality_score REAL NOT NULL DEFAULT 0.5`)
}

export const CLUSTER_MATCH_THRESHOLD = 0.5
export const SEARCH_MIN_SIM = 0.5

/**
 * A LOW-quality face may only JOIN an existing cluster when its similarity is
 * strongly above the normal linkage threshold — it must never seed a cluster on
 * its own (prevents tiny faces from creating over-split singletons).
 */
export const LOW_JOIN_SIM = 0.6

/**
 * Offline clustering (HAC average-linkage) cutoff — see clusterAllFaces.
 * PRODUCTION DEFAULT: 0.45 (benchmarked 2026-08 on LFW + psdkp crowded
 * photos — recall 0.960→0.975 vs 0.50 at only +0.05% false-merge risk).
 * Rollback to the old 0.50 by passing { clusterLinkageThreshold: 0.5 } in
 * StoreOptions, or by flipping this constant — the benchmark numbers for
 * both thresholds are preserved in desktop/data/debug/cluster-tune.json.
 */
export const CLUSTER_LINKAGE_THRESHOLD = 0.45

/**
 * When a face matches no existing cluster (sim < CLUSTER_MATCH_THRESHOLD to
 * every centroid), it seeds a NEW cluster whose centroid is that face. But if
 * the face matched a cluster with sim >= CLUSTER_MATCH_THRESHOLD while also
 * being closer to ANOTHER cluster, we merge into the closest one instead of
 * seeding a duplicate cluster (prevents the snowball over-split).
 */

export interface StoreOptions {
  /**
   * Cosine threshold for joining a face to an existing person cluster
   * (centroid similarity, see matchPerson). Tuned on LFW: intra-identity sim
   * is >= 0.62 while inter-identity is <= 0.14, so 0.5 sits safely in between
   * (0.3 over-merges — a 528-photo blob; 0.6 over-splits small clusters).
   *
   * NOTE: with offline HAC clustering (clusterAllFaces), this threshold is no
   * longer used at insert time — faces are stored unassigned and clustered in
   * one pass after the scan.
   */
  clusterThreshold?: number
  /**
   * Offline HAC clustering cutoff (see clusterAllFaces). Defaults to
   * CLUSTER_LINKAGE_THRESHOLD (0.45). Pass 0.5 to roll back to the
   * previously shipped behavior. LOW-quality faces additionally require
   * LOW_JOIN_SIM (0.6) to join an existing cluster.
   */
  clusterLinkageThreshold?: number
  /**
   * Thumbnail/crop directory (same one the scanner writes to). When set,
   * deletePhoto/deleteFolder/cleanupOrphans also unlink the matching thumb
   * files from disk — otherwise deleted rows leave orphan files behind.
   */
  thumbDir?: string
}

export interface AddPhotoInput {
  id?: string
  path: string
  width?: number | null
  height?: number | null
  thumbPath?: string | null
  contentHash?: string | null
}

export interface AddFaceInput {
  id?: string
  photoId: string
  x1: number
  y1: number
  x2: number
  y2: number
  /** Embedding can be NULL for very_low-quality faces (embedding skipped). */
  embedding: Float32Array | null
  /** Quality tier from the detector (high | medium | low | very_low). */
  faceQuality?: FaceQuality
  /** 0..1 continuous quality score. */
  qualityScore?: number
  /** true for very_low tier. */
  lowQuality?: boolean
}

export interface PersonSummary {
  personId: string
  name: string
  photoCount: number
  faceCount: number
}

export interface SearchHit {
  faceId: string
  photoId: string
  path: string
  thumbPath: string | null
  personId: string | null
  personName: string | null
  similarity: number
  /** Distinct persons matched by any query face in this photo. */
  matchedPersons: string[]
  /** Bounding box of the matched face (for the grid rectangle highlight). */
  faceBox: { x1: number; y1: number; x2: number; y2: number; width: number | null; height: number | null } | null
}

interface FaceCacheRow {
  faceId: string
  personId: string | null
  photoId: string
  embedding: Float32Array
}

/** Local SQLite store mirroring the backend schema + clustering behavior. */
export class PhotoStore {
  private db: Database.Database
  private facesCache: FaceCacheRow[] | null = null
  private personSeq = 0
  private readonly clusterLinkageThreshold: number
  private readonly thumbDir: string | null

  private constructor(db: Database.Database, options: StoreOptions = {}) {
    this.db = db
    this.clusterLinkageThreshold = options.clusterLinkageThreshold ?? CLUSTER_LINKAGE_THRESHOLD
    this.thumbDir = options.thumbDir ?? null
    this.personSeq = (this.db.prepare('SELECT COUNT(*) AS n FROM persons').get() as { n: number }).n
  }

  static open(dbPath: string, options: StoreOptions = {}): PhotoStore {
    const db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    db.exec(SCHEMA)
    migrate(db)
    return new PhotoStore(db, options)
  }

  close(): void {
    this.db.close()
  }

  // ---------------------------------------------------------------- folders

  addFolder(hostPath: string, name: string): string {
    const id = randomUUID()
    this.db
      .prepare(
        `INSERT INTO folders (id, host_path, name) VALUES (?, ?, ?)
         ON CONFLICT(host_path) DO UPDATE SET name = excluded.name`,
      )
      .run(id, hostPath, name)
    return id
  }

  listFolders(): Array<{ folderId: string; hostPath: string; name: string; lastScannedAt: string | null; photoCount: number }> {
    return this.db
      .prepare(
        `SELECT f.id AS folderId, f.host_path AS hostPath, f.name, f.last_scanned_at AS lastScannedAt,
                COUNT(p.id) AS photoCount
         FROM folders f LEFT JOIN photos p ON p.path LIKE f.host_path || '/%'
         GROUP BY f.id ORDER BY f.added_at DESC`,
      )
      .all() as Array<{ folderId: string; hostPath: string; name: string; lastScannedAt: string | null; photoCount: number }>
  }

  markFolderScanned(hostPath: string): void {
    this.db
      .prepare(`UPDATE folders SET last_scanned_at = datetime('now') WHERE host_path = ?`)
      .run(hostPath)
  }

  /** Delete a folder and every photo (cascade faces) under it. */
  deleteFolder(hostPath: string): number {
    const prefix = hostPath.replace(/\/+$/, '') + '/'
    const del = this.db.transaction(() => {
      // Collect thumb + face-crop files BEFORE deleting rows so we can unlink
      // them after (faces cascade-delete with the photos).
      const thumbs = (this.db.prepare(`SELECT thumb_path FROM photos WHERE path LIKE ?`).all(prefix + '%') as Array<{ thumb_path: string | null }>)
        .map((r) => r.thumb_path)
        .filter((t): t is string => !!t)
      const faceIds = (this.db
        .prepare(
          `SELECT f.id AS faceId FROM faces f JOIN photos p ON p.id = f.photo_id WHERE p.path LIKE ?`,
        )
        .all(prefix + '%') as Array<{ faceId: string }>)
        .map((r) => r.faceId)
      const info = this.db.prepare(`DELETE FROM photos WHERE path LIKE ?`).run(prefix + '%')
      this.db.prepare(`DELETE FROM folders WHERE host_path = ?`).run(hostPath)
      for (const t of thumbs) this.unlinkThumb(t)
      if (this.thumbDir) {
        for (const faceId of faceIds) this.unlinkThumb(path.join(this.thumbDir, `${faceId}.jpg`))
      }
      return info.changes
    })
    const n = del()
    this.invalidate()
    return n
  }

  // ----------------------------------------------------------------- photos

  /** Insert a photo; returns false when the path already exists (skip). */
  addPhoto(photo: AddPhotoInput): boolean {
    const exists = this.db.prepare(`SELECT 1 FROM photos WHERE path = ?`).get(photo.path)
    if (exists) return false
    this.db
      .prepare(
        `INSERT INTO photos (id, path, width, height, thumb_path, content_hash)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(photo.id ?? randomUUID(), photo.path, photo.width ?? null, photo.height ?? null, photo.thumbPath ?? null, photo.contentHash ?? null)
    return true
  }

  hasPhotoPath(path: string): boolean {
    return !!this.db.prepare(`SELECT 1 FROM photos WHERE path = ?`).get(path)
  }

  hasPhotoHash(hash: string): boolean {
    return !!this.db.prepare(`SELECT 1 FROM photos WHERE content_hash = ?`).get(hash)
  }

  getPhoto(photoId: string): { photoId: string; path: string; thumbPath: string | null; width: number | null; height: number | null } | null {
    const row = this.db
      .prepare(`SELECT id AS photoId, path, thumb_path AS thumbPath, width, height FROM photos WHERE id = ?`)
      .get(photoId) as { photoId: string; path: string; thumbPath: string | null; width: number | null; height: number | null } | undefined
    return row ?? null
  }

  deletePhoto(photoId: string): void {
    const row = this.db.prepare(`SELECT thumb_path AS thumbPath FROM photos WHERE id = ?`).get(photoId) as { thumbPath: string | null } | undefined
    // Also unlink this photo's face crop files (named <faceId>.jpg).
    const faceIds = (this.db.prepare(`SELECT id FROM faces WHERE photo_id = ?`).all(photoId) as Array<{ id: string }>).map((r) => r.id)
    this.db.prepare(`DELETE FROM photos WHERE id = ?`).run(photoId)
    if (row?.thumbPath) this.unlinkThumb(row.thumbPath)
    if (this.thumbDir) {
      for (const faceId of faceIds) this.unlinkThumb(path.join(this.thumbDir, `${faceId}.jpg`))
    }
    this.invalidate()
  }

  /**
   * Remove orphaned state left behind by deletes/edits:
   *  - person rows with no faces (abandoned after photos/faces are deleted)
   *  - thumbnail/crop files in thumbDir that no longer match any photo or face
   * Returns how many thumb files were removed.
   */
  cleanupOrphans(): number {
    // Persons with zero faces are invisible to the UI already, but they
    // accumulate — delete them.
    this.db
      .prepare(
        `DELETE FROM persons WHERE id NOT IN (SELECT DISTINCT person_id FROM faces WHERE person_id IS NOT NULL)`,
      )
      .run()
    this.invalidate()

    if (!this.thumbDir) return 0
    let removed = 0
    const validIds = new Set<string>()
    for (const r of this.db.prepare(`SELECT thumb_path FROM photos WHERE thumb_path IS NOT NULL`).all() as Array<{ thumb_path: string }>) {
      validIds.add(path.basename(r.thumb_path).replace(/\.jpg$/, ''))
    }
    for (const r of this.db.prepare(`SELECT id FROM faces`).all() as Array<{ id: string }>) {
      validIds.add(r.id)
    }
    let entries
    try {
      entries = readdirSync(this.thumbDir)
    } catch {
      return 0 // dir missing — nothing to clean
    }
    for (const name of entries) {
      if (!/^[0-9a-f-]{36}\.jpg$/.test(name)) continue // only our UUID-named files
      const id = name.replace(/\.jpg$/, '')
      if (validIds.has(id)) continue
      try {
        unlinkSync(path.join(this.thumbDir, name))
        removed += 1
      } catch {
        // best-effort
      }
    }
    return removed
  }

  /** Best-effort unlink of a stored thumb path (photo thumb or face crop). */
  private unlinkThumb(thumbPath: string): void {
    try {
      unlinkSync(thumbPath)
    } catch {
      // already gone / not on disk — fine
    }
  }

  /** Indexed photos under a folder (for the rescan removal diff). */
  listFolderPhotos(hostPath: string): Array<{ photoId: string; path: string; thumbPath: string | null }> {
    const prefix = hostPath.replace(/\/+$/, '') + '/'
    return this.db
      .prepare(`SELECT id AS photoId, path, thumb_path AS thumbPath FROM photos WHERE path LIKE ?`)
      .all(prefix + '%') as Array<{ photoId: string; path: string; thumbPath: string | null }>
  }

  listPhotos(folderPath?: string, limit = 500, offset = 0): unknown[] {
    const where = folderPath ? `WHERE p.path LIKE ?` : ''
    const params: unknown[] = folderPath ? [folderPath.replace(/\/+$/, '') + '/%', limit, offset] : [limit, offset]
    return this.db
      .prepare(
        `SELECT p.id AS photoId, p.path, p.thumb_path AS thumbPath, p.width, p.height,
                COUNT(DISTINCT f.id) AS facesDetected
         FROM photos p LEFT JOIN faces f ON f.photo_id = p.id
         ${where}
         GROUP BY p.id ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...params)
  }

  /** Photos belonging to one person (via its faces), newest first. */
  listPhotosForPerson(personId: string, limit = 500): Array<{ photoId: string; path: string; thumbPath: string | null; width: number | null; height: number | null }> {
    return this.db
      .prepare(
        `SELECT DISTINCT p.id AS photoId, p.path, p.thumb_path AS thumbPath, p.width, p.height
         FROM faces f
         JOIN photos p ON p.id = f.photo_id
         WHERE f.person_id = ?
         ORDER BY p.created_at DESC LIMIT ?`,
      )
      .all(personId, limit) as Array<{ photoId: string; path: string; thumbPath: string | null; width: number | null; height: number | null }>
  }

  /** Photos that were scanned but have NO detected faces (landscape, docs, blank…). */
  listPhotosNoFaces(limit = 500): Array<{ photoId: string; path: string; thumbPath: string | null; width: number | null; height: number | null }> {
    return this.db
      .prepare(
        `SELECT p.id AS photoId, p.path, p.thumb_path AS thumbPath, p.width, p.height
         FROM photos p
         LEFT JOIN faces f ON f.photo_id = p.id
         WHERE f.id IS NULL
         ORDER BY p.created_at DESC LIMIT ?`,
      )
      .all(limit) as Array<{ photoId: string; path: string; thumbPath: string | null; width: number | null; height: number | null }>
  }

  /** Count of photos with no detected faces (for the sidebar badge). */
  countPhotosNoFaces(): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM photos p LEFT JOIN faces f ON f.photo_id = p.id WHERE f.id IS NULL`,
      )
      .get() as { n: number }
    return row.n
  }

  /**
   * Face preview data for each person: one representative face + its photo path.
   * Uses the MEDIAN rowid face (middle of the cluster's insertion order) so the
   * preview isn't a random early crop — it's a stable, central sample.
   */
  listPersonPreviews(ids: string[]): Array<{ personId: string; faceId: string; photoPath: string | null }> {
    if (ids.length === 0) return []
    const placeholders = ids.map(() => '?').join(',')
    // Pick the median-rowid face per person: rank faces by rowid, take the one
    // at the middle. Deterministic + central (not the first or last crop).
    return this.db
      .prepare(
        `WITH ranked AS (
           SELECT person_id, id, photo_id, ROW_NUMBER() OVER (PARTITION BY person_id ORDER BY rowid) AS rn,
                  COUNT(*) OVER (PARTITION BY person_id) AS cnt
           FROM faces
         )
         SELECT pr.id AS personId, r.id AS faceId, p.path AS photoPath
         FROM persons pr
         JOIN ranked r ON r.person_id = pr.id AND r.rn = (r.cnt + 1) / 2
         JOIN photos p ON p.id = r.photo_id
         WHERE pr.id IN (${placeholders})`,
      )
      .all(...ids) as Array<{ personId: string; faceId: string; photoPath: string | null }>
  }

  // ------------------------------------------- faces + clustering (offline HAC)

  /**
   * Insert a face with NO person assignment — clustering happens offline via
   * clusterAllFaces after the scan completes (order-independent, no snowball
   * over-split). Kept for compatibility with scan-test/cluster-test callers.
   */
  addFaceWithCluster(face: AddFaceInput): { faceId: string; personId: string | null; isNewPerson: boolean } {
    const run = this.db.transaction(() => {
      const faceId = face.id ?? randomUUID()
      this.db
        .prepare(
          `INSERT INTO faces (id, photo_id, person_id, x1, y1, x2, y2, embedding, face_quality, low_quality, quality_score)
           VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(faceId, face.photoId, face.x1, face.y1, face.x2, face.y2, face.embedding ? embeddingToBlob(face.embedding) : null, face.faceQuality ?? 'medium', face.lowQuality ? 1 : 0, face.qualityScore ?? 0.5)
      return { faceId, personId: null, isNewPerson: true }
    })
    const result = run()
    this.invalidate()
    return result
  }

  /**
   * Insert a photo and all of its faces in ONE transaction (no orphan photo
   * or person on partial failure). Faces are inserted unassigned; run
   * clusterAllFaces() after the scan to assign persons.
   */
  addPhotoWithFaces(photo: AddPhotoInput, faces: AddFaceInput[]): Array<{ faceId: string; personId: string | null; isNewPerson: boolean }> | null {
    const run = this.db.transaction(() => {
      if (!this.addPhoto(photo)) return null
      return faces.map((f) => {
        const faceId = f.id ?? randomUUID()
        this.db
          .prepare(
            `INSERT INTO faces (id, photo_id, person_id, x1, y1, x2, y2, embedding, face_quality, low_quality, quality_score)
             VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(faceId, f.photoId, f.x1, f.y1, f.x2, f.y2, f.embedding ? embeddingToBlob(f.embedding) : null, f.faceQuality ?? 'medium', f.lowQuality ? 1 : 0, f.qualityScore ?? 0.5)
        return { faceId, personId: null, isNewPerson: true }
      })
    })
    const result = run()
    this.invalidate()
    return result
  }

  /**
   * Re-cluster ALL faces offline with TRUE average-linkage HAC.
   * Replaces the old greedy single-pass matcher, which was order-dependent and
   * could snowball: once two different identities merged (via a moderate
   * pairwise sim), their blended centroid drifted and kept absorbing nearby
   * faces without ever being re-checked.
   *
   * Here every merge is a genuine average-linkage step:
   *   1. Each face starts as its own cluster (centroid = the face).
   *   2. Iteratively merge the TWO clusters whose CENTROIDS are most similar,
   *      as long as that similarity >= threshold. After each merge the new
   *      centroid is RECOMPUTED (mean direction, re-L2-normalized), so later
   *      merges are judged against the true cluster average — a single
   *      lookalike bridge can no longer drag an unrelated face in.
   *   3. Stop when the best remaining centroid sim < threshold.
   *   4. Re-create persons from the final clusters.
   *
   * O(m^2) memory for the pairwise sim matrix (m = embeddable faces) and
   * O(m^3) worst-case linkage passes, which is fine for the offline re-cluster
   * of a personal library. Returns the number of person clusters created.
   */
  clusterAllFaces(threshold = this.clusterLinkageThreshold): number {
    const rows = this.db
      .prepare(
        `SELECT id AS faceId, photo_id AS photoId, embedding, face_quality AS faceQuality, low_quality AS lowQuality
         FROM faces`,
      )
      .all() as Array<{ faceId: string; photoId: string; embedding: Buffer | null; faceQuality: string; lowQuality: number }>
    if (rows.length === 0) return 0

    // VERY_LOW faces (below embedding threshold) have NULL embedding and never
    // participate in clustering — they are still detections (shown in UI), but
    // must not create or join clusters. LOW faces participate only via strong
    // joins (see matchQuality below), never as cluster anchors.
    const n = rows.length
    const emb = rows.map((r) => (r.embedding ? blobToEmbedding(r.embedding) : null))
    const q = rows.map((r) => r.faceQuality as FaceQuality)
    const hasEmb = emb.map((e) => e !== null)
    const idxOf = new Map<string, number>()
    const embedIdx: number[] = []
    for (let i = 0; i < n; i++) {
      idxOf.set(rows[i].faceId, i)
      if (hasEmb[i]) embedIdx.push(i)
    }
    if (embedIdx.length === 0) return 0

    const m = embedIdx.length
    // Each embeddable face starts as its own cluster. `parent` maps a face index
    // to its current cluster root; when clusters merge we point one root at the
    // other (union-find style) and recompute the surviving root's centroid.
    const parent = Array.from({ length: m }, (_, i) => i)
    const find = (x: number): number => {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]]
        x = parent[x]
      }
      return x
    }
    const centroid = embedIdx.map((i) => emb[i] as Float32Array)
    const clusterSize = new Array<number>(m).fill(1)
    // Whether a cluster's root face is LOW/very_low quality. A cluster seeded by
    // a LOW face can never anchor a merge (it may only be absorbed).
    const clusterLow = embedIdx.map((i) => q[embedIdx[i]] === 'low' || q[embedIdx[i]] === 'very_low')

    // Tier join rule: a cluster may merge only if its anchor is high/medium
    // quality. A LOW-quality face (blurry/weak) never anchors a merge on its
    // own — it may only JOIN an existing high/medium cluster when the
    // similarity is strong (>= lowJoinSim). This stops tiny/blurry faces from
    // seeding their own cluster or dragging others into a phantom person.
    const canJoin = (ia: number, ib: number, s: number): boolean => {
      // A cluster's anchor quality = the quality of its single member (root
      // face). Multi-member clusters always have an anchor that was high/medium
      // at merge time, so only singleton roots need the check here.
      const qa = q[embedIdx[ia]]
      const qb = q[embedIdx[ib]]
      const aIsLow = qa === 'low' || qa === 'very_low'
      const bIsLow = qb === 'low' || qb === 'very_low'
      // LOW is allowed to join a HIGH/MEDIUM face (strong sim required).
      if (aIsLow && !bIsLow) return s >= LOW_JOIN_SIM
      if (bIsLow && !aIsLow) return s >= LOW_JOIN_SIM
      // LOW-LOW can never merge (two blurry faces are not evidence of a person).
      if (aIsLow && bIsLow) return false
      return true
    }

    // Pairwise sims between ALL faces. Clusters with 2+ members are never
    // compared pair-wise again: once merged, they can only be reached through
    // their recomputed centroid. That is what makes the linkage true average
    // (centroid) linkage instead of a single-linkage bridge chain.
    const sims: Float32Array = new Float32Array(m * m)
    const setSim = (i: number, j: number, s: number) => { sims[i * m + j] = s; sims[j * m + i] = s }
    for (let i = 0; i < m; i++) {
      for (let j = i + 1; j < m; j++) {
        setSim(i, j, cosine(emb[embedIdx[i]] as Float32Array, emb[embedIdx[j]] as Float32Array))
      }
    }

    // True average-linkage HAC: repeatedly merge the two clusters with the
    // highest centroid similarity, stopping when even the best is below
    // threshold. After each merge the surviving centroid is recomputed, so
    // downstream decisions always compare against the cluster average rather
    // than a drifting blend (the old snowball failure mode).
    const nClusters = m
    for (;;) {
      let bestI = -1
      let bestJ = -1
      let bestS = threshold
      // Find the best pair among cluster ROOTS (skip pairs inside one cluster).
      // bestS starts at `threshold`, so only merges >= threshold are considered.
      for (let i = 0; i < nClusters; i++) {
        const ri = find(i)
        for (let j = i + 1; j < nClusters; j++) {
          const rj = find(j)
          if (rj === ri) continue
          const s = sims[ri * m + rj]
          if (s > bestS) { bestS = s; bestI = ri; bestJ = rj }
        }
      }
      if (bestI < 0) break // no pair reaches the threshold — done
      // Quality-aware merge gate: apply canJoin whenever a singleton LOW face is
      // involved OR a LOW-seeded cluster would anchor a merge. LOW faces may join
      // a real person (strong sim) but never seed or anchor a merge themselves.
      const lowI = clusterLow[bestI]
      const lowJ = clusterLow[bestJ]
      const needGate = (clusterSize[bestI] === 1 && clusterSize[bestJ] === 1)
        || lowI || lowJ
      if (needGate && !canJoin(bestI, bestJ, bestS)) {
        // Block this specific pair but keep looking for other merges: mark it
        // below threshold by re-scanning without it is expensive, so instead we
        // simply lower it to threshold (never chosen again) and continue.
        sims[bestI * m + bestJ] = threshold
        sims[bestJ * m + bestI] = threshold
        continue
      }
      // Merge: smaller cluster points into larger; recompute the survivor's
      // centroid (mean direction, re-L2-normalized).
      if (clusterSize[bestI] >= clusterSize[bestJ]) {
        this.mergeClusters(bestI, bestJ, parent, centroid, clusterSize)
        // Survivor is low if either side was low (a low face can't be hidden by
        // being absorbed — the merged cluster still can't anchor a new merge).
        clusterLow[bestI] = lowI || lowJ
      } else {
        this.mergeClusters(bestJ, bestI, parent, centroid, clusterSize)
        clusterLow[bestJ] = lowI || lowJ
      }
    }

    // Build final clusters: root -> member face indices (map back to full rows).
    const clusters = new Map<number, number[]>()
    for (let i = 0; i < m; i++) {
      const r = find(i)
      if (!clusters.has(r)) clusters.set(r, [])
      clusters.get(r)!.push(embedIdx[i])
    }

    // Replace persons wholesale: unassign all faces, drop all persons, re-create
    // from clusters. (UPDATE not DELETE — faces stay; only the person link resets.)
    // Custom names (anything not the auto-generated "Person N") are preserved
    // across re-cluster by re-applying them to the cluster that contains the
    // renamed face — so a startup re-cluster never wipes user renames.
    const run = this.db.transaction(() => {
      // 1. Capture user-renamed persons: faceId -> custom name (skip default).
      const named = new Map<string, string>()
      const namedRows = this.db
        .prepare(
          `SELECT p.name AS name, f.id AS faceId
           FROM persons p JOIN faces f ON f.person_id = p.id
           WHERE p.name NOT LIKE 'Person %'`,
        )
        .all() as Array<{ name: string; faceId: string }>
      for (const r of namedRows) named.set(r.faceId, r.name)

      this.db.prepare(`UPDATE faces SET person_id = NULL`).run()
      this.db.prepare(`DELETE FROM persons`).run()
      this.personSeq = 0
      const created: string[] = []
      for (const members of clusters.values()) {
        const c = new Float32Array(512)
        for (const m of members) {
          const e = emb[m] as Float32Array
          for (let k = 0; k < 512; k++) c[k] += e[k]
        }
        for (let k = 0; k < 512; k++) c[k] /= members.length
        // Prefer a preserved custom name if any member was user-renamed.
        const custom = members.map((m) => named.get(rows[m].faceId)).find(Boolean)
        const personId = randomUUID()
        this.personSeq += 1
        this.db
          .prepare(`INSERT INTO persons (id, name, centroid) VALUES (?, ?, ?)`)
          .run(personId, custom ?? `Person ${this.personSeq}`, embeddingToBlob(c))
        created.push(personId)
        for (const m of members) {
          this.db
            .prepare(`UPDATE faces SET person_id = ? WHERE id = ?`)
            .run(personId, rows[m].faceId)
        }
      }
      return created.length
    })
    const count = run()
    this.invalidate()
    return count
  }

  /**
   * Average-linkage merge: point cluster `x` (smaller) into `y` (larger) and
   * recompute `y`'s centroid as the SIZE-WEIGHTED mean direction, then
   * re-L2-normalize it so it stays unit-length (embeddings are L2-normalized,
   * and cosine comparisons in the HAC loop assume unit vectors).
   */
  private mergeClusters(
    y: number,
    x: number,
    parent: number[],
    centroid: (Float32Array | null)[],
    clusterSize: number[],
  ): void {
    const rootOf = (i: number): number => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]]
        i = parent[i]
      }
      return i
    }
    const ry = rootOf(y)
    const rx = rootOf(x)
    if (ry === rx) return
    parent[rx] = ry
    const cy = centroid[ry]
    const cx = centroid[rx]
    if (cy && cx) {
      const ny = clusterSize[ry]
      const nx = clusterSize[rx]
      const out = new Float32Array(512)
      for (let k = 0; k < 512; k++) out[k] = (cy[k] * ny + cx[k] * nx) / (ny + nx)
      // Re-normalize the mean so it remains a unit direction vector.
      let norm = 0
      for (let k = 0; k < 512; k++) norm += out[k] * out[k]
      norm = Math.sqrt(norm)
      if (norm > 0) {
        for (let k = 0; k < 512; k++) out[k] /= norm
      }
      centroid[ry] = out
      clusterSize[ry] = ny + nx
    }
  }

  /**
   * Person summaries, newest-first. Noise clusters (persons that appear in a
   * single photo with a single face — usually background guests or detection
   * artifacts) are hidden unless includeNoise is set. They stay in the DB;
   * hiding them keeps the face filter from cluttering with one-off "Person N".
   */
  listPersons(includeNoise = false): PersonSummary[] {
    return this.db
      .prepare(
        `WITH sizes AS (
           SELECT p.id, p.name, p.created_at,
                  COUNT(DISTINCT f.photo_id) AS photoCount,
                  COUNT(f.id) AS faceCount
           FROM persons p LEFT JOIN faces f ON f.person_id = p.id
           GROUP BY p.id
         )
         SELECT id AS personId, name, photoCount, faceCount
         FROM sizes
         WHERE faceCount > 0
           AND (${includeNoise ? '1=1' : `faceCount >= 2 OR photoCount >= 2`})
         ORDER BY photoCount DESC, created_at ASC`,
      )
      .all() as PersonSummary[]
  }

  renamePerson(personId: string, name: string): void {
    this.db.prepare(`UPDATE persons SET name = ?, updated_at = datetime('now') WHERE id = ?`).run(name, personId)
  }

  deletePerson(personId: string): void {
    this.db.prepare(`UPDATE faces SET person_id = NULL WHERE person_id = ?`).run(personId)
    this.db.prepare(`DELETE FROM persons WHERE id = ?`).run(personId)
    this.invalidate()
  }

  // ----------------------------------------------------------------- search

  /**
   * Multi-face cosine search.
   *
   * Accepts ONE or MORE query embeddings (all faces in a query photo) and
   * returns per-PHOTO results (deduped), ranked by the best (max) similarity
   * across all query faces. Each hit carries the matched person for that face
   * plus every distinct person matched in the photo.
   *
   * @param embeddings   one or more normalized query face embeddings
   * @param limit        max photos to return
   * @param minSim       per-face similarity cutoff
   */
  searchFaces(embeddings: Float32Array | Float32Array[], limit = 10, minSim = SEARCH_MIN_SIM): SearchHit[] {
    const queries = Array.isArray(embeddings) ? embeddings : [embeddings]
    if (queries.length === 0) return []
    const faces = this.loadFacesCache()

    // photoId -> best sim across all query faces (photo-level ranking)
    const bestByPhoto = new Map<string, number>()
    // photoId -> best (faceId, sim, personId, personName) for the top sim
    const bestHitByPhoto = new Map<string, SearchHit>()
    // photoId -> set of distinct person names matched by ANY query face
    const personsByPhoto = new Map<string, Set<string>>()

    const getPhoto = this.db.prepare(`SELECT id AS photoId, path, thumb_path AS thumbPath FROM photos WHERE id = ?`)
    const getPerson = this.db.prepare(`SELECT id AS personId, name FROM persons WHERE id = ?`)
    const getFaceBox = this.db.prepare(
      `SELECT f.x1, f.y1, f.x2, f.y2, p.width, p.height
       FROM faces f JOIN photos p ON p.id = f.photo_id
       WHERE f.id = ?`,
    )

    for (const query of queries) {
      for (const face of faces) {
        const sim = cosine(query, face.embedding)
        if (sim < minSim) continue

        if (!personsByPhoto.has(face.photoId)) personsByPhoto.set(face.photoId, new Set())
        if (face.personId) {
          const person = getPerson.get(face.personId) as { personId: string; name: string } | undefined
          if (person) personsByPhoto.get(face.photoId)!.add(person.name)
        }

        const prev = bestByPhoto.get(face.photoId) ?? -1
        if (sim <= prev) continue
        bestByPhoto.set(face.photoId, sim)
        const photo = getPhoto.get(face.photoId) as { photoId: string; path: string; thumbPath: string | null }
        const person = face.personId ? (getPerson.get(face.personId) as { personId: string; name: string } | undefined) : undefined
        const box = getFaceBox.get(face.faceId) as { x1: number; y1: number; x2: number; y2: number; width: number | null; height: number | null } | undefined
        bestHitByPhoto.set(face.photoId, {
          faceId: face.faceId,
          photoId: face.photoId,
          path: photo.path,
          thumbPath: photo.thumbPath,
          personId: person?.personId ?? null,
          personName: person?.name ?? null,
          similarity: sim,
          matchedPersons: [] as string[], // filled below
          faceBox: box ? { x1: box.x1, y1: box.y1, x2: box.x2, y2: box.y2, width: box.width, height: box.height } : null,
        })
      }
    }

    const top = [...bestHitByPhoto.values()]
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit)

    // Attach the full matched-persons list per photo
    for (const hit of top) {
      hit.matchedPersons = [...(personsByPhoto.get(hit.photoId) ?? new Set())]
    }
    return top
  }

  /** Per-face photo -> person assignment, ordered by photo path (parity dumps). */
  personAssignments(): Array<{ path: string; personName: string }> {
    return this.db
      .prepare(
        `SELECT p.path, per.name AS personName
         FROM faces f
         JOIN photos p ON p.id = f.photo_id
         JOIN persons per ON per.id = f.person_id
         ORDER BY p.path`,
      )
      .all() as Array<{ path: string; personName: string }>
  }

  /** Face embeddings detected in a specific photo (in insertion order). */
  facesForPhoto(photoId: string): Float32Array[] {
    const rows = this.db
      .prepare(`SELECT embedding FROM faces WHERE photo_id = ? ORDER BY created_at`)
      .all(photoId) as Array<{ embedding: Buffer }>
    return rows.map((r) => blobToEmbedding(r.embedding))
  }

  /** Face boxes + person labels for a photo, for the detail-view overlay. */
  facesForPhotoView(photoId: string): Array<{ faceId: string; x1: number; y1: number; x2: number; y2: number; personId: string | null; personName: string | null }> {
    return this.db
      .prepare(
        `SELECT f.id AS faceId, f.x1, f.y1, f.x2, f.y2, f.person_id AS personId, per.name AS personName
         FROM faces f
         LEFT JOIN persons per ON per.id = f.person_id
         WHERE f.photo_id = ?
         ORDER BY f.created_at`,
      )
      .all(photoId) as Array<{ faceId: string; x1: number; y1: number; x2: number; y2: number; personId: string | null; personName: string | null }>
  }

  /** Distinct photo paths belonging to one person's faces. */
  photosForPerson(personId: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT p.path FROM faces f JOIN photos p ON p.id = f.photo_id WHERE f.person_id = ?`,
      )
      .all(personId) as Array<{ path: string }>
    return rows.map((r) => r.path)
  }

  /** Face embeddings for one person (for cluster-quality checks). */
  faceEmbeddingsForPerson(personId: string, limit = 50): Float32Array[] {
    const rows = this.db
      .prepare(`SELECT embedding FROM faces WHERE person_id = ? LIMIT ?`)
      .all(personId, limit) as Array<{ embedding: Buffer }>
    return rows.map((r) => blobToEmbedding(r.embedding))
  }

  stats(): { photos: number; faces: number; persons: number; folders: number } {
    const one = (sql: string) => (this.db.prepare(sql).get() as { n: number }).n
    return {
      photos: one('SELECT COUNT(*) AS n FROM photos'),
      faces: one('SELECT COUNT(*) AS n FROM faces'),
      persons: one('SELECT COUNT(*) AS n FROM persons'),
      folders: one('SELECT COUNT(*) AS n FROM folders'),
    }
  }

  // ---------------------------------------------------------------- caching

  private loadFacesCache(): FaceCacheRow[] {
    if (this.facesCache) return this.facesCache
    const rows = this.db
      .prepare(`SELECT id AS faceId, photo_id AS photoId, person_id AS personId, embedding FROM faces`)
      .all() as Array<{ faceId: string; photoId: string; personId: string | null; embedding: Buffer }>
    this.facesCache = rows.map((r) => ({ faceId: r.faceId, photoId: r.photoId, personId: r.personId, embedding: blobToEmbedding(r.embedding) }))
    return this.facesCache
  }

  private invalidate(): void {
    this.facesCache = null
  }
}
