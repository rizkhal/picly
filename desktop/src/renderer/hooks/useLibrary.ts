import { useCallback, useEffect, useRef, useState } from 'react'
import type { Disk, Folder, Person, PersonPreview, Photo, FaceBox } from '../types'
import * as ipc from '../lib/electron'

export function useLibrary() {
  const [persons, setPersons] = useState<Person[]>([])
  const [personPreviews, setPersonPreviews] = useState<PersonPreview[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [disks, setDisks] = useState<Disk[]>([])
  const [photos, setPhotos] = useState<Photo[]>([])
  const [gridFaceBoxes, setGridFaceBoxes] = useState<Record<string, FaceBox | null>>({})
  const [loading, setLoading] = useState(false)
  const [driveStatus, setDriveStatus] = useState('Checking...')

  // Track the current person/folder scope in a ref so the scan-completion
  // refresh always reloads what the user is actually looking at, not what was
  // selected when the scan started.
  const scopeRef = useRef<{ person: string | null; folder: string | null }>({ person: null, folder: null })

  // Load disks — real host mounts via Electron (no backend)
  const loadDisks = useCallback(async () => {
    const disks = await ipc.listDisks()
    if (disks.length > 0) setDisks(disks)
  }, [])

  // Load folders added via '+ Add folder' (local store)
  const loadFolders = useCallback(async () => {
    const rows = await ipc.local.listFolders()
    setFolders(rows)
  }, [])

  // Load persons (local store) + face crop previews (one representative face each)
  const loadPersons = useCallback(async () => {
    const livePersons = await ipc.local.listPersons()
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
  }, [])

  // Fetch the face box per photo when a person filter is active (grid highlight).
  // One batched IPC call — no per-photo round trips and no cap on photo count.
  const loadGridFaceBoxes = useCallback(async (personId: string, photos: Array<{ photo_id: string }>) => {
    const boxes = await ipc.local.faceBoxesForPerson(
      personId,
      photos.map((p) => p.photo_id),
    )
    setGridFaceBoxes(boxes)
  }, [])

  // Load photos for selected person, folder, disk, or all (local store)
  const loadPhotos = useCallback(async (personId?: string | null, diskPath?: string | null, folderPath?: string | null) => {
    setLoading(true)
    try {
      const rows = await ipc.local.listPhotos(personId, diskPath, folderPath)
      setPhotos(rows)
      // Person scope also refreshes the grid face-highlight boxes (same as the
      // original inline flow — keep them in sync when the filter changes).
      if (personId) {
        loadGridFaceBoxes(personId, rows)
      } else {
        // Non-person scope: drop stale highlight boxes from the previous filter/search.
        setGridFaceBoxes({})
      }
    } catch (e) {
      console.error('Failed to load photos', e)
    } finally {
      setLoading(false)
    }
  }, [loadGridFaceBoxes])

  // Search face — full local: detect ALL faces in the query photo, dedup per photo
  const searchFace = useCallback(async (file: File): Promise<{ photos: Photo[]; facesDetected: number | null; matchedPersons: string[] }> => {
    const filePath = (file as any).path
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
    // Highlight the matched face on each hit (same rectangle the person filter
    // uses) — the search hit already carries the box, no extra query needed.
    const boxes: Record<string, FaceBox | null> = {}
    for (const h of data.hits || []) {
      if (h.faceBox && h.photoId) {
        boxes[h.photoId] = { x1: h.faceBox.x1, y1: h.faceBox.y1, x2: h.faceBox.x2, y2: h.faceBox.y2 }
      }
    }
    setGridFaceBoxes(boxes)
    return {
      photos,
      facesDetected: data.facesDetected ?? null,
      matchedPersons: (data.hits || []).flatMap((h: any) => h.matchedPersons || []),
    }
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
    disks,
    photos,
    setPhotos,
    gridFaceBoxes,
    setGridFaceBoxes,
    loading,
    setLoading,
    driveStatus,
    scopeRef,
    loadDisks,
    loadFolders,
    loadPersons,
    loadPhotos,
    loadGridFaceBoxes,
    searchFace,
  }
}
