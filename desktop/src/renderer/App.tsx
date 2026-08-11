import { useState, useEffect, useRef } from 'react'
import { ClockCounterClockwise, Video, MapPin, Trash, Folder, MagnifyingGlass, Camera, X } from '@phosphor-icons/react'

type Person = { person_id: string; name: string; photo_count: number }
type Photo = { photo_id: string; path: string; thumb_path?: string; similarity?: number; person_id?: string; person_name?: string; face_id?: string; matched_persons?: string[] }
type Disk = { name: string; path: string; free_gb?: number; total_gb?: number }
type Folder = { folder_id: string; host_path: string; container_path: string; name: string; photo_count: number; available: boolean }
type ScanProgress = {
  scan_id: string
  folder: string
  total: number
  processed: number
  scanned: number
  total_faces: number
  persons: number
  thumbs_generated: number
  errors: number
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled'
  current_file?: string | null
  started_at?: number
  finished_at?: number | null
}

export default function App() {
  const [persons, setPersons] = useState<Person[]>([])
  const [photos, setPhotos] = useState<Photo[]>([])
  const [selectedPerson, setSelectedPerson] = useState<string | null>(null)
  const [selectedDisk, setSelectedDisk] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null)
  const [driveStatus, setDriveStatus] = useState('Checking...')
  const [searchFile, setSearchFile] = useState<File | null>(null)
  const [searchFacesDetected, setSearchFacesDetected] = useState<number | null>(null)
  const [searchMatchedPersons, setSearchMatchedPersons] = useState<string[]>([])
  const [selectedView, setSelectedView] = useState<string>('recents')
  const [disks, setDisks] = useState<Disk[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [selectedFolder, setSelectedFolder] = useState<Folder | null>(null)
  const [personPreviews, setPersonPreviews] = useState<Array<{ person_id: string; name: string; photo_count: number; face_id?: string }>>([])
  const [activeScans, setActiveScans] = useState<ScanProgress[]>([])

  // Auth state (Fase 2: account/entitlement — local features don't require it)
  const [authStatus, setAuthStatus] = useState<{ loggedIn: boolean; email: string | null }>({ loggedIn: false, email: null })
  const [authModal, setAuthModal] = useState<'login' | 'register' | null>(null)
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

  // Update state (Fase 3: in-app update banner)
  const [updateInfo, setUpdateInfo] = useState<{ available: boolean; current?: string | null; latest?: string | null; url?: string | null; notes?: string[] | null; error?: string } | null>(null)
  const [updateDismissed, setUpdateDismissed] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const driveFailures = useRef(0)
  const scansRef = useRef<ScanProgress[]>([])

  // A scan is in flight until every tracked scan has finished
  const scanning = activeScans.some((s) => s.status === 'queued' || s.status === 'running')

  // Load disks — real host mounts via Electron (no backend)
  const loadDisks = async () => {
    try {
      const electronApi = (window as any).electron
      if (electronApi?.listDisks) {
        const disks = await electronApi.listDisks()
        if (disks && disks.length > 0) setDisks(disks)
      }
    } catch (e) {
      console.error('Failed to load disks', e)
    }
  }

  // Auth — load persisted status on mount
  const loadAuthStatus = async () => {
    try {
      const electronApi = (window as any).electron
      const s = await electronApi?.auth?.status()
      if (s) setAuthStatus({ loggedIn: !!s.loggedIn, email: s.email || null })
    } catch (e) {
      console.error('Failed to load auth status', e)
    }
  }

  const submitAuth = async (mode: 'login' | 'register') => {
    if (!authEmail || !authPassword) {
      setAuthError('Email dan password wajib diisi.')
      return
    }
    setAuthBusy(true)
    setAuthError(null)
    try {
      const electronApi = (window as any).electron
      const res = mode === 'login'
        ? await electronApi.auth.login(authEmail, authPassword)
        : await electronApi.auth.register(authEmail, authPassword)
      if (res?.ok) {
        setAuthStatus({ loggedIn: true, email: res.email || authEmail })
        setAuthModal(null)
        setAuthEmail('')
        setAuthPassword('')
      } else {
        setAuthError(res?.error || 'Gagal. Coba lagi.')
      }
    } catch (e: any) {
      setAuthError(e?.message || String(e))
    } finally {
      setAuthBusy(false)
    }
  }

  const handleLogout = async () => {
    try {
      const electronApi = (window as any).electron
      await electronApi?.auth?.logout()
      setAuthStatus({ loggedIn: false, email: null })
    } catch (e) {
      console.error('Logout failed', e)
    }
  }

  // Fase 3: check for an update on startup (backend serves the manifest)
  const checkForUpdate = async (silent = false) => {
    try {
      const electronApi = (window as any).electron
      if (!electronApi?.checkUpdate) return
      const res = await electronApi.checkUpdate()
      setUpdateInfo(res || { available: false })
      setUpdateDismissed(false)
      if (!silent && res?.error) console.warn('Update check failed:', res.error)
    } catch (e) {
      if (!silent) console.warn('Update check failed', e)
    }
  }

  const openUpdatePage = async () => {
    if (!updateInfo?.url) return
    try {
      const electronApi = (window as any).electron
      await electronApi?.openUpdate?.(updateInfo.url)
    } catch (e) {
      console.error('Failed to open update page', e)
    }
  }

  // Load folders added via '+ Add folder' (local store)
  const loadFolders = async () => {
    try {
      const electronApi = (window as any).electron
      if (!electronApi?.local?.listFolders) return
      const rows = await electronApi.local.listFolders()
      // Normalize snake_case (legacy) -> camelCase used by the UI
      setFolders((rows || []).map((f: any) => ({
        folder_id: f.folderId || f.folder_id,
        host_path: f.hostPath || f.host_path,
        name: f.name,
        photo_count: f.photoCount ?? f.photo_count ?? 0,
        container_path: f.hostPath || f.host_path,
        available: true,
      })))
    } catch (e) {
      console.error('Failed to load folders', e)
    }
  }

  // Load persons (local store) + face previews (first photo of each person)
  const loadPersons = async () => {
    try {
      const electronApi = (window as any).electron
      if (!electronApi?.local?.listPersons) return
      const rows = await electronApi.local.listPersons()
      const livePersons = (rows || [])
        .filter((p: any) => (p.photoCount ?? p.photo_count ?? 0) > 0)
        .map((p: any) => ({ person_id: p.personId || p.person_id, name: p.name, photo_count: p.photoCount ?? p.photo_count ?? 0 }))
      setPersons(livePersons)
      // Face previews: use the first photo thumbnail of each top person (local)
      const previews: Array<{ person_id: string; name: string; photo_count: number; face_id?: string }> = []
      const top = livePersons.slice().sort((a: any, b: any) => (b.photo_count || 0) - (a.photo_count || 0)).slice(0, 12)
      await Promise.all(top.map(async (p: any) => {
        try {
          const photos = await electronApi.local.listPersonPhotos(p.person_id, 1)
          if (photos && photos.length > 0 && photos[0].thumbUrl) {
            previews.push({ ...p, face_id: photos[0].photoId })
          } else {
            previews.push(p)
          }
        } catch {
          previews.push(p)
        }
      }))
      setPersonPreviews(previews)
    } catch (e) {
      console.error('Failed to load persons', e)
    }
  }

  // Search face — full local: detect ALL faces in the query photo, dedup per photo
  const searchFace = async () => {
    if (!searchFile) return
    setLoading(true)
    try {
      const electronApi = (window as any).electron
      if (!electronApi?.local?.searchPhoto) {
        setScanError('Search by image membutuhkan aplikasi desktop (local services).')
        return
      }
      const filePath = (searchFile as any).path
      const data = await electronApi.local.searchPhoto(filePath)
      setPhotos((data.hits || []).map((h: any) => ({
        photo_id: h.photoId,
        path: h.path,
        thumb_path: h.thumbUrl,
        similarity: h.similarity,
        person_id: h.personId,
        person_name: h.personName,
        matched_persons: h.matchedPersons || [],
      })))
      setSearchFacesDetected(data.facesDetected ?? null)
      setSearchMatchedPersons((data.hits || []).flatMap((h: any) => h.matchedPersons || []))
      setSelectedPerson(null)
      setSelectedDisk(null)
      setSelectedFolder(null)
      setSelectedView('')
    } catch (e) {
      console.error('Search failed', e)
      setScanError('Search gagal — coba lagi.')
    } finally {
      setLoading(false)
    }
  }

  // Add folder(s) — scan directly via local services (no backend); live progress
  // is streamed via the 'local:scan-progress' IPC event.
  const scanFolder = async () => {
    try {
      const electronApi = (window as any).electron
      if (!electronApi?.selectFolder || !electronApi?.local?.scanFolder) {
        setScanError('Folder scan hanya tersedia di aplikasi desktop — jalankan via `npm run electron:dev`.')
        return
      }
      const paths = await electronApi.selectFolder()
      if (!paths || paths.length === 0) return
      setScanError(null)
      const started: ScanProgress[] = []
      for (const hostPath of paths) {
        try {
          const data = await electronApi.local.scanFolder(hostPath)
          if (data?.scanId) {
            started.push({ scan_id: data.scanId, folder: hostPath, status: 'queued', total: 0, processed: 0, scanned: 0, total_faces: 0, persons: 0, thumbs_generated: 0, errors: 0 })
          }
        } catch (e) {
          console.error('Scan failed for', hostPath, e)
          setScanError(`Scan gagal untuk ${hostPath}`)
        }
      }
      if (started.length > 0) setActiveScans((prev) => [...prev, ...started])
    } catch (e) {
      console.error('Folder picker failed', e)
      setScanError('Gagal membuka folder picker.')
    }
  }

  // Stop a queued/running scan — local services check the flag between photos
  const stopScan = async (scanId: string) => {
    try {
      const electronApi = (window as any).electron
      await electronApi?.local?.cancelScan(scanId)
    } catch {
      // ignore — mark locally so the UI doesn't spin forever
    }
    const willAllBeTerminal = scansRef.current.every((s) =>
      s.scan_id === scanId || s.status === 'done' || s.status === 'error' || s.status === 'cancelled'
    )
    setActiveScans((prev) => prev.map((s) => (s.scan_id === scanId ? { ...s, status: 'cancelled' as const } : s)))
    if (willAllBeTerminal) {
      loadPersons()
      loadFolders()
      setTimeout(() => loadPhotos(scopeRef.current.person, null, scopeRef.current.folder), 300)
    }
  }

  // Remove an added folder and all photos indexed under it (local store)
  const removeFolder = async (folder: Folder) => {
    if (!confirm(`Remove "${folder.name}" and delete all ${folder.photo_count} indexed photos?`)) return
    const matching = scansRef.current.filter((s) =>
      s.folder === folder.container_path && (s.status === 'queued' || s.status === 'running')
    )
    for (const s of matching) stopScan(s.scan_id)
    try {
      const electronApi = (window as any).electron
      await electronApi?.local?.deleteFolder(folder.host_path)
    } catch (e) {
      console.error('Failed to remove folder', e)
      setScanError('Gagal menghapus folder.')
      return
    }
    if (selectedFolder?.folder_id === folder.folder_id) {
      setSelectedFolder(null)
      setPhotos([])
    }
    await loadFolders()
    await loadPersons()
    loadPhotos(scopeRef.current.person, null, scopeRef.current.folder)
  }

  // Rename person (local store)
  const renamePerson = async (personId: string, newName: string) => {
    try {
      const electronApi = (window as any).electron
      await electronApi?.local?.renamePerson(personId, newName)
      await loadPersons()
    } catch (e) {
      console.error('Rename failed', e)
    }
  }

  // Local services status — no backend health check needed (drive status shows
  // whether the store is ready; local scan/search work offline by design).
  useEffect(() => {
    const checkLocal = async () => {
      try {
        const electronApi = (window as any).electron
        const stats = await electronApi?.local?.stats()
        driveFailures.current = 0
        setDriveStatus(stats ? 'Local ready' : 'Local unavailable')
      } catch {
        driveFailures.current += 1
        if (driveFailures.current >= 2) setDriveStatus('Local unavailable')
      }
    }
    checkLocal()
    const interval = setInterval(checkLocal, 10000)
    return () => clearInterval(interval)
  }, [])

  // Track the current person/folder scope in a ref so the scan-completion
  // refresh always reloads what the user is actually looking at, not what was
  // selected when the scan started.
  const scopeRef = useRef<{ person: string | null; folder: string | null }>({ person: null, folder: null })
  useEffect(() => {
    scopeRef.current = { person: selectedPerson, folder: selectedFolder?.container_path || null }
  }, [selectedPerson, selectedFolder])

  // Re-attach to scans already running when the app (re)loaded — local scans are
  // in-process (main.cjs), so nothing to recover; kept as a no-op seam for the
  // future in-app update flow.
  const recoverScans = async () => {}

  // Load persons on mount
  useEffect(() => {
    loadDisks()
    loadPersons()
    loadFolders()
    loadAuthStatus()
    checkForUpdate(true)
    recoverScans()
  }, [])

  // Re-scan mounts when the window regains focus (drives can be plugged/unplugged)
  useEffect(() => {
    const onFocus = () => { loadDisks(); loadFolders(); recoverScans() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  // Keep a ref of current scans so handlers never read stale state
  useEffect(() => {
    scansRef.current = activeScans
  }, [activeScans])

  // Live scan progress — streamed from main.cjs via IPC events (no polling).
  // When all tracked scans reach a terminal state, refresh the UI.
  useEffect(() => {
    const electronApi = (window as any).electron
    if (!electronApi?.local?.onScanProgress) return
    const unsubscribe = electronApi.local.onScanProgress((p: any) => {
      const normalized = {
        scan_id: p.scanId || p.scan_id,
        folder: p.folder || '',
        total: p.total ?? 0,
        processed: p.processed ?? 0,
        scanned: p.scanned ?? 0,
        total_faces: p.totalFaces ?? p.total_faces ?? 0,
        persons: p.persons ?? 0,
        thumbs_generated: p.thumbsGenerated ?? p.thumbs_generated ?? 0,
        errors: p.errors ?? 0,
        status: p.status || 'running',
        current_file: p.currentFile ?? p.current_file ?? null,
      }
      setActiveScans((prev) => {
        const byId = new Map(prev.map((s) => [s.scan_id, s]))
        byId.set(normalized.scan_id, normalized)
        return Array.from(byId.values())
      })
      // Terminal state -> refresh index so the UI reflects the new scan
      if (p.status === 'done' || p.status === 'error' || p.status === 'cancelled') {
        loadPersons()
        loadFolders()
        setTimeout(() => {
          loadPhotos(scopeRef.current.person, null, scopeRef.current.folder)
        }, 300)
      }
    })
    return unsubscribe
  }, [])

  // Load photos for selected person, folder, disk, or all (local store)
  const loadPhotos = async (personId?: string | null, diskPath?: string | null, folderPath?: string | null) => {
    setLoading(true)
    try {
      const electronApi = (window as any).electron
      if (!electronApi?.local) return
      if (personId) {
        const rows = await electronApi.local.listPersonPhotos(personId)
        setPhotos((rows || []).map((p: any) => ({ ...p, photo_id: p.photoId, thumb_path: p.thumbUrl ?? p.thumbPath, person_id: personId })))
      } else if (folderPath) {
        const rows = await electronApi.local.listPhotos(folderPath)
        setPhotos((rows || []).map((p: any) => ({ ...p, photo_id: p.photoId, thumb_path: p.thumbUrl ?? p.thumbPath })))
      } else if (diskPath) {
        const rows = await electronApi.local.listPhotos()
        const all = (rows || []).map((p: any) => ({ ...p, photo_id: p.photoId, thumb_path: p.thumbUrl ?? p.thumbPath }))
        const filtered = diskPath === '/' ? all : all.filter((p: any) => p.path?.startsWith(diskPath))
        setPhotos(filtered)
      } else {
        const rows = await electronApi.local.listPhotos()
        setPhotos((rows || []).map((p: any) => ({ ...p, photo_id: p.photoId, thumb_path: p.thumbUrl ?? p.thumbPath })))
      }
    } catch (e) {
      console.error('Failed to load photos', e)
    } finally {
      setLoading(false)
    }
  }

  // Handle person selection
  const handlePersonClick = (personId: string) => {
    setSelectedView('')
    if (selectedPerson === personId) {
      setSelectedPerson(null)
      setSelectedDisk(null)
      setSelectedFolder(null)
      setPhotos([])
    } else {
      setSelectedPerson(personId)
      setSelectedDisk(null)
      setSelectedFolder(null)
      loadPhotos(personId)
    }
  }

  // Handle disk selection
  const handleDiskClick = (diskPath: string) => {
    setSelectedView('')
    if (selectedDisk === diskPath) {
      setSelectedDisk(null)
      setSelectedPerson(null)
      setSelectedFolder(null)
      setPhotos([])
    } else {
      setSelectedDisk(diskPath)
      setSelectedPerson(null)
      setSelectedFolder(null)
      loadPhotos(null, diskPath)
    }
  }

  // Handle folder selection — photos are scoped to this folder only
  const handleFolderClick = (folder: Folder) => {
    setSelectedView('')
    if (selectedFolder?.folder_id === folder.folder_id) {
      setSelectedFolder(null)
      setSelectedPerson(null)
      setSelectedDisk(null)
      setPhotos([])
    } else {
      setSelectedFolder(folder)
      setSelectedPerson(null)
      setSelectedDisk(null)
      loadPhotos(null, null, folder.container_path)
    }
  }

  // Handle sidebar collection click
  const selectView = (view: string) => {
    setSelectedView(view)
    setSelectedPerson(null)
    setSelectedDisk(null)
    setSelectedFolder(null)
    if (view === 'recents') loadPhotos()
    else setPhotos([])
  }

  // Handle search file selection
  const handleSearchFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setSearchFile(file)
      searchFace()
    }
  }

  // Map face previews (top persons) by id so sidebar rows can show avatars
  const previewById = new Map(personPreviews.map(p => [p.person_id, p]))

  return (
    <div className="app">
      {/* Sidebar */}
      <div className="sidebar">
        <div className="sidebar-header">
          <div className="logo">Picly</div>
        </div>

        {scanError && (
          <div className="scan-error" style={{ color: '#e5484d', fontSize: '13px', padding: '6px 10px' }}>
            {scanError}
          </div>
        )}

        {/* Collections + Folders scroll together; sidebar-bottom stays pinned */}
        <div className="sidebar-scroll">
        {/* Collections */}
        <div className="sidebar-section">
          <div className="sidebar-section-title">Collections</div>
          <div className="nav-list">
            <div className={`nav-item ${selectedView === 'recents' ? 'active' : ''}`} onClick={() => selectView('recents')}>
              <ClockCounterClockwise size={16} className="nav-icon" /><span>Recents</span>
            </div>
            <div className={`nav-item ${selectedView === 'videos' ? 'active' : ''}`} onClick={() => selectView('videos')}>
              <Video size={16} className="nav-icon" /><span>Videos</span>
            </div>
            <div className={`nav-item ${selectedView === 'places' ? 'active' : ''}`} onClick={() => selectView('places')}>
              <MapPin size={16} className="nav-icon" /><span>Places</span>
            </div>
            <div className={`nav-item ${selectedView === 'trash' ? 'active' : ''}`} onClick={() => selectView('trash')}>
              <Trash size={16} className="nav-icon" /><span>Trash</span>
            </div>
          </div>
        </div>

        {/* Folders added via '+ Add folder' */}
        <div className="sidebar-section">
          <div className="sidebar-section-title-row">
            <div className="sidebar-section-title">Folders</div>
            <button className="add-folder-text-btn" onClick={scanFolder} disabled={scanning}>
              {scanning ? (<><span className="btn-spinner" />Scanning…</>) : '+ Add folder'}
            </button>
          </div>
          <div className="nav-list">
            {folders.map((folder) => (
              <div
                key={folder.folder_id}
                className={`nav-item ${selectedFolder?.folder_id === folder.folder_id ? 'active' : ''} ${folder.available ? '' : 'unavailable'}`}
                onClick={() => handleFolderClick(folder)}
                title={folder.host_path}
              >
                <Folder size={16} className="nav-icon" />
                <div className="disk-info">
                  <div className="disk-name">{folder.name}</div>
                  <div className="disk-space">{folder.photo_count} photos{folder.available ? '' : ' · offline'}</div>
                </div>
                <div className="row-actions">
                  <button
                    className="row-action-btn"
                    title="Remove folder and its indexed photos"
                    onClick={(e) => { e.stopPropagation(); removeFolder(folder) }}
                  >
                    <Trash size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
        </div>

        {/* Bottom: pinned disk list + API status */}
        <div className="sidebar-bottom">
          {disks.length > 0 && (
            <div className="sidebar-section">
              <div className="sidebar-section-title">Disk</div>
              <div className="nav-list">
                {disks.map((disk) => (
                  <div
                    key={disk.path}
                    className={`nav-item ${selectedDisk === disk.path ? 'active' : ''}`}
                    onClick={() => handleDiskClick(disk.path)}
                  >
                    <Folder size={16} className="nav-icon" />
                    <div className="disk-info">
                      <div className="disk-name">{disk.name}</div>
                      <div className="disk-space">{disk.free_gb ?? ''}{disk.free_gb !== undefined ? ' GB free' : ''}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="sidebar-footer">
            <div>Status: {driveStatus}</div>
            <div style={{ marginTop: 4 }}>{persons.length} persons indexed</div>
            {/* Account (auth — optional, entitlement only) */}
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              {authStatus.loggedIn ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
                  <div style={{ fontSize: 12, opacity: 0.85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {authStatus.email}
                  </div>
                  <button
                    onClick={handleLogout}
                    style={{ fontSize: 11, background: 'none', border: 'none', color: '#8b8b8b', cursor: 'pointer', padding: 0 }}
                    title="Log out"
                  >Logout</button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={() => { setAuthModal('login'); setAuthError(null) }}
                    style={{ flex: 1, fontSize: 12, padding: '4px 8px', borderRadius: 6, background: '#2a2a2a', border: '1px solid #3a3a3a', color: '#e8e8e8', cursor: 'pointer' }}
                  >Login</button>
                  <button
                    onClick={() => { setAuthModal('register'); setAuthError(null) }}
                    style={{ flex: 1, fontSize: 12, padding: '4px 8px', borderRadius: 6, background: 'none', border: '1px solid #3a3a3a', color: '#8b8b8b', cursor: 'pointer' }}
                  >Register</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="main">
        {/* Update banner — a newer release is available (v1: opens GitHub in browser) */}
        {updateInfo?.available && !updateDismissed && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: 'linear-gradient(135deg, #1a3a5c, #2d5a8a)', borderBottom: '1px solid rgba(255,255,255,0.1)', fontSize: 13 }}>
            <div style={{ flex: 1 }}>
              <strong>Update tersedia — Picly {updateInfo.latest}</strong>
              {updateInfo.current && <span style={{ opacity: 0.7, marginLeft: 8 }}>(kamu punya {updateInfo.current})</span>}
            </div>
            <button
              onClick={openUpdatePage}
              style={{ padding: '6px 14px', borderRadius: 6, background: '#fff', border: 'none', color: '#1a3a5c', fontWeight: 600, cursor: 'pointer', fontSize: 12 }}
            >Update</button>
            <button
              onClick={() => setUpdateDismissed(true)}
              style={{ padding: 6, borderRadius: 6, background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)', cursor: 'pointer', fontSize: 13 }}
              title="Tutup"
            >✕</button>
          </div>
        )}
        {/* Scan progress banner — prominent, above the toolbar */}
        {activeScans.length > 0 && (
          <div className="scan-progress">
            <div className="scan-progress-header">
              <span>{scanning ? 'Scanning photos…' : 'Recent scans'}</span>
              <span>{scanning
                ? `${activeScans.filter((s) => s.status === 'queued' || s.status === 'running').length} folder${activeScans.filter((s) => s.status === 'queued' || s.status === 'running').length === 1 ? '' : 's'} active`
                : 'all done'}</span>
            </div>
            {activeScans.map((s) => {
              const total = s.total || 0
              const processed = s.processed || 0
              const pct = total > 0
                ? Math.min(100, Math.round((processed / total) * 100))
                : (s.status === 'done' || s.status === 'error' ? 100 : 0)
              const name = (s.folder || '').split('/').filter(Boolean).pop() || 'Folder'
              const isQueued = s.status === 'queued'
              const isRunning = s.status === 'running'
              const isDone = s.status === 'done'
              const isError = s.status === 'error'
              const isCancelled = s.status === 'cancelled'
              return (
                <div key={s.scan_id} className="scan-item">
                  <div className="scan-item-top">
                    <span className="scan-folder-name" title={s.folder}>{name}</span>
                    <div className="scan-item-actions">
                      <span className="scan-item-status">
                        {isDone ? `✓ ${s.scanned} photos` : isCancelled ? 'Stopped' : isError ? 'Failed' : `${processed}/${total}`}
                      </span>
                      {(isQueued || isRunning) && (
                        <button className="scan-stop-btn" title="Stop scan" onClick={() => stopScan(s.scan_id)}>
                          <X size={11} weight="bold" />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="progress-bar">
                    <div
                      className={`progress-fill${isDone ? ' done' : ''}${isError ? ' error' : ''}${isCancelled ? ' cancelled' : ''}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="scan-item-sub">
                    {isRunning && s.current_file ? (
                      <span className="scan-current" title={s.current_file}>{s.current_file.split('/').pop()}</span>
                    ) : isQueued ? (
                      <span>Waiting for a previous scan to finish…</span>
                    ) : isDone ? (
                      <span className="scan-done-line">
                        {s.scanned} new · {s.total_faces} faces · {s.persons} persons
                        {s.errors ? ` · ${s.errors} errors` : ''}
                      </span>
                    ) : isCancelled ? (
                      <span className="scan-cancelled-line">Stopped at {processed} of {total} files</span>
                    ) : isError ? (
                      <span className="scan-error-line">Scan failed{s.errors ? ` (${s.errors} errors)` : ''}</span>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <div className="toolbar">
          <input
            type="file"
            ref={fileInputRef}
            className="search-file-input"
            accept="image/*"
            onChange={handleSearchFileChange}
          />
          <div className="search-wrap">
            <MagnifyingGlass size={14} className="search-icon" />
            <input
              type="text"
              className="search-input"
              placeholder="Search your photos…"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                const q = e.target.value.toLowerCase()
                if (q) {
                  setPhotos(prev => prev.filter(p => p.path.toLowerCase().includes(q)))
                } else {
                  loadPhotos(selectedPerson || null, selectedDisk || null, selectedFolder?.container_path || null)
                }
              }}
            />
            <button
              className="btn search-image-btn"
              onClick={() => fileInputRef.current?.click()}
              title="Search by image"
            >
              <Camera size={18} />
            </button>
          </div>
        </div>


        {/* Face avatar rail — horizontal scroll nav above the grid */}
        {persons.length > 0 && (
          <div className="faces-bar">
            {persons.map((person) => {
              const preview = previewById.get(person.person_id)
              const size = Math.min(48, 32 + (person.photo_count || 1) * 1.2)
              return (
                <div
                  key={person.person_id}
                  className={`face-chip ${selectedPerson === person.person_id ? 'active' : ''}`}
                  onClick={() => handlePersonClick(person.person_id)}
                  title={`${person.name} — ${person.photo_count} photos`}
                >
                  <img
                    className="face-chip-img"
                    style={{ width: size, height: size }}
                    src={
                      preview?.face_id
                        ? `picly://thumb/${preview.face_id}.jpg`
                        : `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'><rect width='100%25' height='100%25' fill='%23222'/><text x='50%25' y='54%25' font-size='18' fill='%233b82f6' text-anchor='middle' font-family='sans-serif'>${person.name.charAt(0).toUpperCase()}</text></svg>`
                    }
                    alt={person.name}
                  />
                </div>
              )
            })}
          </div>
        )}

        <div className="content">
          {loading ? (
            <div className="loading-overlay">
              <div className="spinner" />
            </div>
          ) : photos.length === 0 ? (
            <div className="empty">
              <h3>No photos to show</h3>
              <p>Scan a folder or search by face to get started.</p>
            </div>
          ) : (
            <>
              {searchFacesDetected !== null && (
                <div className="search-summary">
                  <span className="search-summary-title">
                    {searchFacesDetected} face{searchFacesDetected === 1 ? '' : 's'} detected
                  </span>
                  {searchMatchedPersons.length > 0 && (
                    <span className="search-summary-persons">
                      {[...new Set(searchMatchedPersons)].map((name) => (
                        <span key={name} className="matched-person-chip">{name}</span>
                      ))}
                    </span>
                  )}
                </div>
              )}
              <div className="photo-grid">
                {photos.map((photo) => (
                  <div
                    key={photo.photo_id}
                    className="photo-card"
                    onClick={() => setSelectedPhoto(photo)}
                  >
                    <img
                      src={photo.thumb_path || `picly://thumb/${photo.photo_id}.jpg`}
                      alt=""
                      loading="lazy"
                    />
                    {photo.face_id && (
                      <img
                        className="face-overlay"
                        src={`picly://thumb/${photo.face_id}.jpg`}
                        alt=""
                        loading="lazy"
                      />
                    )}
                    {photo.similarity !== undefined && (
                      <div className="similarity">{Math.round(photo.similarity * 100)}%</div>
                    )}
                    {photo.person_id && (
                      <div className="person-badge">
                        {persons.find(p => p.person_id === photo.person_id)?.name || 'Unknown'}
                      </div>
                    )}
                    {photo.matched_persons && photo.matched_persons.length > 0 && (
                      <div className="matched-persons-badge">
                        {photo.matched_persons.join(' · ')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Photo modal */}
      {selectedPhoto && (
        <div className="modal-overlay" onClick={() => setSelectedPhoto(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Photo</div>
              <button className="modal-close" onClick={() => setSelectedPhoto(null)}>×</button>
            </div>
            <div className="modal-body">
              <img
                className="modal-image"
                src={selectedPhoto.thumb_path || `picly://thumb/${selectedPhoto.photo_id}.jpg`}
                alt=""
              />
              <div className="modal-meta">
                <div>ID: {selectedPhoto.photo_id}</div>
                <div>Path: {selectedPhoto.path}</div>
                {selectedPhoto.similarity !== undefined && (
                  <div>Similarity: {Math.round(selectedPhoto.similarity * 100)}%</div>
                )}
                {selectedPhoto.person_id && (
                  <div>Person: {persons.find(p => p.person_id === selectedPhoto.person_id)?.name || 'Unknown'}</div>
                )}
              </div>
            </div>
            <div className="modal-actions">
              <button
                className="btn"
                onClick={() => {
                  const newName = prompt('Rename person:')
                  if (newName && selectedPhoto.person_id) {
                    renamePerson(selectedPhoto.person_id, newName)
                  }
                }}
              >
                Rename person
              </button>
              <button
                className="btn btn-danger"
                onClick={async () => {
                  try {
                    const electronApi = (window as any).electron
                    await electronApi?.local?.deletePhoto(selectedPhoto.photo_id)
                  } catch (e) {
                    console.error('Delete photo failed', e)
                  }
                  setSelectedPhoto(null)
                  loadPhotos(selectedPerson, null, selectedFolder?.container_path || null)
                  loadPersons()
                  loadFolders()
                }}
              >
                Delete photo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Auth modal — login / register (account is optional; local features don't require it) */}
      {authModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setAuthModal(null)}>
          <div
            style={{ background: '#1e1e1e', border: '1px solid #333', borderRadius: 12, padding: 24, width: 340, boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>
              {authModal === 'login' ? 'Masuk' : 'Buat Akun'}
            </div>
            <div style={{ fontSize: 12, color: '#8b8b8b', marginBottom: 16 }}>
              Akun untuk entitlement & update. Foto tetap 100% lokal di device ini.
            </div>

            <label style={{ fontSize: 12, color: '#a0a0a0', display: 'block', marginBottom: 4 }}>Email</label>
            <input
              type="email"
              value={authEmail}
              onChange={(e) => setAuthEmail(e.target.value)}
              placeholder="kamu@email.com"
              style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8, background: '#141414', border: '1px solid #3a3a3a', color: '#e8e8e8', fontSize: 14, marginBottom: 12, outline: 'none' }}
            />

            <label style={{ fontSize: 12, color: '#a0a0a0', display: 'block', marginBottom: 4 }}>Password</label>
            <input
              type="password"
              value={authPassword}
              onChange={(e) => setAuthPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !authBusy) submitAuth(authModal) }}
              placeholder="Minimal 8 karakter"
              style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8, background: '#141414', border: '1px solid #3a3a3a', color: '#e8e8e8', fontSize: 14, marginBottom: 12, outline: 'none' }}
            />

            {authError && (
              <div style={{ fontSize: 12, color: '#e5484d', marginBottom: 10 }}>{authError}</div>
            )}

            <button
              onClick={() => submitAuth(authModal)}
              disabled={authBusy}
              style={{ width: '100%', padding: '10px', borderRadius: 8, background: '#4a7cff', border: 'none', color: '#fff', fontSize: 14, fontWeight: 600, cursor: authBusy ? 'default' : 'pointer', opacity: authBusy ? 0.6 : 1 }}
            >
              {authBusy ? 'Memproses…' : authModal === 'login' ? 'Masuk' : 'Daftar'}
            </button>

            <div style={{ marginTop: 12, fontSize: 12, textAlign: 'center', color: '#8b8b8b' }}>
              {authModal === 'login' ? (
                <>Belum punya akun?{' '}
                  <span style={{ color: '#4a7cff', cursor: 'pointer' }} onClick={() => { setAuthModal('register'); setAuthError(null) }}>Daftar</span>
                </>
              ) : (
                <>Sudah punya akun?{' '}
                  <span style={{ color: '#4a7cff', cursor: 'pointer' }} onClick={() => { setAuthModal('login'); setAuthError(null) }}>Masuk</span>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
