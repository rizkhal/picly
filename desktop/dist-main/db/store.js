"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PhotoStore = exports.SEARCH_MIN_SIM = exports.CLUSTER_MATCH_THRESHOLD = void 0;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const node_crypto_1 = require("node:crypto");
const schema_1 = require("./schema");
const vec_1 = require("./vec");
exports.CLUSTER_MATCH_THRESHOLD = 0.6;
exports.SEARCH_MIN_SIM = 0.5;
/** Local SQLite store mirroring the backend schema + clustering behavior. */
class PhotoStore {
    db;
    facesCache = null;
    personCentroids = null;
    personSeq = 0;
    constructor(db) {
        this.db = db;
        this.personSeq = this.db.prepare('SELECT COUNT(*) AS n FROM persons').get().n;
    }
    static open(dbPath) {
        const db = new better_sqlite3_1.default(dbPath);
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
        db.exec(schema_1.SCHEMA);
        return new PhotoStore(db);
    }
    close() {
        this.db.close();
    }
    // ---------------------------------------------------------------- folders
    addFolder(hostPath, name) {
        const id = (0, node_crypto_1.randomUUID)();
        this.db
            .prepare(`INSERT INTO folders (id, host_path, name) VALUES (?, ?, ?)
         ON CONFLICT(host_path) DO UPDATE SET name = excluded.name`)
            .run(id, hostPath, name);
        return id;
    }
    listFolders() {
        return this.db
            .prepare(`SELECT f.id AS folderId, f.host_path AS hostPath, f.name, f.last_scanned_at AS lastScannedAt,
                COUNT(p.id) AS photoCount
         FROM folders f LEFT JOIN photos p ON p.path LIKE f.host_path || '/%'
         GROUP BY f.id ORDER BY f.added_at DESC`)
            .all();
    }
    markFolderScanned(hostPath) {
        this.db
            .prepare(`UPDATE folders SET last_scanned_at = datetime('now') WHERE host_path = ?`)
            .run(hostPath);
    }
    /** Delete a folder and every photo (cascade faces) under it. */
    deleteFolder(hostPath) {
        const prefix = hostPath.replace(/\/+$/, '') + '/';
        const del = this.db.transaction(() => {
            const info = this.db.prepare(`DELETE FROM photos WHERE path LIKE ?`).run(prefix + '%');
            this.db.prepare(`DELETE FROM folders WHERE host_path = ?`).run(hostPath);
            return info.changes;
        });
        const n = del();
        this.invalidate();
        return n;
    }
    // ----------------------------------------------------------------- photos
    /** Insert a photo; returns false when the path already exists (skip). */
    addPhoto(photo) {
        const exists = this.db.prepare(`SELECT 1 FROM photos WHERE path = ?`).get(photo.path);
        if (exists)
            return false;
        this.db
            .prepare(`INSERT INTO photos (id, path, width, height, thumb_path, content_hash)
         VALUES (?, ?, ?, ?, ?, ?)`)
            .run(photo.id ?? (0, node_crypto_1.randomUUID)(), photo.path, photo.width ?? null, photo.height ?? null, photo.thumbPath ?? null, photo.contentHash ?? null);
        return true;
    }
    hasPhotoPath(path) {
        return !!this.db.prepare(`SELECT 1 FROM photos WHERE path = ?`).get(path);
    }
    hasPhotoHash(hash) {
        return !!this.db.prepare(`SELECT 1 FROM photos WHERE content_hash = ?`).get(hash);
    }
    getPhoto(photoId) {
        const row = this.db
            .prepare(`SELECT id AS photoId, path, thumb_path AS thumbPath, width, height FROM photos WHERE id = ?`)
            .get(photoId);
        return row ?? null;
    }
    deletePhoto(photoId) {
        this.db.prepare(`DELETE FROM photos WHERE id = ?`).run(photoId);
        this.invalidate();
    }
    listPhotos(folderPath, limit = 500, offset = 0) {
        const where = folderPath ? `WHERE p.path LIKE ?` : '';
        const params = folderPath ? [folderPath.replace(/\/+$/, '') + '/%', limit, offset] : [limit, offset];
        return this.db
            .prepare(`SELECT p.id AS photoId, p.path, p.thumb_path AS thumbPath, p.width, p.height,
                COUNT(DISTINCT f.id) AS facesDetected
         FROM photos p LEFT JOIN faces f ON f.photo_id = p.id
         ${where}
         GROUP BY p.id ORDER BY p.created_at DESC LIMIT ? OFFSET ?`)
            .all(...params);
    }
    /** Photos belonging to one person (via its faces), newest first. */
    listPhotosForPerson(personId, limit = 500) {
        return this.db
            .prepare(`SELECT DISTINCT p.id AS photoId, p.path, p.thumb_path AS thumbPath, p.width, p.height
         FROM faces f
         JOIN photos p ON p.id = f.photo_id
         WHERE f.person_id = ?
         ORDER BY p.created_at DESC LIMIT ?`)
            .all(personId, limit);
    }
    // ------------------------------------------- faces + clustering (mirror backend)
    /**
     * Insert a face, matching/creating its person cluster (centroid cosine
     * matching with running-average update, CLUSTER_MATCH_THRESHOLD = 0.6).
     */
    addFaceWithCluster(face) {
        const run = this.db.transaction(() => this.clusterFace(face));
        const result = run();
        this.invalidate();
        return result;
    }
    /**
     * Insert a photo and all of its faces in ONE transaction (no orphan photo
     * or person on partial failure). Returns null when the path already exists.
     */
    addPhotoWithFaces(photo, faces) {
        const run = this.db.transaction(() => {
            if (!this.addPhoto(photo))
                return null;
            return faces.map((f) => this.clusterFace(f));
        });
        const result = run();
        this.invalidate();
        return result;
    }
    /** Clustering + inserts for one face. Must run inside a transaction. */
    clusterFace(face) {
        const faceId = face.id ?? (0, node_crypto_1.randomUUID)();
        const match = this.matchPerson(face.embedding);
        let personId;
        let isNewPerson = false;
        if (match) {
            personId = match.personId;
            const old = match.centroid ?? face.embedding;
            const next = new Float32Array(512);
            for (let i = 0; i < 512; i++)
                next[i] = (old[i] + face.embedding[i]) / 2;
            this.db
                .prepare(`UPDATE persons SET centroid = ?, updated_at = datetime('now') WHERE id = ?`)
                .run((0, vec_1.embeddingToBlob)(next), personId);
            // Keep the in-memory centroid cache fresh so later faces in the same
            // batch (same transaction) match against the updated centroid.
            if (this.personCentroids) {
                const cached = this.personCentroids.find((p) => p.personId === personId);
                if (cached)
                    cached.centroid = next;
            }
        }
        else {
            personId = (0, node_crypto_1.randomUUID)();
            this.personSeq += 1;
            isNewPerson = true;
            this.db
                .prepare(`INSERT INTO persons (id, name, centroid) VALUES (?, ?, ?)`)
                .run(personId, `Person ${this.personSeq}`, (0, vec_1.embeddingToBlob)(face.embedding));
            this.personCentroids?.push({ personId, name: `Person ${this.personSeq}`, centroid: new Float32Array(face.embedding) });
        }
        this.db
            .prepare(`INSERT INTO faces (id, photo_id, person_id, x1, y1, x2, y2, embedding) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(faceId, face.photoId, personId, face.x1, face.y1, face.x2, face.y2, (0, vec_1.embeddingToBlob)(face.embedding));
        return { faceId, personId, isNewPerson };
    }
    /** Nearest person centroid with cosine > threshold, else null. */
    matchPerson(embedding) {
        this.personCentroids ??= this.loadPersonCentroids();
        let best = null;
        let bestSim = exports.CLUSTER_MATCH_THRESHOLD;
        for (const p of this.personCentroids) {
            if (!p.centroid)
                continue;
            const sim = (0, vec_1.cosine)(embedding, p.centroid);
            if (sim > bestSim) {
                bestSim = sim;
                best = p;
            }
        }
        return best ? { personId: best.personId, name: best.name, centroid: best.centroid } : null;
    }
    listPersons() {
        return this.db
            .prepare(`SELECT p.id AS personId, p.name,
                COUNT(DISTINCT f.photo_id) AS photoCount,
                COUNT(f.id) AS faceCount
         FROM persons p LEFT JOIN faces f ON f.person_id = p.id
         GROUP BY p.id
         ORDER BY photoCount DESC, p.created_at ASC`)
            .all();
    }
    renamePerson(personId, name) {
        this.db.prepare(`UPDATE persons SET name = ?, updated_at = datetime('now') WHERE id = ?`).run(name, personId);
    }
    deletePerson(personId) {
        this.db.prepare(`UPDATE faces SET person_id = NULL WHERE person_id = ?`).run(personId);
        this.db.prepare(`DELETE FROM persons WHERE id = ?`).run(personId);
        this.invalidate();
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
    searchFaces(embeddings, limit = 10, minSim = exports.SEARCH_MIN_SIM) {
        const queries = Array.isArray(embeddings) ? embeddings : [embeddings];
        if (queries.length === 0)
            return [];
        const faces = this.loadFacesCache();
        // photoId -> best sim across all query faces (photo-level ranking)
        const bestByPhoto = new Map();
        // photoId -> best (faceId, sim, personId, personName) for the top sim
        const bestHitByPhoto = new Map();
        // photoId -> set of distinct person names matched by ANY query face
        const personsByPhoto = new Map();
        const getPhoto = this.db.prepare(`SELECT id AS photoId, path, thumb_path AS thumbPath FROM photos WHERE id = ?`);
        const getPerson = this.db.prepare(`SELECT id AS personId, name FROM persons WHERE id = ?`);
        for (const query of queries) {
            for (const face of faces) {
                const sim = (0, vec_1.cosine)(query, face.embedding);
                if (sim < minSim)
                    continue;
                if (!personsByPhoto.has(face.photoId))
                    personsByPhoto.set(face.photoId, new Set());
                if (face.personId) {
                    const person = getPerson.get(face.personId);
                    if (person)
                        personsByPhoto.get(face.photoId).add(person.name);
                }
                const prev = bestByPhoto.get(face.photoId) ?? -1;
                if (sim <= prev)
                    continue;
                bestByPhoto.set(face.photoId, sim);
                const photo = getPhoto.get(face.photoId);
                const person = face.personId ? getPerson.get(face.personId) : undefined;
                bestHitByPhoto.set(face.photoId, {
                    faceId: face.faceId,
                    photoId: face.photoId,
                    path: photo.path,
                    thumbPath: photo.thumbPath,
                    personId: person?.personId ?? null,
                    personName: person?.name ?? null,
                    similarity: sim,
                    matchedPersons: [], // filled below
                });
            }
        }
        const top = [...bestHitByPhoto.values()]
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, limit);
        // Attach the full matched-persons list per photo
        for (const hit of top) {
            hit.matchedPersons = [...(personsByPhoto.get(hit.photoId) ?? new Set())];
        }
        return top;
    }
    /** Per-face photo -> person assignment, ordered by photo path (parity dumps). */
    personAssignments() {
        return this.db
            .prepare(`SELECT p.path, per.name AS personName
         FROM faces f
         JOIN photos p ON p.id = f.photo_id
         JOIN persons per ON per.id = f.person_id
         ORDER BY p.path`)
            .all();
    }
    /** Face embeddings detected in a specific photo (in insertion order). */
    facesForPhoto(photoId) {
        const rows = this.db
            .prepare(`SELECT embedding FROM faces WHERE photo_id = ? ORDER BY created_at`)
            .all(photoId);
        return rows.map((r) => (0, vec_1.blobToEmbedding)(r.embedding));
    }
    /** Distinct photo paths belonging to one person's faces. */
    photosForPerson(personId) {
        const rows = this.db
            .prepare(`SELECT DISTINCT p.path FROM faces f JOIN photos p ON p.id = f.photo_id WHERE f.person_id = ?`)
            .all(personId);
        return rows.map((r) => r.path);
    }
    /** Face embeddings for one person (for cluster-quality checks). */
    faceEmbeddingsForPerson(personId, limit = 50) {
        const rows = this.db
            .prepare(`SELECT embedding FROM faces WHERE person_id = ? LIMIT ?`)
            .all(personId, limit);
        return rows.map((r) => (0, vec_1.blobToEmbedding)(r.embedding));
    }
    stats() {
        const one = (sql) => this.db.prepare(sql).get().n;
        return {
            photos: one('SELECT COUNT(*) AS n FROM photos'),
            faces: one('SELECT COUNT(*) AS n FROM faces'),
            persons: one('SELECT COUNT(*) AS n FROM persons'),
            folders: one('SELECT COUNT(*) AS n FROM folders'),
        };
    }
    // ---------------------------------------------------------------- caching
    loadFacesCache() {
        if (this.facesCache)
            return this.facesCache;
        const rows = this.db
            .prepare(`SELECT id AS faceId, photo_id AS photoId, person_id AS personId, embedding FROM faces`)
            .all();
        this.facesCache = rows.map((r) => ({ faceId: r.faceId, photoId: r.photoId, personId: r.personId, embedding: (0, vec_1.blobToEmbedding)(r.embedding) }));
        return this.facesCache;
    }
    loadPersonCentroids() {
        if (this.personCentroids)
            return this.personCentroids;
        const rows = this.db
            .prepare(`SELECT id AS personId, name, centroid FROM persons`)
            .all();
        this.personCentroids = rows.map((r) => ({ personId: r.personId, name: r.name, centroid: r.centroid ? (0, vec_1.blobToEmbedding)(r.centroid) : null }));
        return this.personCentroids;
    }
    invalidate() {
        this.facesCache = null;
        this.personCentroids = null;
    }
}
exports.PhotoStore = PhotoStore;
