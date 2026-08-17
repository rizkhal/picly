// MOCK — replace with the real pipeline (expo-media-library + onnxruntime + expo-sqlite).
// This module only feeds the UI scaffold so screens can be developed in parallel.

import type { Face, Folder, Person, Photo, SearchResult } from '../types';

const qualityRoll = ['high', 'medium', 'low'] as const;

const personNames = [
  'Person 12',
  'Person 33',
  'Person 41',
  'Person 87',
  'Person 101',
  'Person 128',
  'Person 150',
];

export const mockPeople: Person[] = personNames.map((name, i) => ({
  id: `person-${i + 1}`,
  name,
  avatarUri: `https://picsum.photos/seed/person-${i + 1}/200`,
  faceCount: 2 + ((i * 7) % 9),
  photoCount: 1 + ((i * 3) % 4),
  quality: qualityRoll[i % qualityRoll.length],
}));

export const mockFolders: Folder[] = [
  { id: 'f-1', name: 'Camera Roll', path: '/DCIM/Camera', photoCount: 1284 },
  { id: 'f-2', name: 'Family Trip', path: '/Pictures/Family Trip', photoCount: 342 },
  { id: 'f-3', name: 'Wedding', path: '/Pictures/Wedding', photoCount: 96 },
];

const faceBoxes: Array<[number, number, number, number]> = [
  [0.12, 0.2, 0.18, 0.24],
  [0.42, 0.15, 0.2, 0.27],
  [0.72, 0.25, 0.16, 0.21],
  [0.2, 0.6, 0.15, 0.2],
  [0.55, 0.62, 0.18, 0.24],
  [0.75, 0.68, 0.14, 0.19],
];

function makePhoto(id: string, seed: string, width: number, height: number, faceCount: number, createdAt: number): Photo {
  const faces: Face[] = [];
  for (let i = 0; i < faceCount; i++) {
    const box = faceBoxes[i % faceBoxes.length];
    const personIdx = (i * 2) % mockPeople.length;
    faces.push({
      id: `${id}-f${i}`,
      name: i % 4 === 3 ? null : mockPeople[personIdx].name,
      status: i % 4 === 3 ? 'unassigned' : 'recognized',
      quality: qualityRoll[(i + 1) % qualityRoll.length],
      box: { x: box[0], y: box[1], w: box[2], h: box[3] },
      thumbnailUri: `https://picsum.photos/seed/${seed}-face${i}/160`,
      personId: i % 4 === 3 ? null : mockPeople[personIdx].id,
    });
  }
  return {
    id,
    uri: `https://picsum.photos/seed/${seed}/${width}/${height}`,
    width,
    height,
    createdAt,
    faces,
    exists: true,
  };
}

export const mockPhotos: Photo[] = [
  makePhoto('p-1', 'family-a', 1200, 800, 4, Date.now() - 1000 * 60 * 60 * 5),
  makePhoto('p-2', 'group-b', 1200, 800, 6, Date.now() - 1000 * 60 * 60 * 26),
  makePhoto('p-3', 'party-c', 800, 1200, 5, Date.now() - 1000 * 60 * 60 * 30),
  makePhoto('p-4', 'street-d', 1200, 900, 3, Date.now() - 1000 * 60 * 60 * 49),
  makePhoto('p-5', 'park-e', 1200, 800, 4, Date.now() - 1000 * 60 * 60 * 72),
  makePhoto('p-6', 'beach-f', 900, 1200, 2, Date.now() - 1000 * 60 * 60 * 96),
  makePhoto('p-7', 'office-g', 1200, 800, 6, Date.now() - 1000 * 60 * 60 * 120),
  makePhoto('p-8', 'night-h', 1200, 800, 3, Date.now() - 1000 * 60 * 60 * 144),
  makePhoto('p-9', 'city-i', 1200, 1600, 1, Date.now() - 1000 * 60 * 60 * 168),
];

export const mockSearchResults: SearchResult[] = [
  { photoId: 'p-2', similarity: 0.92, box: { x: 0.42, y: 0.15, w: 0.2, h: 0.27 } },
  { photoId: 'p-5', similarity: 0.84, box: { x: 0.2, y: 0.6, w: 0.15, h: 0.2 } },
  { photoId: 'p-1', similarity: 0.71, box: { x: 0.12, y: 0.2, w: 0.18, h: 0.24 } },
  { photoId: 'p-7', similarity: 0.62, box: { x: 0.55, y: 0.62, w: 0.18, h: 0.24 } },
];
