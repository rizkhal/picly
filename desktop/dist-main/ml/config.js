"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultModelsDir = defaultModelsDir;
exports.buffaloL = buffaloL;
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
function defaultModelsDir() {
    return process.env.PICLY_MODELS_DIR ?? node_path_1.default.join(node_os_1.default.homedir(), '.insightface', 'models');
}
function buffaloL(modelsDir = defaultModelsDir()) {
    return {
        detModel: node_path_1.default.join(modelsDir, 'buffalo_l', 'det_10g.onnx'),
        arcModel: node_path_1.default.join(modelsDir, 'buffalo_l', 'w600k_r50.onnx'),
        detInputSize: 640,
        detStrides: [8, 16, 32],
        detNumAnchors: 2,
        detInputMean: 127.5,
        detInputStd: 128.0,
        arcInputSize: 112,
        arcInputMean: 127.5,
        arcInputStd: 127.5,
        detThresh: 0.5,
        nmsThresh: 0.4,
    };
}
