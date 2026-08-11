import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { SCHEMA } from './schema'
import { blobToEmbedding, cosine, embeddingToBlob } from './vec'

export const CLUSTER_MATCH_THRESHOLD = 0.5
export const SEARCH_MIN_SIM = 0.5

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
  embedding: Float32Array
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
}

interface FaceCacheRow {
  faceId: string
  personId: string | null
  photoId: string
  embedding: Float32Array
}

interface PersonCentroidRow {
  personId: string
  name: string
  centroid: Float32Array | null
}

/** Local SQLite store mirroring the backend schema + clustering behavior. */
export class PhotoStore {
  private db: Database.Database
  private facesCache: FaceCacheRow[] | null = null
  private personCentroids: PersonCentroidRow[] | null = null
  private personSeq = 0

  private constructor(db: Database.Database) {
    this.db = db
    this.personSeq = (this.db.prepare('SELECT COUNT(*) AS n FROM persons').get() as { n: number }).n
  }

  static open(dbPath: string): PhotoStore {
    const db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    db.exec(SCHEMA)
    return new PhotoStore(db)
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
      const info = this.db.prepare(`DELETE FROM photos WHERE path LIKE ?`).run(prefix + '%')
      this.db.prepare(`DELETE FROM folders WHERE host_path = ?`).run(hostPath)
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
    this.db.prepare(`DELETE FROM photos WHERE id = ?`).run(photoId)
    this.invalidate()
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

  /** Face preview data for each person: one representative face + its photo path. */
  listPersonPreviews(ids: string[]): Array<{ personId: string; faceId: string; photoPath: string | null }> {
    if (ids.length === 0) return []
    const placeholders = ids.map(() => '?').join(',')
    // Pick one representative face per person (the earliest inserted via rowid),
    // avoiding ties from second-resolution created_at timestamps.
    return this.db
      .prepare(
        `SELECT pr.id AS personId, f.id AS faceId, p.path AS photoPath
         FROM persons pr
         JOIN faces f ON f.person_id = pr.id
         JOIN photos p ON p.id = f.photo_id
         JOIN (SELECT person_id, MIN(rowid) AS rowid FROM faces GROUP BY person_id) first
           ON first.person_id = f.person_id AND first.rowid = f.rowid
         WHERE pr.id IN (${placeholders})`,
      )
      .all(...ids) as Array<{ personId: string; faceId: string; photoPath: string | null }>
  }

  // ------------------------------------------- faces + clustering (mirror backend)

  /**
   * Insert a face, matching/creating its person cluster (centroid cosine
   * matching with running-average update, CLUSTER_MATCH_THRESHOLD = 0.6).
   */
  addFaceWithCluster(face: AddFaceInput): { faceId: string; personId: string; isNewPerson: boolean } {
    const run = this.db.transaction(() => this.clusterFace(face))
    const result = run()
    this.invalidate()
    return result
  }

  /**
   * Insert a photo and all of its faces in ONE transaction (no orphan photo
   * or person on partial failure). Returns null when the path already exists.
   */
  addPhotoWithFaces(photo: AddPhotoInput, faces: AddFaceInput[]): Array<{ faceId: string; personId: string; isNewPerson: boolean }> | null {
    const run = this.db.transaction(() => {
      if (!this.addPhoto(photo)) return null
      return faces.map((f) => this.clusterFace(f))
    })
    const result = run()
    this.invalidate()
    return result
  }

  /** Clustering + inserts for one face. Must run inside a transaction. */
  private clusterFace(face: AddFaceInput): { faceId: string; personId: string; isNewPerson: boolean } {
    const faceId = face.id ?? randomUUID()
    const match = this.matchPerson(face.embedding)

    let personId: string
    let isNewPerson = false
    if (match) {
      personId = match.personId
      const old = match.centroid ?? face.embedding
      const next = new Float32Array(512)
      for (let i = 0; i < 512; i++) next[i] = (old[i] + face.embedding[i]) / 2
      this.db
        .prepare(`UPDATE persons SET centroid = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(embeddingToBlob(next), personId)
      // Keep the in-memory centroid cache fresh so later faces in the same
      // batch (same transaction) match against the updated centroid.
      if (this.personCentroids) {
        const cached = this.personCentroids.find((p) => p.personId === personId)
        if (cached) cached.centroid = next
      }
    } else {
      personId = randomUUID()
      this.personSeq += 1
      isNewPerson = true
      this.db
        .prepare(`INSERT INTO persons (id, name, centroid) VALUES (?, ?, ?)`)
        .run(personId, `Person ${this.personSeq}`, embeddingToBlob(face.embedding))
      this.personCentroids?.push({ personId, name: `Person ${this.personSeq}`, centroid: new Float32Array(face.embedding) })
    }

    this.db
      .prepare(`INSERT INTO faces (id, photo_id, person_id, x1, y1, x2, y2, embedding) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(faceId, face.photoId, personId, face.x1, face.y1, face.x2, face.y2, embeddingToBlob(face.embedding))
    return { faceId, personId, isNewPerson }
  }

  /** Nearest person centroid with cosine > threshold, else null. */
  private matchPerson(embedding: Float32Array): { personId: string; name: string; centroid: Float32Array | null } | null {
    this.personCentroids ??= this.loadPersonCentroids()
    let best: PersonCentroidRow | null = null
    let bestSim = CLUSTER_MATCH_THRESHOLD
    for (const p of this.personCentroids) {
      if (!p.centroid) continue
      const sim = cosine(embedding, p.centroid)
      if (sim > bestSim) {
        bestSim = sim
        best = p
      }
    }
    return best ? { personId: best.personId, name: best.name, centroid: best.centroid } : null
  }

  listPersons(): PersonSummary[] {
    return this.db
      .prepare(
        `SELECT p.id AS personId, p.name,
                COUNT(DISTINCT f.photo_id) AS photoCount,
                COUNT(f.id) AS faceCount
         FROM persons p LEFT JOIN faces f ON f.person_id = p.id
         GROUP BY p.id
         ORDER BY photoCount DESC, p.created_at ASC`,
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
        bestHitByPhoto.set(face.photoId, {
          faceId: face.faceId,
          photoId: face.photoId,
          path: photo.path,
          thumbPath: photo.thumbPath,
          personId: person?.personId ?? null,
          personName: person?.name ?? null,
          similarity: sim,
          matchedPersons: [] as string[], // filled below
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

  /** Single face box (first matching) for a photo, scoped to a person filter. */
  faceBoxForPhoto(personId: string, photoId: string): { faceId: string; x1: number; y1: number; x2: number; y2: number; personId: string | null; personName: string | null; width: number | null; height: number | null } | null {
    const row = this.db
      .prepare(
        `SELECT f.id AS faceId, f.x1, f.y1, f.x2, f.y2, f.person_id AS personId, per.name AS personName,
                p.width AS width, p.height AS height
         FROM faces f
         LEFT JOIN persons per ON per.id = f.person_id
         JOIN photos p ON p.id = f.photo_id
         WHERE f.person_id = ? AND f.photo_id = ?
         ORDER BY f.created_at
         LIMIT 1`,
      )
      .get(personId, photoId) as
      | { faceId: string; x1: number; y1: number; x2: number; y2: number; personId: string | null; personName: string | null; width: number | null; height: number | null }
      | undefined
    return row ?? null
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

  private loadPersonCentroids(): PersonCentroidRow[] {
    if (this.personCentroids) return this.personCentroids
    const rows = this.db
      .prepare(`SELECT id AS personId, name, centroid FROM persons`)
      .all() as Array<{ personId: string; name: string; centroid: Buffer | null }>
    this.personCentroids = rows.map((r) => ({ personId: r.personId, name: r.name, centroid: r.centroid ? blobToEmbedding(r.centroid) : null }))
    return this.personCentroids
  }

  private invalidate(): void {
    this.facesCache = null
    this.personCentroids = null
  }
}
