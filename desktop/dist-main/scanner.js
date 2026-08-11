"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IMAGE_EXTS = void 0;
exports.collectImages = collectImages;
exports.scanFolder = scanFolder;
const node_fs_1 = require("node:fs");
const node_crypto_1 = require("node:crypto");
const node_path_1 = __importDefault(require("node:path"));
const xxhash_wasm_1 = __importDefault(require("xxhash-wasm"));
const thumb_1 = require("./thumb");
exports.IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.webp']);
const HASH_CHUNK = 64 * 1024;
const hasherPromise = (0, xxhash_wasm_1.default)();
/** xxHash64 of file contents (same digest scheme as the Python backend). */
async function contentHash(filePath) {
    const hasher = (await hasherPromise).create64();
    const buf = Buffer.alloc(HASH_CHUNK);
    const handle = (0, node_fs_1.openSync)(filePath, 'r');
    try {
        let pos = 0;
        for (;;) {
            const n = (0, node_fs_1.readSync)(handle, buf, 0, HASH_CHUNK, pos);
            if (n <= 0)
                break;
            hasher.update(new Uint8Array(buf.buffer, 0, n));
            pos += n;
            if (n < HASH_CHUNK)
                break;
        }
    }
    finally {
        (0, node_fs_1.closeSync)(handle);
    }
    return hasher.digest().toString(16).padStart(16, '0');
}
/** Recursively list image files under root, sorted for deterministic scans. */
function collectImages(root) {
    const out = [];
    const walk = (dir) => {
        let entries;
        try {
            entries = (0, node_fs_1.readdirSync)(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        entries.sort((a, b) => a.name.localeCompare(b.name));
        for (const e of entries) {
            const full = node_path_1.default.join(dir, e.name);
            if (e.isDirectory()) {
                walk(full);
            }
            else if (e.isFile() && exports.IMAGE_EXTS.has(node_path_1.default.extname(e.name).toLowerCase())) {
                out.push(full);
            }
        }
    };
    walk(root);
    return out;
}
async function scanFolder(store, folderPath, analysis, options) {
    const started = Date.now();
    const scanId = `scan_${started}_${Math.random().toString(36).slice(2, 8)}`;
    const files = options.files ?? collectImages(folderPath);
    const total = files.length;
    const progress = {
        scanId,
        folder: folderPath,
        total,
        processed: 0,
        scanned: 0,
        totalFaces: 0,
        persons: store.listPersons().length,
        errors: 0,
        status: 'running',
        currentFile: null,
    };
    const emit = () => options.onProgress?.({ ...progress });
    store.addFolder(folderPath, node_path_1.default.basename(folderPath));
    (0, node_fs_1.mkdirSync)(options.thumbDir, { recursive: true });
    let personCount = store.listPersons().length;
    let cancelled = false;
    for (const filePath of files) {
        if (options.shouldCancel?.()) {
            cancelled = true;
            break;
        }
        progress.processed += 1;
        progress.currentFile = filePath;
        emit();
        try {
            // Content-hash dedup (same bytes, different paths)
            const hash = await contentHash(filePath);
            if (store.hasPhotoHash(hash))
                continue;
            if (store.hasPhotoPath(filePath))
                continue;
            const faces = await analysis.detect(filePath);
            if (faces.length === 0)
                continue;
            const photoId = (0, node_crypto_1.randomUUID)();
            const thumbPath = node_path_1.default.join(options.thumbDir, `${photoId}.jpg`);
            await (0, thumb_1.makeThumbnail)(filePath, thumbPath, thumb_1.THUMB_SIZE);
            let width = null;
            let height = null;
            try {
                const meta = await sharpMeta(filePath);
                width = meta.width ?? null;
                height = meta.height ?? null;
            }
            catch {
                // non-fatal
            }
            const results = store.addPhotoWithFaces({ id: photoId, path: filePath, width, height, thumbPath, contentHash: hash }, faces.map((face) => ({
                photoId,
                x1: Math.round(face.bbox[0]),
                y1: Math.round(face.bbox[1]),
                x2: Math.round(face.bbox[2]),
                y2: Math.round(face.bbox[3]),
                embedding: face.embedding,
            })));
            if (results === null)
                continue; // path appeared mid-scan; treat as duplicate
            personCount += results.filter((r) => r.isNewPerson).length;
            progress.scanned += 1;
            progress.totalFaces += faces.length;
            progress.persons = personCount;
            emit();
        }
        catch (e) {
            console.error(`scan error [${filePath}]:`, e);
            progress.errors += 1;
            emit();
        }
    }
    store.markFolderScanned(folderPath);
    progress.status = cancelled ? 'cancelled' : 'done';
    progress.currentFile = null;
    progress.persons = personCount;
    emit();
    return {
        scanId,
        total,
        scanned: progress.scanned,
        totalFaces: progress.totalFaces,
        persons: progress.persons,
        errors: progress.errors,
        cancelled,
        elapsedMs: Date.now() - started,
    };
}
async function sharpMeta(filePath) {
    const { default: sharp } = await Promise.resolve().then(() => __importStar(require('sharp')));
    return sharp(filePath, { failOn: 'none' }).metadata();
}
