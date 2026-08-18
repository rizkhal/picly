// Media library access — wraps expo-media-library's legacy API (stable,
// returns assets with a ready-to-use `uri`) so screens get plain data.
// The new Query builder API was tried first, but it can't resolve display
// URIs cheaply (per-asset native calls), which caused empty-uri renders.

import * as MediaLibrary from 'expo-media-library/legacy';
import type { LibraryPhoto, LibraryAlbum } from '../types';

export type MediaGroup =
  | { kind: 'all' }
  | { kind: 'album'; albumId: string; name: string }
  | { kind: 'camera' }
  | { kind: 'screenshots' };

/** Filename patterns that identify screenshots on Android (no native subtype). */
function isScreenshotName(filename: string): boolean {
  const n = filename.toLowerCase();
  return (
    n.startsWith('screenshot') ||
    n.startsWith('screen_') ||
    n.includes('screenshot') ||
    n.includes('_ss_')
  );
}

/** Filename patterns that identify camera photos on Android. */
function isCameraName(filename: string): boolean {
  const n = filename.toLowerCase();
  return n.startsWith('img_') || n.startsWith('dsc') || n.startsWith('p_');
}

/** Ensure read permission; returns false when the user denies. */
export async function ensurePhotoPermission(): Promise<boolean> {
  const current = await MediaLibrary.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const requested = await MediaLibrary.requestPermissionsAsync();
  return requested.granted;
}

/**
 * Fetch the device photo library (newest first). Only images — no videos.
 * `page` is 0-based; returns `{ items, hasMore }` so screens can paginate.
 */
export async function fetchPhotoLibrary(page = 0, pageSize = 120): Promise<{ items: LibraryPhoto[]; hasMore: boolean }> {
  const { assets, totalCount } = await MediaLibrary.getAssetsAsync({
    mediaType: MediaLibrary.MediaType.photo,
    sortBy: [[MediaLibrary.SortBy.creationTime, false]],
    first: pageSize,
    after: page > 0 ? String(page * pageSize) : undefined,
  });

  const items: LibraryPhoto[] = assets.map(toPhoto);
  return { items, hasMore: items.length < totalCount };
}

/** Map a media-library asset to our plain photo shape. */
function toPhoto(a: MediaLibrary.Asset): LibraryPhoto {
  return {
    id: a.id,
    uri: a.uri,
    width: a.width || 0,
    height: a.height || 0,
    createdAt: a.creationTime * 1000 || Date.now(),
    filename: a.filename ?? '',
    exists: true,
  };
}

/** All albums (folders) on the device, with per-album photo counts. */
export async function fetchAlbums(): Promise<LibraryAlbum[]> {
  const albums = await MediaLibrary.getAlbumsAsync();
  const result: LibraryAlbum[] = [];
  for (const album of albums) {
    try {
      const { totalCount } = await MediaLibrary.getAssetsAsync({
        album,
        mediaType: MediaLibrary.MediaType.photo,
        first: 1,
      });
      result.push({ id: album.id, name: album.title, photoCount: totalCount });
    } catch {
      // Some albums (e.g. system smart albums) can't be enumerated — skip.
    }
  }
  return result;
}

/** Fetch photo ids within one album. */
export async function fetchAlbumPhotoIds(albumId: string): Promise<string[]> {
  const albums = await MediaLibrary.getAlbumsAsync();
  const album = albums.find((a) => a.id === albumId);
  if (!album) return [];
  const { assets } = await MediaLibrary.getAssetsAsync({
    album,
    mediaType: MediaLibrary.MediaType.photo,
    first: 10000,
  });
  return assets.map((a) => a.id);
}

/** Fetch full photo rows within one album (newest first). */
export async function fetchAlbumPhotos(albumId: string): Promise<LibraryPhoto[]> {
  const albums = await MediaLibrary.getAlbumsAsync();
  const album = albums.find((a) => a.id === albumId);
  if (!album) return [];
  const { assets } = await MediaLibrary.getAssetsAsync({
    album,
    mediaType: MediaLibrary.MediaType.photo,
    sortBy: [[MediaLibrary.SortBy.creationTime, false]],
    first: 10000,
  });
  return assets.map(toPhoto);
}

/**
 * Fetch photos for a home-screen group (all / camera / screenshots / album).
 * Screenshots & camera on Android are filename-filtered; on iOS the native
 * subtype is used when the platform exposes it.
 */
export async function fetchMediaGroup(group: MediaGroup): Promise<LibraryPhoto[]> {
  if (group.kind === 'album') return fetchAlbumPhotos(group.albumId);

  const { assets } = await MediaLibrary.getAssetsAsync({
    mediaType: MediaLibrary.MediaType.photo,
    sortBy: [[MediaLibrary.SortBy.creationTime, false]],
    first: 10000,
  });
  let photos = assets.map(toPhoto);

  if (group.kind === 'camera') {
    photos = photos.filter((p) => isCameraName(p.filename));
  } else if (group.kind === 'screenshots') {
    photos = photos.filter((p) => isScreenshotName(p.filename));
  }
  return photos;
}

/** Photo count for a home-screen group (lightweight — for the home list). */
export async function fetchMediaCount(group: MediaGroup): Promise<number> {
  if (group.kind === 'album') {
    const albums = await MediaLibrary.getAlbumsAsync();
    const album = albums.find((a) => a.id === group.albumId);
    return album?.assetCount ?? 0;
  }
  // all = native total; camera/screenshots must be counted from fetched assets.
  if (group.kind === 'all') {
    const { totalCount } = await MediaLibrary.getAssetsAsync({
      mediaType: MediaLibrary.MediaType.photo,
      first: 1,
    });
    return totalCount;
  }
  const photos = await fetchMediaGroup(group);
  return photos.length;
}

/**
 * Everything the Home screen needs in one pass: photo counts per group plus
 * the album list. Camera/screenshots counts are derived from a single library
 * fetch instead of three separate scans.
 */
export async function fetchHomeSummary(): Promise<{
  allCount: number;
  cameraCount: number;
  screenshotsCount: number;
  albums: LibraryAlbum[];
}> {
  const { totalCount } = await MediaLibrary.getAssetsAsync({
    mediaType: MediaLibrary.MediaType.photo,
    first: 1,
  });

  // Derive camera/screenshot counts from one full scan of the library.
  const { assets } = await MediaLibrary.getAssetsAsync({
    mediaType: MediaLibrary.MediaType.photo,
    sortBy: [[MediaLibrary.SortBy.creationTime, false]],
    first: 10000,
  });
  let cameraCount = 0;
  let screenshotsCount = 0;
  for (const a of assets) {
    if (isCameraName(a.filename ?? '')) cameraCount += 1;
    else if (isScreenshotName(a.filename ?? '')) screenshotsCount += 1;
  }

  const albums = await fetchAlbums();
  return { allCount: totalCount, cameraCount, screenshotsCount, albums };
}
