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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArcFaceEmbedder = void 0;
const ort = __importStar(require("onnxruntime-node"));
const image_1 = require("./image");
/**
 * ArcFace recognition (w600k_r50) — exact port of insightface ArcFaceONNX.get_feat:
 * input is an RGB 112x112 crop, normalized (pixel - 127.5) / 127.5, NCHW float32.
 * Callers are responsible for L2-normalizing the output (normed_embedding).
 */
class ArcFaceEmbedder {
    session;
    config;
    inputName = '';
    outputName = '';
    constructor(config) {
        this.config = config;
    }
    static async create(config) {
        const a = new ArcFaceEmbedder(config);
        a.session = await ort.InferenceSession.create(config.arcModel, {
            executionProviders: ['cpu'],
        });
        a.inputName = a.session.inputNames[0];
        a.outputName = a.session.outputNames[0];
        return a;
    }
    async getFeat(aimg) {
        const { config } = this;
        const size = config.arcInputSize;
        const blob = (0, image_1.toNchwBlob)(aimg, config.arcInputMean, 1 / config.arcInputStd);
        const feeds = { [this.inputName]: new ort.Tensor('float32', blob, [1, 3, size, size]) };
        const out = await this.session.run(feeds, [this.outputName]);
        const data = out[this.outputName].data;
        return new Float32Array(data);
    }
    l2Normalize(feat) {
        let sum = 0;
        for (let i = 0; i < feat.length; i++)
            sum += feat[i] * feat[i];
        const norm = Math.sqrt(sum);
        const out = new Float32Array(feat.length);
        if (norm > 0) {
            for (let i = 0; i < feat.length; i++)
                out[i] = feat[i] / norm;
        }
        return out;
    }
}
exports.ArcFaceEmbedder = ArcFaceEmbedder;
