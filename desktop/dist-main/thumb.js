"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.THUMB_SIZE = void 0;
exports.makeThumbnail = makeThumbnail;
const sharp_1 = __importDefault(require("sharp"));
exports.THUMB_SIZE = 300;
/**
 * Square thumbnail preserving the center crop — port of the backend's
 * ml.make_thumbnail (side = min(w,h), center crop, resize, JPEG q85).
 */
async function makeThumbnail(srcPath, destPath, size = exports.THUMB_SIZE) {
    try {
        await (0, sharp_1.default)(srcPath, { failOn: 'none' })
            .resize(size, size, { fit: 'cover', position: 'centre' })
            .jpeg({ quality: 85 })
            .toFile(destPath);
        return true;
    }
    catch {
        return false;
    }
}
