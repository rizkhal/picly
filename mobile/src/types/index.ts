// Shared domain types for the mobile UI scaffold.
// These mirror the desktop pipeline shapes (DetectedFace, Photo, Person) so the
// real ML/db port can be wired in without reshaping the UI.

export type QualityTier = 'high' | 'medium' | 'low' | 'very_low';

export type FaceStatus = 'recognized' | 'match_candidate' | 'detected' | 'unassigned';

export interface FaceBox {
  /** Normalized 0..1 relative to the photo width. */
  x: number;
  /** Normalized 0..1 relative to the photo height. */
  y: number;
  /** Normalized width 0..1 relative to the photo width. */
  w: number;
  /** Normalized height 0..1 relative to the photo height. */
  h: number;
}

export interface Face {
  id: string;
  /** Auto-generated name, e.g. "Person 12". Null when unassigned. */
  name: string | null;
  status: FaceStatus;
  quality: QualityTier;
  /** Normalized bbox in the source photo. */
  box: FaceBox;
  /** Local uri of the cropped thumbnail. */
  thumbnailUri: string;
  personId: string | null;
}

export interface Photo {
  id: string;
  uri: string;
  /** Local asset id (expo-media-library). */
  assetId?: string;
  width: number;
  height: number;
  createdAt: number;
  faces: Face[];
  /** True when the source asset still exists on disk. */
  exists: boolean;
}

export interface Person {
  id: string;
  name: string;
  /** Representative thumbnail uri. */
  avatarUri: string;
  faceCount: number;
  photoCount: number;
  quality: QualityTier;
}

export interface ScanStage {
  id: 'detecting' | 'quality' | 'embedding';
  label: string;
}

export interface Folder {
  id: string;
  name: string;
  path: string;
  photoCount: number;
}

export interface SearchResult {
  photoId: string;
  similarity: number;
  box: FaceBox;
}
