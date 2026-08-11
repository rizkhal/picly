#!/usr/bin/env python3
"""Clustering parity reference (runs inside the picly-api container).

Replicates the scan-time clustering (centroid running average, cosine
threshold 0.6) over the same 24 LFW photos that desktop/scripts/parity-cluster.ts
scans, using RAW-kps embeddings (no 2d106det refinement) so the Node and Python
embeddings are identical. Prints "photo personIndex" per face.

Usage:
  docker cp services/face-search/scripts/parity_cluster.py picly-api-1:/tmp/
  docker exec picly-api-1 python3 /tmp/parity_cluster.py > /tmp/parity-py.txt
  docker cp picly-api-1:/tmp/parity-py.txt desktop/data/parity-py.txt
"""
import os
import sys

sys.path.insert(0, "/app")

import cv2
import numpy as np
from insightface.utils import face_align

from app.ml import face_app, load_model

if face_app is None:
    load_model()
    from app.ml import face_app

LFW = "/host/Users/rizkal/scikit_learn_data/lfw_home/lfw_funneled"
PEOPLE = [
    "George_W_Bush",
    "Colin_Powell",
    "Tony_Blair",
    "Donald_Rumsfeld",
    "Gerhard_Schroeder",
    "Ariel_Sharon",
]
THRESH = 0.6
PER = 4

files = []
for p in PEOPLE:
    d = os.path.join(LFW, p)
    fs = sorted(f for f in os.listdir(d) if f.endswith(".jpg"))[:PER]
    files += [os.path.join(d, f) for f in fs]

det = face_app.det_model
rec = face_app.models["recognition"]
det_size = face_app.det_size

centroids = []  # (creation_index, centroid)
out = []
for path in files:
    img = cv2.imread(path)
    bboxes, kpss = det.detect(img, input_size=det_size, max_num=0, metric="default")
    for i in range(bboxes.shape[0]):
        kps = kpss[i]
        M = face_align.estimate_norm(kps, 112)
        aimg = cv2.warpAffine(img, M, (112, 112), borderValue=0.0)
        emb = rec.get_feat(aimg).flatten()
        emb = emb / np.linalg.norm(emb)

        best = -1
        best_sim = THRESH
        for idx, c in centroids:
            sim = float(np.dot(emb, c))
            if sim > best_sim:
                best_sim = sim
                best = idx
        if best < 0:
            centroids.append((len(centroids) + 1, emb.copy()))
            out.append((os.path.basename(path), len(centroids)))
        else:
            # centroids list is 0-based; person indices are 1-based
            pos = best - 1
            old = centroids[pos][1]
            centroids[pos] = (best, (old + emb) / 2.0)
            out.append((os.path.basename(path), best))

for name, idx in out:
    print(name, idx)
