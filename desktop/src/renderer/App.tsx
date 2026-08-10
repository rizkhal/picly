import { useState, useEffect, useRef } from 'react'

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
type ScanResult = { scanned: number; total_faces: number; persons: number; thumbs_generated: number }

export default function App() {
  const [persons, setPersons] = useState<Person[]>([])
  const [photos, setPhotos] = useState<Photo[]>([])
  const [selectedPerson, setSelectedPerson] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanStatus, setScanStatus] = useState<ScanResult | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null)
  const [driveStatus, setDriveStatus] = useState('Checking...')
  const [searchFile, setSearchFile] = useState<File | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const driveFailures = useRef(0)

  // Load persons
  const loadPersons = async () => {
    try {
      const res = await fetch(`${API_BASE}/person`, { headers: jsonHeaders() })
      const data = await res.json()
      setPersons(data.persons || [])
    } catch (e) {
      console.error('Failed to load persons', e)
    }
  }

  // Load photos for selected person or all
  const loadPhotos = async (personId?: string | null) => {
    setLoading(true)
    try {
      if (personId) {
        const res = await fetch(`${API_BASE}/person/${personId}/photos`, { headers: jsonHeaders() })
        const data = await res.json()
        setPhotos(data.photos.map((p: any) => ({ ...p, person_id: personId })))
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
    } catch (e) {
      console.error('Search failed', e)
    } finally {
      setLoading(false)
    }
  }

  // Scan folder
  const scanFolder = async () => {
    try {
      const paths = await (window as any).electron?.selectFolder?.()
      if (!paths || paths.length === 0) return
      const folder = paths[0]
      if (folder && folder.startsWith('MAPPING_ERROR:')) {
        const parts = folder.split(':')
        setScanError(`Could not copy folder to container: ${parts.slice(1).join(':')}`)
        return
      }
      setScanning(true)
      setScanStatus(null)
      setScanError(null)
      const form = new FormData()
      form.append('folder', folder)
      const res = await fetch(`${API_BASE}/scan`, { method: 'POST', headers: multipartHeaders(), body: form })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setScanError((err as any).detail || `Scan failed (HTTP ${res.status})`)
        setScanning(false)
        return
      }
      const data = await res.json()
      setScanStatus(data)
      await loadPersons()
      // Refresh photos after scan
      setTimeout(() => {
        loadPhotos(selectedPerson)
      }, 1000)
    } catch (e) {
      setScanError('Could not reach API — is the backend running?')
    } finally {
      setScanning(false)
    }
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

  // Delete person
  const deletePerson = async (personId: string) => {
    if (!confirm('Delete this person?')) return
    try {
      await fetch(`${API_BASE}/person/${personId}`, { method: 'DELETE', headers: jsonHeaders() })
      if (selectedPerson === personId) {
        setSelectedPerson(null)
        setPhotos([])
      }
      await loadPersons()
    } catch (e) {
      console.error('Delete failed', e)
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

  // Load persons on mount
  useEffect(() => {
    loadPersons()
  }, [])

  // Handle person selection
  const handlePersonClick = (personId: string) => {
    if (selectedPerson === personId) {
      setSelectedPerson(null)
      setPhotos([])
    } else {
      setSelectedPerson(personId)
      loadPhotos(personId)
    }
  }

  // Handle search file selection
  const handleSearchFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setSearchFile(file)
      searchFace()
    }
  }

  return (
    <div className="app">
      {/* Sidebar */}
      <div className="sidebar">
        <div className="sidebar-header">
          <div className="logo">Picly</div>
          <div className="sidebar-actions">
            <button className="btn btn-primary" onClick={scanFolder} disabled={scanning}>
              {scanning ? 'Scanning...' : 'Scan'}
            </button>
          </div>
        </div>

        {scanError && (
          <div className="scan-error" style={{ color: '#e5484d', fontSize: '13px', padding: '6px 10px' }}>
            {scanError}
          </div>
        )}

        {scanStatus && (
          <div className="scan-progress">
            <span>{scanStatus.scanned} photos</span>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: '100%' }} />
            </div>
            <span>{scanStatus.persons} persons</span>
          </div>
        )}

        <div className="person-list">
          {persons.length === 0 && (
            <div className="empty" style={{ padding: '20px 10px' }}>
              <p style={{ fontSize: '13px' }}>No persons yet. Scan a folder to start.</p>
            </div>
          )}
          {persons.map((person) => (
            <div
              key={person.person_id}
              className={`person-item ${selectedPerson === person.person_id ? 'active' : ''}`}
              onClick={() => handlePersonClick(person.person_id)}
            >
              <div className="person-info">
                <div className="person-name">{person.name}</div>
                <div className="person-count">{person.photo_count} photos</div>
              </div>
              <div className="person-actions">
                <button
                  className="btn btn-sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    const newName = prompt('Rename:', person.name)
                    if (newName) renamePerson(person.person_id, newName)
                  }}
                >
                  ✏️
                </button>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={(e) => {
                    e.stopPropagation()
                    deletePerson(person.person_id)
                  }}
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="sidebar-footer">
          <div>Status: {driveStatus}</div>
          <div style={{ marginTop: 4 }}>{persons.length} persons indexed</div>
        </div>
      </div>

      {/* Main content */}
      <div className="main">
        <div className="toolbar">
          <input
            type="file"
            ref={fileInputRef}
            className="search-file-input"
            accept="image/*"
            onChange={handleSearchFileChange}
          />
          <button
            className="btn"
            onClick={() => fileInputRef.current?.click()}
          >
            📷 Search by face
          </button>
          <input
            type="text"
            className="search-input"
            placeholder="Filter by filename..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              const q = e.target.value.toLowerCase()
              loadPersons().then(() => {
                if (q) {
                  setPhotos(prev => prev.filter(p => p.path.toLowerCase().includes(q)))
                }
              })
            }}
          />
          <button className="btn" onClick={() => { setSelectedPerson(null); setPhotos([]); setSearchQuery('') }}>
            Clear
          </button>
        </div>

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
                  loadPhotos(selectedPerson)
                  loadPersons()
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
