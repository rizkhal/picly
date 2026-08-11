#!/usr/bin/env python3
"""Generate golden reference fixtures for the Node.js ML pipeline port.

Runs in any insightface 0.7.3 + onnxruntime env (originally the picly-api
container) with buffalo_l and det_size 640x640 — same config as the app — and
writes, per detected face:

  - bbox          : raw SCRFD bbox (float, original image coords)
  - det_score     : detection confidence
  - kps           : raw 5 landmarks from det_10g (NOT 2d106det-refined) so the
                    Node pipeline (which uses raw kps) can match exactly
  - M             : 2x3 similarity transform from face_align.estimate_norm(kps)
  - embedding     : L2-normalized ArcFace embedding computed from
                    norm_crop(raw kps) + w600k_r50 — the exact target the Node
                    pipeline must reproduce (cosSim ~1.0)
  - ref_embedding : app-standard embedding (2d106det-refined kps), kept for
                    informational parity checks only (~0.98 vs Node pipeline)

Usage:
  (any host with insightface 0.7.3 + onnxruntime + opencv; needs the app's
  face_app equivalent — see app/ml.py in the archived services/ tree)
  python3 gen_fixtures.py --photos <host paths...> --out golden.json
"""
import argparse
import json
import os
import sys

sys.path.insert(0, "/app")

import cv2
import numpy as np
from insightface.model_zoo.arcface_onnx import ArcFaceONNX
from insightface.utils import face_align

from app.ml import face_app, load_model

if face_app is None:
    load_model()
    from app.ml import face_app


def host_to_container(host_path: str) -> str:
    if host_path.startswith("/host"):
        return host_path
    return "/host" + host_path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--photos", nargs="+", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    det_model = face_app.det_model
    rec_model = face_app.models["recognition"]
    assert isinstance(rec_model, ArcFaceONNX)
    det_size = face_app.det_size

    entries = []
    for host_path in args.photos:
        cpath = host_to_container(host_path)
        img = cv2.imread(cpath)
        if img is None:
            print("SKIP unreadable:", host_path)
            continue

        bboxes, kpss = det_model.detect(
            img, input_size=det_size, max_num=0, metric="default"
        )

        # app-standard reference faces (2d106det-refined kps) for info only
        app_faces = face_app.get(img)

        faces = []
        if kpss is not None:
            for i in range(bboxes.shape[0]):
                bbox = bboxes[i, 0:4]
                score = float(bboxes[i, 4])
                kps = kpss[i]

                # exact target for the Node pipeline (raw kps, no refinement)
                M = face_align.estimate_norm(kps, image_size=112)
                aimg = cv2.warpAffine(img, M, (112, 112), borderValue=0.0)
                emb = rec_model.get_feat(aimg).flatten()
                emb = emb / np.linalg.norm(emb)

                # informational reference (refined kps)
                ref = None
                cx = (bbox[0] + bbox[2]) / 2.0
                cy = (bbox[1] + bbox[3]) / 2.0
                best = None
                best_d = float("inf")
                for f in app_faces:
                    fc = (f.bbox[0] + f.bbox[2]) / 2.0, (f.bbox[1] + f.bbox[3]) / 2.0
                    d = (fc[0] - cx) ** 2 + (fc[1] - cy) ** 2
                    if d < best_d:
                        best_d = d
                        best = f
                if best is not None:
                    ref = best.normed_embedding.tolist()

                faces.append(
                    {
                        "bbox": [float(v) for v in bbox],
                        "det_score": score,
                        "kps": [[float(x), float(y)] for x, y in kps],
                        "M": [[float(v) for v in row] for row in M],
                        "embedding": [float(v) for v in emb],
                        "ref_embedding": ref,
                    }
                )

        entries.append(
            {
                "photo": host_path,
                "width": int(img.shape[1]),
                "height": int(img.shape[0]),
                "faces": faces,
            }
        )
        print(host_path, img.shape, "faces:", len(faces))

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(
            {
                "generated_by": "docs/ml-parity/gen_fixtures.py",
                "reference": "insightface 0.7.3 buffalo_l det_size=(640,640)",
                "photos": entries,
            },
            f,
            indent=1,
        )
    print("wrote", args.out, "entries:", len(entries))


if __name__ == "__main__":
    main()
