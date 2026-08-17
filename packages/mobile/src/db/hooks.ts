// Small data hooks used across screens — keep query logic out of components.

import { useCallback, useEffect, useState } from 'react';
import type { Face, Person, Photo } from '../types';
import { getPerson, listPersonFaces, listPersons, listPhotos, getPhoto, listUnassignedFaces } from '../db/store';

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

  useEffect(() => {
    reload();
  }, [reload]);

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
