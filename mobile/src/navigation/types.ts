// Navigation route types. Screens receive their params through these.
import type { Person } from '../types';

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
  PersonDetail: { person: Person };
  PhotoDetail: { photoId: string };
  ManagePhotos: undefined;
  ManagePeople: undefined;
};
