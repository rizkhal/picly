"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FaceAnalysis = exports.ARCFACE_DST = void 0;
const config_1 = require("./config");
const image_1 = require("./image");
const matrix_1 = require("./matrix");
const arcface_1 = require("./arcface");
const scrfd_1 = require("./scrfd");
/** ArcFace alignment template (arcface_dst from insightface/utils/face_align.py). */
exports.ARCFACE_DST = [
    [38.2946, 51.6963],
    [73.5318, 51.5014],
    [56.0252, 71.7366],
    [41.5493, 92.3655],
    [70.7299, 92.2041],
];
/**
 * Face detection + embedding pipeline, mirroring insightface's FaceAnalysis
 * (buffalo_l, det_size 640) but running fully in Node via ONNX Runtime:
 *   SCRFD detect -> estimate_norm(raw kps) -> warp 112x112 -> ArcFace -> L2 norm.
 */
class FaceAnalysis {
    detector;
    embedder;
    config;
    detSize;
    detThresh;
    constructor(detector, embedder, config, detSize, detThresh) {
        this.detector = detector;
        this.embedder = embedder;
        this.config = config;
        this.detSize = detSize;
        this.detThresh = detThresh;
    }
    static async create(options = {}) {
        const config = (0, config_1.buffaloL)(options.modelsDir ?? process.env.PICLY_MODELS_DIR);
        const detector = await scrfd_1.ScrfdDetector.create(config);
        const embedder = await arcface_1.ArcFaceEmbedder.create(config);
        return new FaceAnalysis(detector, embedder, config, options.detSize ?? 640, options.detThresh ?? 0.5);
    }
    async detect(imagePath) {
        const img = await (0, image_1.decodeRgb)(imagePath);
        return this.detectFromImage(img);
    }
    async detectFromImage(img) {
        const { resized, detScale } = (0, image_1.letterbox)(img, this.detSize);
        const { bboxes, scores, kpss } = await this.detector.detect(resized, this.detSize, this.detThresh, detScale);
        const faces = [];
        for (let i = 0; i < bboxes.length; i++) {
            const M = (0, matrix_1.umeyama)(kpss[i], exports.ARCFACE_DST);
            const aimg = (0, image_1.warpAffine)(img, M, this.config.arcInputSize);
            const feat = await this.embedder.getFeat(aimg);
            faces.push({
                bbox: bboxes[i],
                detScore: scores[i],
                kps: kpss[i],
                embedding: this.embedder.l2Normalize(feat),
            });
        }
        return faces;
    }
}
exports.FaceAnalysis = FaceAnalysis;
