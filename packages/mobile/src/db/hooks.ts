// Small data hooks used across screens — keep query logic out of components.

import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import type { Face, Person, Photo } from '../types';
import { getPerson, listPersonFaces, listPersons, listPhotos, getPhoto, listUnassignedFaces } from '../db/store';
import { ensureClustered } from '../scanning/scanner';

export function usePersons() {
  const [persons, setPersons] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const rows = await listPersons();
      setPersons(rows);
    } finally {
      setLoading(false);
    }
  }, []);

  // Reload every time the screen regains focus (e.g. going back from a detail
  // screen after renaming a person), not only on first mount.
  useFocusEffect(
    useCallback(() => {
      // Faces scanned via photo-detail (scanSinglePhoto) or a re-cluster may
      // leave unassigned faces with embeddings — cluster them BEFORE the list
      // loads so the People tab is never empty after a scan.
      let mounted = true;
      (async () => {
        try {
          const created = await ensureClustered();
          if (mounted && created > 0) setLoading(true);
        } catch (err) {
          console.warn('[people] auto-cluster failed:', err);
        }
        if (mounted) await reload();
      })();
      return () => {
        mounted = false;
      };
    }, [reload]),
  );

  return { persons, loading, reload };
}

export function usePersonDetail(personId: string) {
  const [person, setPerson] = useState<Person | null>(null);
  const [faces, setFaces] = useState<Face[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const data = await getPerson(personId);
      setPerson(data?.person ?? null);
      setFaces(data?.faces ?? []);
    } finally {
      setLoading(false);
    }
  }, [personId]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { person, faces, loading, reload };
}

export function usePhotos() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      setPhotos(await listPhotos());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { photos, loading, reload };
}

export function usePersonFaces(personId: string) {
  const [faces, setFaces] = useState<Face[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      setFaces(await listPersonFaces(personId));
    } finally {
      setLoading(false);
    }
  }, [personId]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { faces, loading, reload };
}

export function usePhoto(photoId: string) {
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      setPhoto(await getPhoto(photoId));
    } finally {
      setLoading(false);
    }
  }, [photoId]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { photo, loading, reload };
}

export function useUnassignedFaces() {
  const [faces, setFaces] = useState<Face[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      setFaces(await listUnassignedFaces());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { faces, loading, reload };
}
