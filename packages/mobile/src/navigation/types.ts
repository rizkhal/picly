// Navigation route types. Screens receive their params through these.
import type { FaceBox } from '../types';

export type RootTabParamList = {
  PhotosTab: undefined;
  PeopleTab: undefined;
  SearchTab: undefined;
  SettingsTab: undefined;
};

export type RootStackParamList = {
  AuthFlow: undefined;
  Main: undefined;
  Onboarding: undefined;
  Auth: undefined;
  ScanProgress:
    | { mode?: 'all'; title?: string }
    | { mode: 'folder'; albumId: string; title: string }
    | undefined;
  PersonDetail: { personId: string };
  /** Fullscreen photo viewer for a person — swipe between their photos. */
  PersonPhotoViewer: {
    personId: string;
    personName: string;
    /** Photo uris (deduped), in grid order. */
    photoUris: string[];
    /** Initial photo index to show. */
    index: number;
    /** Normalized face boxes per photo uri (only this person's faces). */
    facesByPhoto: Record<string, FaceBox[]>;
  };
  /** photoId = media-library asset id. uri/width/height optional — when present
   * the detail screen renders immediately without a media-library lookup. */
  PhotoDetail: { photoId: string; uri?: string; width?: number; height?: number };
  /** Grid of photos for a home-screen group (all / camera / screenshots / album). */
  AlbumPhotos: {
    kind: 'all' | 'camera' | 'screenshots' | 'album';
    albumId?: string;
    title: string;
  };
  ManagePhotos: undefined;
  ManagePeople: undefined;
};
