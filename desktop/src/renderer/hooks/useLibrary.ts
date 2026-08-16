import { useCallback, useEffect, useRef, useState } from 'react'
import type { Folder, Person, PersonPreview, Photo } from '../types'
import * as ipc from '../lib/electron'

export function useLibrary() {
  const [persons, setPersons] = useState<Person[]>([])
  const [personPreviews, setPersonPreviews] = useState<PersonPreview[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [photos, setPhotos] = useState<Photo[]>([])
  const [trashCount, setTrashCount] = useState(0)
  const [showSingletons, setShowSingletons] = useState(false)
  const [loading, setLoading] = useState(false)
  const [driveStatus, setDriveStatus] = useState('Checking...')
  const scopeRef = useRef<{ person: string | null; folder: string | null; trash: boolean }>({ person: null, folder: null, trash: false })

  // Load folders added via '+ Add folder' (local store)
  const loadFolders = useCallback(async () => {
    const rows = await ipc.local.listFolders()
    setFolders(rows)
  }, [])

  // Load trash count (sidebar badge) — refresh after scans/deletes/restores.
  const loadTrashCount = useCallback(async () => {
    const n = await ipc.local.countTrashed()
    setTrashCount(n)
  }, [])

  // Load persons (local store) + face crop previews (one representative face each)
  const loadPersons = useCallback(async () => {
    const livePersons = await ipc.local.listPersons(showSingletons)
    setPersons(livePersons)
    const previews: PersonPreview[] = []
    const ids = livePersons.map((p) => p.person_id)
    const faceRows = await ipc.local.listPersonPreviews(ids)
    const byId = new Map<string, { face_id?: string }>(faceRows.map((f) => [f.person_id, f]))
    for (const p of livePersons) {
      const face = byId.get(p.person_id)
      previews.push({ ...p, face_id: face?.face_id || undefined })
    }
    setPersonPreviews(previews)
  }, [showSingletons])

  // Persist the "show once-off persons" preference across restarts.
  useEffect(() => {
    try {
      const saved = localStorage.getItem('showSingletons')
      if (saved !== null) setShowSingletons(saved === '1')
    } catch { /* ignore */ }
  }, [])

  const toggleShowSingletons = useCallback(() => {
    setShowSingletons((prev) => {
      const next = !prev
      try { localStorage.setItem('showSingletons', next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }, [])
  const loadPhotos = useCallback(async (personId?: string | null, diskPath?: string | null, folderPath?: string | null) => {
    setLoading(true)
    try {
      const rows = await ipc.local.listPhotos(personId, diskPath, folderPath)
      setPhotos(rows)
    } catch (e) {
      console.error('Failed to load photos', e)
    } finally {
      setLoading(false)
    }
  }, [])

  // Load photos in the Trash (the "Trash" scope).
  const loadTrashPhotos = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await ipc.local.listTrashedPhotos()
      setPhotos(rows)
    } catch (e) {
      console.error('Failed to load trash photos', e)
    } finally {
      setLoading(false)
    }
  }, [])

  // Search face — full local: detect ALL faces in the query photo, dedup per photo
  const searchFace = useCallback(async (file: File): Promise<{ photos: Photo[]; facesDetected: number | null; matchedPersons: string[] }> => {
    const filePath = ipc.getPathForFile(file)
    if (!filePath) return { photos: [], facesDetected: null, matchedPersons: [] }
    const data = await ipc.local.searchPhoto(filePath)
    if (!data) return { photos: [], facesDetected: null, matchedPersons: [] }
    const photos = (data.hits || []).map((h: any) => ({
      photo_id: h.photoId || h.photo_id,
      path: h.path || '',
      thumb_path: h.thumbUrl ?? h.thumbPath,
      similarity: h.similarity,
      person_id: h.personId || h.person_id,
      person_name: h.personName,
      face_id: h.faceId || h.face_id,
      matched_persons: h.matchedPersons || [],
      width: h.faceBox?.width ?? null,
      height: h.faceBox?.height ?? null,
    }))
    return {
      photos,
      facesDetected: data.facesDetected ?? null,
      matchedPersons: (data.hits || []).flatMap((h: any) => h.matchedPersons || []),
    }
  }, [])

  // Global text search by person name — the whole library (ignores scope)
  const searchByName = useCallback(async (query: string): Promise<Photo[]> => {
    const q = query.trim()
    if (!q) return []
    const rows = await ipc.local.searchPhotosByName(q)
    return (rows || []).map((r: any) => ({
      photo_id: r.photoId || r.photo_id,
      path: r.path || '',
      thumb_path: r.thumbUrl ?? r.thumbPath,
      person_id: r.personId || r.person_id,
      person_name: r.personName || null,
      width: r.width ?? null,
      height: r.height ?? null,
    }))
  }, [])

  // Local services status — no backend health check needed (drive status shows
  // whether the store is ready; local scan/search work offline by design).
  useEffect(() => {
    let driveFailures = 0
    const checkLocal = async () => {
      try {
        const stats = await ipc.local.stats()
        driveFailures = 0
        setDriveStatus(stats ? 'Local ready' : 'Local unavailable')
      } catch {
        driveFailures += 1
        if (driveFailures >= 2) setDriveStatus('Local unavailable')
      }
    }
    checkLocal()
    const interval = setInterval(checkLocal, 10000)
    return () => clearInterval(interval)
  }, [])

  return {
    persons,
    personPreviews,
    folders,
    photos,
    setPhotos,
    trashCount,
    showSingletons,
    toggleShowSingletons,
    loading,
    setLoading,
    driveStatus,
    scopeRef,
    loadFolders,
    loadPersons,
    loadPhotos,
    loadTrashPhotos,
    loadTrashCount,
    searchFace,
    searchByName,
  }
}
