// Navigation route types. Screens receive their params through these.
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
  ScanProgress: { photoUri?: string } | undefined;
  PersonDetail: { personId: string };
  /** photoId = media-library asset id. uri/width/height optional — when present
   * the detail screen renders immediately without a media-library lookup. */
  PhotoDetail: { photoId: string; uri?: string; width?: number; height?: number };
  ManagePhotos: undefined;
  ManagePeople: undefined;
};
