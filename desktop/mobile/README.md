# Picly Mobile

React Native (Expo) mobile app for face clustering.

## Branch

This work lives on `mobile-rn`. The desktop Electron app remains on `master`.

## Structure

```
mobile/
├── App.tsx                 # Expo entrypoint
├── app.json                # Expo config
├── package.json            # Mobile dependencies
├── tsconfig.json
├── assets/
│   ├── icon.png
│   ├── splash.png
│   └── adaptive-icon.png
├── models/                 # ONNX face models (buffalo_s / buffalo_l)
└── src/
    ├── ml/
    │   ├── detector.ts     # SCRFD face detection via ONNX Runtime Mobile
    │   ├── recognizer.ts   # ArcFace embedding via ONNX Runtime Mobile
    │   ├── clustering.ts   # Centroid-linkage HAC (ported from desktop)
    │   └── worker.ts       # Background ML processing via worklets
    ├── db/
    │   ├── schema.ts       # SQLite schema for faces/persons/folders
    │   └── store.ts        # Database operations
    ├── scanning/
    │   ├── folderScanner.ts    # Scan gallery folders
    │   └── imagePipeline.ts    # Decode -> detect -> embed -> cluster
    ├── ui/
    │   ├── screens/
    │   │   ├── HomeScreen.tsx    # Folder list + scan button
    │   │   ├── FacesScreen.tsx   # Grid faces per person
    │   │   └── PersonScreen.tsx  # Detail person + merge/split
    │   └── components/
    │       ├── FaceCard.tsx
    │       └── PersonChip.tsx
    └── utils/
        ├── imageDecoder.ts  # Decode image -> tensor
        └── thumbnails.ts    # Generate + cache thumbs
```

## Dev

```bash
cd mobile
npm install
npm run start
```

## Notes

- Uses Expo managed workflow with config plugins.
- ONNX models should be placed in `models/` and bundled via Expo asset plugin.
- Desktop code stays in parent directory; mobile code is isolated in `mobile/`.
