import type { AuthStatus, Disk, Folder, Person, Photo, UpdateInfo, FaceBox } from '../types'

/** Safe accessor — returns undefined (never throws) when the bridge is missing. */
function bridge(): any {
  return (window as any).electron
}

/** Disks (real host mounts via Electron) */
export async function listDisks(): Promise<Disk[]> {
  const api = bridge()
  if (!api?.listDisks) return []
  try {
    const disks = await api.listDisks()
    return Array.isArray(disks) ? disks : []
  } catch (e) {
    console.error('Failed to load disks', e)
    return []
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

  async listPersons(): Promise<Person[]> {
    const api = bridge()
    if (!api?.local?.listPersons) return []
    try {
      const rows = await api.local.listPersons()
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

  async faceBoxForPhoto(personId: string, photoId: string): Promise<FaceBox | null> {
    const api = bridge()
    if (!api?.local?.faceBoxForPhoto) return null
    try {
      const fb = await api.local.faceBoxForPhoto(personId, photoId)
      if (!fb) return null
      return { x1: fb.x1, y1: fb.y1, x2: fb.x2, y2: fb.y2 }
    } catch (e) {
      console.error('faceBoxForPhoto failed', photoId, e)
      return null
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

  async deletePhoto(photoId: string): Promise<void> {
    const api = bridge()
    if (!api?.local?.deletePhoto) return
    try {
      await api.local.deletePhoto(photoId)
    } catch (e) {
      console.error('deletePhoto failed', photoId, e)
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
}

/** Updates */
export const update = {
  async check(): Promise<UpdateInfo> {
    const api = bridge()
    if (!api?.checkUpdate) return { available: false }
    try {
      const res = await api.checkUpdate()
      return res || { available: false }
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
