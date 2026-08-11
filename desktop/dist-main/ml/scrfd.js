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
exports.ScrfdDetector = void 0;
const ort = __importStar(require("onnxruntime-node"));
const image_1 = require("./image");
/**
 * SCRFD detector — exact port of insightface model_zoo/scrfd.py:
 *  - 3 strides (8/16/32) x 2 anchors per cell
 *  - distance-to-bbox / distance-to-kps decode with stride-scaled deltas
 *  - score threshold then NMS (IoU 0.4), boxes/landmarks unscaled by det_scale
 */
class ScrfdDetector {
    session;
    config;
    inputName = '';
    /** Output names in grouped order: scores(8,16,32), bbox(8,16,32), kps(8,16,32). */
    orderedOutputs = [];
    centerCache = new Map();
    constructor(config) {
        this.config = config;
    }
    static async create(config) {
        const d = new ScrfdDetector(config);
        d.session = await ort.InferenceSession.create(config.detModel, {
            executionProviders: ['cpu'],
        });
        d.inputName = d.session.inputNames[0];
        // Derive output order robustly instead of trusting names: probe once with
        // a zero blob at the real det size, group outputs by trailing dim (1=score,
        // 4=bbox, 10=kps), sort each group by grid size desc (stride 8 > 16 > 32).
        // This avoids the classic lexicographic-name ordering bug.
        const probeSize = config.detInputSize;
        const probe = new ort.Tensor('float32', new Float32Array(3 * probeSize * probeSize), [1, 3, probeSize, probeSize]);
        const outs = await d.session.run({ [d.inputName]: probe });
        const scores = [];
        const bboxes = [];
        const kpss = [];
        for (const name of d.session.outputNames) {
            const t = outs[name];
            const rows = t.dims[0];
            const cols = t.dims.length > 1 ? t.dims[1] : 1;
            if (cols === 1)
                scores.push([name, rows]);
            else if (cols === 4)
                bboxes.push([name, rows]);
            else if (cols === 10)
                kpss.push([name, rows]);
        }
        const sortDesc = (a, b) => b[1] - a[1];
        scores.sort(sortDesc);
        bboxes.sort(sortDesc);
        kpss.sort(sortDesc);
        d.orderedOutputs = [...scores, ...bboxes, ...kpss].map(([name]) => name);
        if (d.orderedOutputs.length !== 9) {
            throw new Error(`SCRFD: expected 9 outputs, got ${d.orderedOutputs.length}`);
        }
        return d;
    }
    /**
     * @param img     letterboxed detSize x detSize image
     * @param detScale new_h / original_h (used to unscale boxes/landmarks)
     */
    async detect(img, detSize, detThresh, detScale) {
        const { config } = this;
        const blob = (0, image_1.toNchwBlob)(img, config.detInputMean, 1 / config.detInputStd);
        const feeds = { [this.inputName]: new ort.Tensor('float32', blob, [1, 3, detSize, detSize]) };
        const outs = await this.session.run(feeds, this.orderedOutputs);
        const outArr = this.orderedOutputs.map((name) => outs[name]);
        const fmc = 3;
        const strides = config.detStrides;
        const scoresAll = [];
        const bboxesAll = [];
        const kpssAll = [];
        for (let idx = 0; idx < fmc; idx++) {
            const stride = strides[idx];
            const scoreData = outArr[idx].data;
            const bboxData = outArr[idx + fmc].data;
            const kpsData = outArr[idx + 2 * fmc].data;
            const gridW = detSize / stride;
            const gridH = detSize / stride;
            const centers = this.anchorCenters(gridH, gridW, stride);
            const n = scoreData.length;
            for (let a = 0; a < n; a++) {
                if (scoreData[a] < detThresh)
                    continue;
                const cx = centers[a][0];
                const cy = centers[a][1];
                const b = a * 4;
                bboxesAll.push([
                    cx - bboxData[b] * stride,
                    cy - bboxData[b + 1] * stride,
                    cx + bboxData[b + 2] * stride,
                    cy + bboxData[b + 3] * stride,
                ]);
                scoresAll.push(scoreData[a]);
                const k = a * 10;
                const row = new Array(10);
                for (let i = 0; i < 5; i++) {
                    row[2 * i] = cx + kpsData[k + 2 * i] * stride;
                    row[2 * i + 1] = cy + kpsData[k + 2 * i + 1] * stride;
                }
                kpssAll.push(row);
            }
        }
        const order = scoresAll.map((_, i) => i).sort((a, b) => scoresAll[b] - scoresAll[a]);
        const keepIdx = this.nms(bboxesAll, order, config.nmsThresh);
        const bboxes = [];
        const scores = [];
        const kpss = [];
        for (const i of keepIdx) {
            const bb = bboxesAll[i];
            bboxes.push([bb[0] / detScale, bb[1] / detScale, bb[2] / detScale, bb[3] / detScale]);
            scores.push(scoresAll[i]);
            const row = kpssAll[i];
            const pts = [];
            for (let j = 0; j < 5; j++) {
                pts.push([row[2 * j] / detScale, row[2 * j + 1] / detScale]);
            }
            kpss.push(pts);
        }
        return { bboxes, scores, kpss };
    }
    anchorCenters(gridH, gridW, stride) {
        const key = `${gridH}x${gridW}x${stride}`;
        const cached = this.centerCache.get(key);
        if (cached)
            return cached;
        const centers = [];
        for (let y = 0; y < gridH; y++) {
            for (let x = 0; x < gridW; x++) {
                const cx = x * stride;
                const cy = y * stride;
                centers.push([cx, cy], [cx, cy]); // 2 anchors share the same center
            }
        }
        this.centerCache.set(key, centers);
        return centers;
    }
    /** Standard greedy NMS (IoU threshold), same as insightface SCRFD.nms. */
    nms(bboxes, order, thresh) {
        const n = bboxes.length;
        const x1 = new Array(n);
        const y1 = new Array(n);
        const x2 = new Array(n);
        const y2 = new Array(n);
        const areas = new Array(n);
        for (let i = 0; i < n; i++) {
            const b = bboxes[i];
            x1[i] = b[0];
            y1[i] = b[1];
            x2[i] = b[2];
            y2[i] = b[3];
            areas[i] = (b[2] - b[0] + 1) * (b[3] - b[1] + 1);
        }
        const keep = [];
        let remaining = order.slice();
        while (remaining.length > 0) {
            const i = remaining[0];
            keep.push(i);
            const next = [];
            for (let t = 1; t < remaining.length; t++) {
                const j = remaining[t];
                const xx1 = Math.max(x1[i], x1[j]);
                const yy1 = Math.max(y1[i], y1[j]);
                const xx2 = Math.min(x2[i], x2[j]);
                const yy2 = Math.min(y2[i], y2[j]);
                const w = Math.max(0, xx2 - xx1 + 1);
                const h = Math.max(0, yy2 - yy1 + 1);
                const inter = w * h;
                const ovr = inter / (areas[i] + areas[j] - inter);
                if (ovr <= thresh)
                    next.push(j);
            }
            remaining = next;
        }
        return keep;
    }
}
exports.ScrfdDetector = ScrfdDetector;
