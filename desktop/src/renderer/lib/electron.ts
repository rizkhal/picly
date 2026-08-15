import type { AuthStatus, Folder, LocalModels, Person, Photo, UpdateInfo } from '../types'

/** Safe accessor — returns undefined (never throws) when the bridge is missing. */
function bridge(): any {
  return (window as any).electron
}

/** Resolve a File object's real path (Electron 32+: File.path is gone). */
export function getPathForFile(file: File): string | null {
  const api = bridge()
  if (!api?.getPathForFile) return null
  try {
    return api.getPathForFile(file) || null
  } catch (e) {
    console.error('getPathForFile failed', e)
    return null
  }
}

/** Local store — folders / persons / photos / scans */
export const local = {
  async listFolders(): Promise<Folder[]> {
    const api = bridge()
    if (!api?.local?.listFolders) return []
    try {
      const rows = await api.local.listFolders()
      return (rows || []).map((f: any) => ({
        folder_id: f.folderId || f.folder_id,
        host_path: f.hostPath || f.host_path,
        name: f.name,
        photo_count: f.photoCount ?? f.photo_count ?? 0,
        container_path: f.hostPath || f.host_path,
        available: true,
      }))
    } catch (e) {
      console.error('Failed to load folders', e)
      return []
    }
  },

  async listPersons(showSingletons?: boolean): Promise<Person[]> {
    const api = bridge()
    if (!api?.local?.listPersons) return []
    try {
      const rows = await api.local.listPersons(showSingletons)
      return (rows || [])
        .filter((p: any) => (p.photoCount ?? p.photo_count ?? 0) > 0)
        .map((p: any) => ({ person_id: p.personId || p.person_id, name: p.name, photo_count: p.photoCount ?? p.photo_count ?? 0 }))
    } catch (e) {
      console.error('Failed to load persons', e)
      return []
    }
  },

  async listPersonPreviews(ids: string[]): Promise<Array<{ person_id: string; face_id?: string }>> {
    const api = bridge()
    if (!api?.local?.listPersonPreviews || ids.length === 0) return []
    try {
      const rows = await api.local.listPersonPreviews(ids)
      return (rows || []).map((f: any) => ({ person_id: f.personId || f.person_id, face_id: f.faceId || f.face_id || undefined }))
    } catch (e) {
      console.error('Failed to load person previews', e)
      return []
    }
  },

  async listNoFacePhotos(): Promise<Photo[]> {
    const api = bridge()
    if (!api?.local?.listNoFacePhotos) return []
    try {
      const rows = await api.local.listNoFacePhotos()
      return (rows || []).map((p: any) => ({ ...p, photo_id: p.photoId || p.photo_id, thumb_path: p.thumbUrl ?? p.thumbPath }))
    } catch (e) {
      console.error('Failed to load no-face photos', e)
      return []
    }
  },

  async countNoFacePhotos(): Promise<number> {
    const api = bridge()
    if (!api?.local?.countNoFacePhotos) return 0
    try {
      const n = await api.local.countNoFacePhotos()
      return typeof n === 'number' ? n : 0
    } catch (e) {
      console.error('countNoFacePhotos failed', e)
      return 0
    }
  },

  async listPhotos(personId?: string | null, diskPath?: string | null, folderPath?: string | null): Promise<Photo[]> {
    const api = bridge()
    if (!api?.local) return []
    try {
      if (personId) {
        const rows = await api.local.listPersonPhotos(personId)
        return (rows || []).map((p: any) => ({ ...p, photo_id: p.photoId || p.photo_id, thumb_path: p.thumbUrl ?? p.thumbPath, person_id: personId }))
      }
      if (folderPath) {
        const rows = await api.local.listPhotos(folderPath)
        return (rows || []).map((p: any) => ({ ...p, photo_id: p.photoId || p.photo_id, thumb_path: p.thumbUrl ?? p.thumbPath }))
      }
      const rows = await api.local.listPhotos()
      const all = (rows || []).map((p: any) => ({ ...p, photo_id: p.photoId || p.photo_id, thumb_path: p.thumbUrl ?? p.thumbPath }))
      if (diskPath && diskPath !== '/') return all.filter((p: any) => p.path?.startsWith(diskPath))
      return all
    } catch (e) {
      console.error('Failed to load photos', e)
      return []
    }
  },

  async photoFaces(photoId: string): Promise<Array<{ faceId: string; x1: number; y1: number; x2: number; y2: number; personId: string | null; personName: string | null; faceQuality: string; lowQuality: boolean; qualityScore: number }>> {
    /** Faces (bbox + person + quality) for one photo — used by the modal to draw the
     *  selected-person rectangle and the editable detail list. */
    const api = bridge()
    if (!api?.local?.photoFaces) return []
    try {
      return (await api.local.photoFaces(photoId)) || []
    } catch (e) {
      console.error('photoFaces failed', photoId, e)
      return []
    }
  },

  async scanFolder(hostPath: string): Promise<{ scanId: string } | null> {
    const api = bridge()
    if (!api?.local?.scanFolder) return null
    try {
      const data = await api.local.scanFolder(hostPath)
      return data?.scanId ? { scanId: data.scanId } : null
    } catch (e) {
      console.error('Scan failed for', hostPath, e)
      throw e
    }
  },

  async rescanFolder(hostPath: string): Promise<{ scanId: string } | null> {
    const api = bridge()
    if (!api?.local?.rescanFolder) return null
    try {
      const data = await api.local.rescanFolder(hostPath)
      return data?.scanId ? { scanId: data.scanId } : null
    } catch (e) {
      console.error('Rescan failed for', hostPath, e)
      throw e
    }
  },

  async cancelScan(scanId: string): Promise<void> {
    const api = bridge()
    if (!api?.local?.cancelScan) return
    try {
      await api.local.cancelScan(scanId)
    } catch (e) {
      console.error('cancelScan failed', scanId, e)
    }
  },

  async deleteFolder(hostPath: string): Promise<void> {
    const api = bridge()
    if (!api?.local?.deleteFolder) return
    try {
      await api.local.deleteFolder(hostPath)
    } catch (e) {
      console.error('deleteFolder failed', hostPath, e)
      throw e
    }
  },

  async renamePerson(personId: string, newName: string): Promise<void> {
    const api = bridge()
    if (!api?.local?.renamePerson) return
    try {
      await api.local.renamePerson(personId, newName)
    } catch (e) {
      console.error('renamePerson failed', personId, e)
    }
  },

  async mergePersons(targetId: string, sourceIds: string[]): Promise<number> {
    const api = bridge()
    if (!api?.local?.mergePersons) return 0
    try {
      const n = await api.local.mergePersons(targetId, sourceIds)
      return typeof n === 'number' ? n : 0
    } catch (e) {
      console.error('mergePersons failed', targetId, e)
      return 0
    }
  },

  async splitPerson(personId: string): Promise<number> {
    const api = bridge()
    if (!api?.local?.splitPerson) return 0
    try {
      const n = await api.local.splitPerson(personId)
      return typeof n === 'number' ? n : 0
    } catch (e) {
      console.error('splitPerson failed', personId, e)
      return 0
    }
  },

  async setFacePerson(faceId: string, personId: string | null): Promise<boolean> {
    const api = bridge()
    if (!api?.local?.setFacePerson) return false
    try {
      const ok = await api.local.setFacePerson(faceId, personId)
      return !!ok
    } catch (e) {
      console.error('setFacePerson failed', faceId, e)
      return false
    }
  },

  async assignFacesToPerson(sourcePersonId: string, targetPersonId: string): Promise<number> {
    const api = bridge()
    if (!api?.local?.assignFacesToPerson) return 0
    try {
      const n = await api.local.assignFacesToPerson(sourcePersonId, targetPersonId)
      return typeof n === 'number' ? n : 0
    } catch (e) {
      console.error('assignFacesToPerson failed', sourcePersonId, e)
      return 0
    }
  },

  async listFacesForPerson(personId: string): Promise<Array<{ faceId: string; photoPath: string | null; faceQuality: string }>> {
    const api = bridge()
    if (!api?.local?.listFacesForPerson) return []
    try {
      const rows = await api.local.listFacesForPerson(personId)
      return (rows || []).map((r: any) => ({
        faceId: r.faceId || r.face_id,
        photoPath: r.photoPath ?? r.photo_path ?? null,
        faceQuality: r.faceQuality ?? r.face_quality ?? 'medium',
      }))
    } catch (e) {
      console.error('listFacesForPerson failed', personId, e)
      return []
    }
  },

  async deletePhoto(photoId: string): Promise<void> {
    const api = bridge()
    if (!api?.local?.deletePhoto) return
    try {
      await api.local.deletePhoto(photoId)
    } catch (e) {
      console.error('deletePhoto failed', photoId, e)
    }
  },

  async trashPhotos(photoIds: string[]): Promise<void> {
    const api = bridge()
    if (!api?.local?.trashPhotos) return
    try {
      await api.local.trashPhotos(photoIds)
    } catch (e) {
      console.error('trashPhotos failed', photoIds.length, e)
    }
  },

  async listTrashedPhotos(): Promise<Photo[]> {
    const api = bridge()
    if (!api?.local?.listTrashedPhotos) return []
    try {
      const rows = await api.local.listTrashedPhotos()
      return (rows || []).map((p: any) => ({ ...p, photo_id: p.photoId || p.photo_id, thumb_path: p.thumbUrl ?? p.thumbPath }))
    } catch (e) {
      console.error('listTrashedPhotos failed', e)
      return []
    }
  },

  async countTrashed(): Promise<number> {
    const api = bridge()
    if (!api?.local?.countTrashed) return 0
    try {
      const n = await api.local.countTrashed()
      return typeof n === 'number' ? n : 0
    } catch (e) {
      console.error('countTrashed failed', e)
      return 0
    }
  },

  async restorePhoto(photoId: string): Promise<boolean> {
    const api = bridge()
    if (!api?.local?.restorePhoto) return false
    try {
      const ok = await api.local.restorePhoto(photoId)
      return !!ok
    } catch (e) {
      console.error('restorePhoto failed', photoId, e)
      return false
    }
  },

  async emptyTrash(): Promise<number> {
    const api = bridge()
    if (!api?.local?.emptyTrash) return 0
    try {
      const n = await api.local.emptyTrash()
      return typeof n === 'number' ? n : 0
    } catch (e) {
      console.error('emptyTrash failed', e)
      return 0
    }
  },

  async searchPhoto(filePath: string): Promise<any> {
    const api = bridge()
    if (!api?.local?.searchPhoto) return null
    return api.local.searchPhoto(filePath)
  },

  async stats(): Promise<unknown | null> {
    const api = bridge()
    if (!api?.local?.stats) return null
    try {
      return await api.local.stats()
    } catch (e) {
      console.error('stats failed', e)
      return null
    }
  },

  /** Subscribe to live scan progress. Returns an unsubscribe fn. */
  onScanProgress(listener: (p: any) => void): (() => void) | null {
    const api = bridge()
    if (!api?.local?.onScanProgress) return null
    return api.local.onScanProgress(listener)
  },
}

