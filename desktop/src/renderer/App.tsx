import { useState, useEffect, useRef } from 'react'
import { ClockCounterClockwise, Video, MapPin, Trash, Folder, MagnifyingGlass, Camera, X } from '@phosphor-icons/react'

let API_BASE = 'http://localhost:8000'
let API_KEY = ''

// electron preload exposes IPC wrappers that return Promises — resolve them once.
const electronApi = (window as any).electron
if (electronApi?.getApiBase) {
  electronApi.getApiBase().then((b: string) => { API_BASE = b })
  electronApi.getApiKey().then((k: string) => { API_KEY = k })
}

const jsonHeaders = () => ({
  'Content-Type': 'application/json',
  'X-API-Key': API_KEY,
})

const multipartHeaders = () => ({
  'X-API-Key': API_KEY,
})

type Person = { person_id: string; name: string; photo_count: number }
type Photo = { photo_id: string; path: string; thumb_path?: string; similarity?: number; person_id?: string; face_id?: string }
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
  const [selectedView, setSelectedView] = useState<string>('recents')
  const [disks, setDisks] = useState<Disk[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [selectedFolder, setSelectedFolder] = useState<Folder | null>(null)
  const [personPreviews, setPersonPreviews] = useState<Array<{ person_id: string; name: string; photo_count: number; face_id?: string }>>([])
  const [activeScans, setActiveScans] = useState<ScanProgress[]>([])

  const fileInputRef = useRef<HTMLInputElement>(null)
  const driveFailures = useRef(0)
  const scansRef = useRef<ScanProgress[]>([])

  // A scan is in flight until every tracked scan has finished
  const scanning = activeScans.some((s) => s.status === 'queued' || s.status === 'running')

  // Load disks — prefer real host mounts via Electron, fall back to API
  const loadDisks = async () => {
    try {
      const electronApi = (window as any).electron
      if (electronApi?.listDisks) {
        const disks = await electronApi.listDisks()
        if (disks && disks.length > 0) { setDisks(disks); return }
      }
      const res = await fetch(`${API_BASE}/disks`, { headers: jsonHeaders() })
      const data = await res.json()
      setDisks(data.roots || [])
    } catch (e) {
      console.error('Failed to load disks', e)
    }
  }

  // Load folders added via '+ Add folder'
  const loadFolders = async () => {
    try {
      const res = await fetch(`${API_BASE}/folders`, { headers: jsonHeaders() })
      const data = await res.json()
      setFolders(data.folders || [])
    } catch (e) {
      console.error('Failed to load folders', e)
    }
  }

  // Load persons
  const loadPersons = async () => {
    try {
      const res = await fetch(`${API_BASE}/person`, { headers: jsonHeaders() })
      const data = await res.json()
      // Only keep persons that still have photos (deleted ones should vanish from the face rail)
      const livePersons = (data.persons || []).filter((p: any) => (p.photo_count || 0) > 0)
      setPersons(livePersons)
      const sorted = livePersons.slice().sort((a: any, b: any) => (b.photo_count || 0) - (a.photo_count || 0))
      // Load face previews for top persons
      const previewIds = sorted.slice(0, 12).map((p: any) => p.person_id)
      if (previewIds.length) {
        try {
          const res2 = await fetch(`${API_BASE}/person/previews?limit=12`, { headers: jsonHeaders() })
          const data2 = await res2.json()
          setPersonPreviews(data2.persons || [])
        } catch (e) {
          console.error('Failed to load person previews', e)
        }
      }
    } catch (e) {
      console.error('Failed to load persons', e)
    }
  }

  // Search face
  const searchFace = async () => {
    if (!searchFile) return
    setLoading(true)
    try {
      const form = new FormData()
      form.append('file', searchFile)
      form.append('threshold', '0.5')
      form.append('limit', '50')
      const res = await fetch(`${API_BASE}/search`, { method: 'POST', headers: multipartHeaders(), body: form })
      const data = await res.json()
      setPhotos(data.results || [])
      setSelectedPerson(null)
      setSelectedDisk(null)
      setSelectedFolder(null)
    } catch (e) {
      console.error('Search failed', e)
    } finally {
      setLoading(false)
    }
  }

  // Add folder(s) — every picked folder is mapped to the container path and
  // scanned in the background; live progress is polled from /scan/status/{id}.
  const scanFolder = async () => {
    try {
      const electronApi = (window as any).electron
      if (!electronApi?.selectFolder) {
        setScanError('Folder picker hanya tersedia di aplikasi desktop — jalankan via `npm run electron:dev`.')
        return
      }
      const paths = await electronApi.selectFolder()
      if (!paths || paths.length === 0) return
      setScanError(null)
      const started: ScanProgress[] = []
      for (const folder of paths) {
        if (folder.startsWith('MAPPING_ERROR:')) {
          const rest = folder.slice('MAPPING_ERROR:'.length)
          // Split on the LAST colon — host paths may themselves contain ':'
          const sep = rest.lastIndexOf(':')
          const hostPath = sep === -1 ? rest : rest.slice(0, sep)
          const msg = sep === -1 ? 'unknown error' : rest.slice(sep + 1)
          setScanError(`Could not add folder ${hostPath}: ${msg}`)
          continue
        }
        const form = new FormData()
        form.append('folder', folder)
        const res = await fetch(`${API_BASE}/scan`, { method: 'POST', headers: multipartHeaders(), body: form })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          setScanError((err as any).detail || `Scan failed (HTTP ${res.status})`)
          continue
        }
        const data = await res.json()
        if (!data || !data.scan_id) {
          setScanError('Backend masih versi lama — restart container API dulu (docker compose restart api) supaya scan progress aktif.')
          continue
        }
        started.push(data)
      }
      if (started.length > 0) {
        setActiveScans((prev) => [...prev, ...started])
      }
    } catch (e) {
      setScanError('Could not reach API — is the backend running?')
    }
  }

  // Stop a queued/running scan — backend checks the flag between photos
  const stopScan = async (scanId: string) => {
    try {
      await fetch(`${API_BASE}/scan/${scanId}/cancel`, { method: 'POST', headers: jsonHeaders() })
    } catch {
      // backend unreachable — mark locally so the UI doesn't spin forever
    }
    const willAllBeTerminal = scansRef.current.every((s) =>
      s.scan_id === scanId || s.status === 'done' || s.status === 'error' || s.status === 'cancelled'
    )
    setActiveScans((prev) => prev.map((s) => (s.scan_id === scanId ? { ...s, status: 'cancelled' as const } : s)))
    if (willAllBeTerminal) {
      // polling exits (scanning flips false) before it can fire the completion
      // refresh — reload now so photos indexed so far show up
      loadPersons()
      loadFolders()
      setTimeout(() => loadPhotos(scopeRef.current.person, null, scopeRef.current.folder), 300)
    }
  }

  // Remove an added folder and all photos indexed under it
  const removeFolder = async (folder: Folder) => {
    if (!confirm(`Remove "${folder.name}" and delete all ${folder.photo_count} indexed photos?`)) return
    // Cancel any in-flight scan for this folder so it stops committing photos
    const matching = scansRef.current.filter((s) =>
      s.folder === folder.container_path && (s.status === 'queued' || s.status === 'running')
    )
    for (const s of matching) stopScan(s.scan_id)
    try {
      const res = await fetch(`${API_BASE}/folder/${folder.folder_id}`, { method: 'DELETE', headers: jsonHeaders() })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        const detail = (err as any).detail || `HTTP ${res.status}`
        setScanError(detail === 'Not Found'
          ? 'Backend is outdated — rebuild the API container (docker compose up -d --build) so folder removal is available.'
          : `Could not remove folder: ${detail}`)
        return
      }
    } catch (e) {
      console.error('Failed to remove folder', e)
      setScanError('Could not remove folder — API unreachable.')
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

  // Rename person
  const renamePerson = async (personId: string, newName: string) => {
    try {
      await fetch(`${API_BASE}/person/${personId}/rename`, {
        method: 'PATCH',
        headers: jsonHeaders(),
        body: JSON.stringify({ name: newName }),
      })
      await loadPersons()
    } catch (e) {
      console.error('Rename failed', e)
    }
  }

  // Check drive status
  useEffect(() => {
    const checkDrive = async () => {
      try {
        const res = await fetch(`${API_BASE}/health`, { headers: jsonHeaders(), signal: AbortSignal.timeout(5000) })
        const data = await res.json()
        driveFailures.current = 0
        setDriveStatus(data.database === 'connected' ? 'API connected' : 'API disconnected')
      } catch {
        // keep last good status on a single failure; only declare unreachable
        // after two consecutive failures (covers the API's cold-start window)
        driveFailures.current += 1
        if (driveFailures.current >= 2) setDriveStatus('API unreachable')
      }
    }
    checkDrive()
    const interval = setInterval(checkDrive, 10000)
    return () => clearInterval(interval)
  }, [])

  // Track the current person/folder scope in a ref so the scan-completion
  // refresh always reloads what the user is actually looking at, not what was
  // selected when the scan started.
  const scopeRef = useRef<{ person: string | null; folder: string | null }>({ person: null, folder: null })
  useEffect(() => {
    scopeRef.current = { person: selectedPerson, folder: selectedFolder?.container_path || null }
  }, [selectedPerson, selectedFolder])

  // Re-attach to scans that were already running when the app (re)loaded
  const recoverScans = async () => {
    try {
      const res = await fetch(`${API_BASE}/scan/status`, { headers: jsonHeaders() })
      if (!res.ok) return
      const data = await res.json()
      const active = (data.scans || []).filter((s: ScanProgress) => s.status === 'queued' || s.status === 'running')
      if (active.length > 0) {
        // Merge by scan_id (prefer the live status) so a scan is never duplicated
        setActiveScans((prev) => {
          const byId = new Map(prev.map((s) => [s.scan_id, s]))
          for (const a of active) byId.set(a.scan_id, a)
          return Array.from(byId.values())
        })
      }
    } catch {
      // backend not reachable — nothing to recover
    }
  }

  // Load persons on mount
  useEffect(() => {
    loadDisks()
    loadPersons()
    loadFolders()
    recoverScans()
  }, [])

  // Re-scan mounts when the window regains focus (drives can be plugged/unplugged)
  useEffect(() => {
    const onFocus = () => { loadDisks(); loadFolders(); recoverScans() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  // Keep a ref of current scans so the polling interval never reads stale state
  useEffect(() => {
    scansRef.current = activeScans
  }, [activeScans])

  // Poll live scan progress (1s) while any scan is queued/running; when all are
  // done, refresh persons/folders/photos so the UI reflects the new index.
  useEffect(() => {
    if (!scanning) return
    let cancelled = false
    let failures = 0  // consecutive network failures while polling
    const poll = async () => {
      const running = scansRef.current.filter((s) => s.status === 'queued' || s.status === 'running')
      if (running.length === 0) return
      let hitNetworkError = false
      const results = await Promise.all(running.map(async (s) => {
        try {
          const res = await fetch(`${API_BASE}/scan/status/${s.scan_id}`, { headers: jsonHeaders() })
          if (res.status === 404) return { ...s, status: 'error' as const }  // backend restarted — scan lost
          if (!res.ok) return s
          return await res.json()
        } catch {
          hitNetworkError = true
          return s
        }
      }))
      if (cancelled) return
      if (hitNetworkError) failures += 1
      else failures = 0
      // Give up after 3 consecutive failures so the UI never spins forever
      let mergedResults = results
      if (failures >= 3) {
        mergedResults = results.map((r) =>
          r.status === 'queued' || r.status === 'running' ? { ...r, status: 'error' as const } : r
        )
      }
      const byId = new Map(mergedResults.map((r) => [r.scan_id, r]))
      const merged = scansRef.current.map((s) => byId.get(s.scan_id) || s)
      setActiveScans(merged)
      if (merged.every((s) => s.status === 'done' || s.status === 'error' || s.status === 'cancelled')) {
        loadPersons()
        loadFolders()
        setTimeout(() => {
          loadPhotos(scopeRef.current.person, null, scopeRef.current.folder)
        }, 300)
      }
    }
    poll()
    const iv = setInterval(poll, 1000)
    return () => {
      cancelled = true
      clearInterval(iv)
    }
  }, [scanning])

  // Load photos for selected person, folder, disk, or all
  const loadPhotos = async (personId?: string | null, diskPath?: string | null, folderPath?: string | null) => {
    setLoading(true)
    try {
      if (personId) {
        const res = await fetch(`${API_BASE}/person/${personId}/photos`, { headers: jsonHeaders() })
        const data = await res.json()
        setPhotos(data.photos.map((p: any) => ({ ...p, person_id: personId })))
      } else if (folderPath) {
        const res = await fetch(`${API_BASE}/photos?limit=200&folder_path=${encodeURIComponent(folderPath)}`, { headers: jsonHeaders() })
        const data = await res.json()
        setPhotos(data.photos || [])
      } else if (diskPath) {
        const res = await fetch(`${API_BASE}/photos?limit=200`, { headers: jsonHeaders() })
        const data = await res.json()
        const all = data.photos || []
        const filtered = diskPath === '/' ? all : all.filter((p: any) => p.path?.startsWith(diskPath))
        setPhotos(filtered)
      } else {
        const res = await fetch(`${API_BASE}/photos?limit=200`, { headers: jsonHeaders() })
        const data = await res.json()
        setPhotos(data.photos || [])
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
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="main">
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
                        ? `${API_BASE}/face/${preview.face_id}`
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
            <div className="photo-grid">
              {photos.map((photo) => (
                <div
                  key={photo.photo_id}
                  className="photo-card"
                  onClick={() => setSelectedPhoto(photo)}
                >
                  <img
                    src={`${API_BASE}/thumb/${photo.photo_id}`}
                    alt=""
                    loading="lazy"
                  />
                  {photo.face_id && (
                    <img
                      className="face-overlay"
                      src={`${API_BASE}/face/${photo.face_id}`}
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
                </div>
              ))}
            </div>
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
                src={`${API_BASE}/thumb/${selectedPhoto.photo_id}`}
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
                  await fetch(`${API_BASE}/photo/${selectedPhoto.photo_id}`, { method: 'DELETE', headers: jsonHeaders() })
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
    </div>
  )
}
