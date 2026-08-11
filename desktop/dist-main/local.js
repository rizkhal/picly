"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLocalServices = createLocalServices;
exports.startScan = startScan;
exports.searchPhoto = searchPhoto;
exports.searchStoredPhoto = searchStoredPhoto;
exports.listPhotos = listPhotos;
exports.listPersonPhotos = listPersonPhotos;
/**
 * Local services entry point for the Electron main process.
 *
 * Compiled to CJS (tsconfig.local.json -> dist-main/local.js) and required by
 * main.cjs. Owns the local SQLite store + lazily-loaded face pipeline, and
 * exposes scan/search orchestration that the IPC handlers call.
 */
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const store_1 = require("./db/store");
const faceAnalysis_1 = require("./ml/faceAnalysis");
const image_1 = require("./ml/image");
const scanner_1 = require("./scanner");
function createLocalServices(config) {
    (0, node_fs_1.mkdirSync)(node_path_1.default.dirname(config.dbPath), { recursive: true });
    (0, node_fs_1.mkdirSync)(config.thumbDir, { recursive: true });
    const store = store_1.PhotoStore.open(config.dbPath);
    let analysisPromise = null;
    return {
        config,
        store,
        getAnalysis: () => (analysisPromise ??= faceAnalysis_1.FaceAnalysis.create()),
    };
}
/** Start a folder scan; progress is streamed via onProgress. */
function startScan(services, folderPath, onProgress) {
    let cancelled = false;
    const scanId = `scan_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const done = (async () => {
        const analysis = await services.getAnalysis();
        return (0, scanner_1.scanFolder)(services.store, folderPath, analysis, {
            thumbDir: services.config.thumbDir,
            onProgress,
            shouldCancel: () => cancelled,
        });
    })();
    return { scanId, cancel: () => { cancelled = true; }, done };
}
function toHitView(h) {
    return {
        photoId: h.photoId,
        path: h.path,
        thumbUrl: h.thumbPath ? `picly://thumb/${node_path_1.default.basename(h.thumbPath)}` : null,
        personId: h.personId,
        personName: h.personName,
        similarity: h.similarity,
        matchedPersons: h.matchedPersons ?? [],
    };
}
/** Detect faces in a query photo and search the library with ALL of them. */
async function searchPhoto(services, photoPath, limit = 10) {
    const analysis = await services.getAnalysis();
    const img = await (0, image_1.decodeRgb)(photoPath);
    const faces = await analysis.detectFromImage(img);
    if (faces.length === 0)
        return { facesDetected: 0, hits: [] };
    const hits = services.store.searchFaces(faces.map((f) => f.embedding), limit);
    return { facesDetected: faces.length, hits: hits.map(toHitView) };
}
/** Search using an already-stored photo's embeddings (no re-detect). */
function searchStoredPhoto(services, photoId, limit = 10) {
    const faces = services.store.facesForPhoto(photoId);
    if (faces.length === 0)
        return { facesDetected: 0, hits: [] };
    const hits = services.store.searchFaces(faces, limit);
    return { facesDetected: faces.length, hits: hits.map(toHitView) };
}
function listPhotos(services, folderPath, limit = 500, offset = 0) {
    return services.store.listPhotos(folderPath, limit, offset);
}
/** Photos scoped to a person (via faces), thumbnails mapped to picly:// URLs. */
function listPersonPhotos(services, personId, limit = 500) {
    return services.store.listPhotosForPerson(personId, limit).map((p) => ({
        ...p,
        thumbUrl: p.thumbPath ? `picly://thumb/${node_path_1.default.basename(p.thumbPath)}` : null,
    }));
}