/** Auth */
export const auth = {
  async status(): Promise<AuthStatus> {
    const api = bridge()
    if (!api?.auth?.status) return { loggedIn: false, email: null }
    try {
      const s = await api.auth.status()
      return { loggedIn: !!s?.loggedIn, email: s?.email || null }
    } catch (e) {
      console.error('Failed to load auth status', e)
      return { loggedIn: false, email: null }
    }
  },
  async login(email: string, password: string): Promise<{ ok: boolean; email?: string; error?: string }> {
    const api = bridge()
    if (!api?.auth?.login) return { ok: false, error: 'Auth tidak tersedia' }
    try {
      return (await api.auth.login(email, password)) || { ok: false, error: 'Gagal. Coba lagi.' }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  },
  async register(email: string, password: string): Promise<{ ok: boolean; email?: string; error?: string }> {
    const api = bridge()
    if (!api?.auth?.register) return { ok: false, error: 'Auth tidak tersedia' }
    try {
      return (await api.auth.register(email, password)) || { ok: false, error: 'Gagal. Coba lagi.' }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  },
  async logout(): Promise<void> {
    const api = bridge()
    if (!api?.auth?.logout) return
    try {
      await api.auth.logout()
    } catch (e) {
      console.error('Logout failed', e)
    }
  },
  /** Get a fresh access token for authenticated backend calls (main does refresh). */
  async getAccessToken(): Promise<string | null> {
    const api = bridge()
    if (!api?.auth?.getAccessToken) return null
    try {
      const res = await api.auth.getAccessToken()
      return res?.ok ? (res.accessToken || null) : null
    } catch (e) {
      console.error('getAccessToken failed', e)
      return null
    }
  },
}

/** Updates — reachable when the backend is up (in-app update manifest). */
export const update = {
  async check(): Promise<UpdateInfo> {
    const api = bridge()
    if (!api?.checkUpdate) return { available: false, error: 'update_check_unavailable' }
    try {
      const res = await api.checkUpdate()
      // Network failure / backend down -> surface a clear, non-blocking error
      if (!res || typeof res.available !== 'boolean') {
        return { available: false, error: res?.error || 'Gagal menghubungi server' }
      }
      return res
    } catch (e) {
      return { available: false, error: e instanceof Error ? e.message : String(e) }
    }
  },
  async openPage(url: string): Promise<void> {
    const api = bridge()
    if (!api?.openUpdate) return
    try {
      await api.openUpdate(url)
    } catch (e) {
      console.error('Failed to open update page', e)
    }
  },
  /** ML models installed on this device (for Settings -> Model). */
  async localModels(): Promise<LocalModels | null> {
    const api = bridge()
    if (!api?.localModels) return null
    try {
      const res = await api.localModels()
      return res && typeof res === 'object' ? { detector: res.detector ?? null, recognizer: res.recognizer ?? null, quality: res.quality ?? null } : null
    } catch (e) {
      console.error('localModels failed', e)
      return null
    }
  },
}

/** Misc bridge (file picker, reveal in Finder) */
export const shell = {
  async selectFolder(): Promise<string[]> {
    const api = bridge()
    if (!api?.selectFolder) return []
    try {
      const paths = await api.selectFolder()
      return Array.isArray(paths) ? paths : []
    } catch (e) {
      console.error('Folder picker failed', e)
      return []
    }
  },
  async showItem(filePath: string): Promise<void> {
    const api = bridge()
    if (!api?.showItem) return
    try {
      await api.showItem(filePath)
    } catch (e) {
      console.error('Failed to open location', e)
    }
  },
}
