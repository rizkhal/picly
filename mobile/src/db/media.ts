// Media library access — wraps expo-media-library's legacy API (stable,
// returns assets with a ready-to-use `uri`) so screens get plain data.
// The new Query builder API was tried first, but it can't resolve display
// URIs cheaply (per-asset native calls), which caused empty-uri renders.

import * as MediaLibrary from 'expo-media-library/legacy';
import type { LibraryPhoto, LibraryAlbum } from '../types';

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

  const items: LibraryPhoto[] = assets.map((a) => ({
    id: a.id,
    uri: a.uri,
    width: a.width || 0,
    height: a.height || 0,
    createdAt: a.creationTime * 1000 || Date.now(),
    filename: a.filename ?? '',
    exists: true,
  }));
  return { items, hasMore: items.length < totalCount };
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
