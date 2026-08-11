import { useCallback, useEffect, useRef, useState } from 'react'
import { MagnifyingGlass, Camera } from '@phosphor-icons/react'
import type { Folder, Photo } from './types'
import { useLibrary } from './hooks/useLibrary'
import { useScans } from './hooks/useScans'
import { useAuth } from './hooks/useAuth'
import * as ipc from './lib/electron'
import { Sidebar, FacesBar } from './components/Sidebar'
import { PhotoGrid, PhotoModal } from './components/PhotoGrid'
import { AuthModal } from './components/AuthModal'
import { UpdateBanner } from './components/UpdateBanner'
import { SettingsPage } from './components/SettingsPage'

export default function App() {
  // Library: disks / folders / persons / photos / faceboxes
  const library = useLibrary()
  const {
    persons, personPreviews, folders, disks, photos, setPhotos, gridFaceBoxes, setGridFaceBoxes,
    loading, setLoading, driveStatus, scopeRef,
    loadDisks, loadFolders, loadPersons, loadPhotos, searchFace,
  } = library

  // Scan engine: 3-state (pause/resume/hapus) + progress subscription
  const refreshAfterScan = useCallback(() => {
    loadPersons()
    loadFolders()
    setTimeout(() => {
      loadPhotos(scopeRef.current.person, null, scopeRef.current.folder)
    }, 300)
  }, [loadPersons, loadFolders, loadPhotos, scopeRef])
  const scans = useScans(refreshAfterScan)
  const {
    activeScans, dismissedScans, scanning, scanFolder,
    pauseScan, resumeScan, removeScan, dismissScan, recoverScans, rescanFolder,
  } = scans

  // Auth + update banner
  const auth = useAuth()
  const {
    authStatus, authModal, setAuthModal, authEmail, setAuthEmail, authPassword, setAuthPassword,
    authBusy, authError, setAuthError, updateInfo, updateDismissed, setUpdateDismissed,
    submitAuth, handleLogout, checkForUpdate, openUpdatePage,
  } = auth

  // Selection state
  const [selectedPerson, setSelectedPerson] = useState<string | null>(null)
  const [selectedDisk, setSelectedDisk] = useState<string | null>(null)
  const [selectedFolder, setSelectedFolder] = useState<Folder | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchFacesDetected, setSearchFacesDetected] = useState<number | null>(null)
  const [searchMatchedPersons, setSearchMatchedPersons] = useState<string[]>([])
  const [scanError, setScanError] = useState<string | null>(null)
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null)
  const [photoIndex, setPhotoIndex] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Disk section collapse — persisted so the choice survives restarts
  const [diskCollapsed, setDiskCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('picly:disk-collapsed') === '1' } catch { return false }
  })

  const fileInputRef = useRef<HTMLInputElement>(null)

  // Track the current person/folder scope for scan-completion refresh
  useEffect(() => {
    scopeRef.current = { person: selectedPerson, folder: selectedFolder?.container_path || null }
  }, [selectedPerson, selectedFolder, scopeRef])

  // Load everything on mount
  useEffect(() => {
    loadDisks()
    loadPersons()
    loadFolders()
    checkForUpdate(true)
    recoverScans()
  }, [loadDisks, loadPersons, loadFolders, checkForUpdate, recoverScans])

  // Re-scan mounts when the window regains focus (drives can be plugged/unplugged)
  useEffect(() => {
    const onFocus = () => { loadDisks(); loadFolders(); recoverScans() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [loadDisks, loadFolders, recoverScans])

  // Handle person selection
  const handlePersonClick = (personId: string) => {
    if (selectedPerson === personId) {
      setSelectedPerson(null)
      setSelectedDisk(null)
      setSelectedFolder(null)
      setPhotos([])
      setGridFaceBoxes({})
    } else {
      setSelectedPerson(personId)
      setSelectedDisk(null)
      setSelectedFolder(null)
      loadPhotos(personId)
    }
  }

  // Handle disk selection — shows all photos on this disk in the main panel
  const handleDiskClick = (diskPath: string) => {
    if (selectedDisk === diskPath) {
      setSelectedDisk(null)
      setSelectedPerson(null)
      setSelectedFolder(null)
      setPhotos([])
      setGridFaceBoxes({})
    } else {
      setSelectedDisk(diskPath)
      setSelectedPerson(null)
      setSelectedFolder(null)
      setGridFaceBoxes({})
      loadPhotos(null, diskPath)
    }
  }

  // Handle folder selection — photos are scoped to this folder only
  const handleFolderClick = (folder: Folder) => {
    if (selectedFolder?.folder_id === folder.folder_id) {
      setSelectedFolder(null)
      setSelectedPerson(null)
      setSelectedDisk(null)
      setPhotos([])
      setGridFaceBoxes({})
    } else {
      setSelectedFolder(folder)
      setSelectedPerson(null)
      setSelectedDisk(null)
      setGridFaceBoxes({})
      loadPhotos(null, null, folder.container_path)
    }
  }

  // Handle search file selection
  const handleSearchFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLoading(true)
    setGridFaceBoxes({}) // drop stale highlights from a previous person filter
    try {
      const res = await searchFace(file)
      setPhotos(res.photos)
      setSearchFacesDetected(res.facesDetected)
      setSearchMatchedPersons(res.matchedPersons)
      setSelectedPerson(null)
      setSelectedDisk(null)
      setSelectedFolder(null)
    } catch (err) {
      console.error('Search failed', err)
      setScanError('Search gagal — coba lagi.')
    } finally {
      setLoading(false)
    }
  }

  // Remove an added folder and all photos indexed under it (local store)
  const handleRemoveFolder = async (folder: Folder) => {
    if (!confirm(`Remove "${folder.name}" and delete all ${folder.photo_count} indexed photos?`)) return
    const matching = scans.scansRef.current.filter((s) =>
      s.folder === folder.container_path && (s.status === 'queued' || s.status === 'running')
    )
    // Cancel + drop any scan still running for this folder
    for (const s of matching) {
      await pauseScan(s.scan_id)
      removeScan(s.scan_id)
    }
    try {
      await ipc.local.deleteFolder(folder.host_path)
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

  // Open a photo in the detail modal — full-res source + reveal in Finder
  const openPhoto = (photo: Photo) => {
    const idx = photos.findIndex((p) => p.photo_id === photo.photo_id)
    setSelectedPhoto(photo)
    setPhotoIndex(idx >= 0 ? idx : 0)
  }

  // Delete photo + refresh current scope
  const handleDeletePhoto = async () => {
    if (!selectedPhoto) return
    try {
      await ipc.local.deletePhoto(selectedPhoto.photo_id)
    } catch (e) {
      console.error('Delete photo failed', e)
    }
    setSelectedPhoto(null)
    loadPhotos(selectedPerson, null, selectedFolder?.container_path || null)
    loadPersons()
    loadFolders()
  }

  // Navigate the modal to another photo in the current scope (keyboard/rail)
  const handleNavigate = (index: number) => {
    if (index < 0 || index >= photos.length) return
    setPhotoIndex(index)
    setSelectedPhoto(photos[index])
  }

  return (
    <div className="app">
      <Sidebar
        scanError={scanError}
        activeScans={activeScans}
        dismissedScans={dismissedScans}
        onPause={pauseScan}
        onResume={resumeScan}
        onRemove={removeScan}
        onDismiss={dismissScan}
        folders={folders}
        selectedFolder={selectedFolder}
        onFolderClick={handleFolderClick}
        onRemoveFolder={handleRemoveFolder}
        onRescanFolder={(folder) => rescanFolder(folder.host_path)}
        scanning={scanning}
        onAddFolder={scanFolder}
        disks={disks}
        selectedDisk={selectedDisk}
        onDiskClick={handleDiskClick}
        diskCollapsed={diskCollapsed}
        onToggleDisk={() => {
          setDiskCollapsed((c) => {
            const next = !c
            try { localStorage.setItem('picly:disk-collapsed', next ? '1' : '0') } catch {}
            return next
          })
        }}
        driveStatus={driveStatus}
        personCount={persons.length}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {/* Main content */}
      <div className="main">
        {/* Settings page — replaces the main panel content */}
        {settingsOpen ? (
          <SettingsPage
            authStatus={authStatus}
            onLogout={handleLogout}
            onOpenAuth={(mode) => { setAuthModal(mode); setAuthError(null) }}
            updateInfo={updateInfo}
            onCheckUpdate={() => checkForUpdate(false)}
            onOpenUpdate={openUpdatePage}
            onClose={() => setSettingsOpen(false)}
          />
        ) : (
          <>
            {/* Update banner — a newer release is available (v1: opens GitHub in browser) */}
            {updateInfo?.available && !updateDismissed && (
              <UpdateBanner info={updateInfo} onOpen={openUpdatePage} onDismiss={() => setUpdateDismissed(true)} />
            )}
            {/* Scan progress banner — moved to sidebar (scan status is sidebar context) */}
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
              <FacesBar
                persons={personPreviews.length > 0 ? personPreviews : persons.map((p) => ({ ...p, photo_count: p.photo_count }))}
                selectedPerson={selectedPerson}
                onPersonClick={handlePersonClick}
              />
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
                  <PhotoGrid
                    photos={photos}
                    gridFaceBoxes={gridFaceBoxes}
                    onOpenPhoto={openPhoto}
                  />
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* Photo modal — full-res source + face overlay + reveal in Finder */}
      {selectedPhoto && (
        <PhotoModal
          photo={selectedPhoto}
          photos={photos}
          index={photoIndex}
          onNavigate={handleNavigate}
          onClose={() => setSelectedPhoto(null)}
          onOpenLocation={ipc.shell.showItem}
          onDeletePhoto={handleDeletePhoto}
          selectedPerson={selectedPerson}
          personName={persons.find(p => p.person_id === selectedPhoto.person_id)?.name}
          gridFaceBoxes={gridFaceBoxes}
        />
      )}

      {/* Auth modal — login / register (account is optional; local features don't require it) */}
      {authModal && (
        <AuthModal
          mode={authModal}
          email={authEmail}
          password={authPassword}
          busy={authBusy}
          error={authError}
          onEmail={setAuthEmail}
          onPassword={setAuthPassword}
          onSubmit={() => submitAuth(authModal)}
          onClose={() => setAuthModal(null)}
          onSwitchMode={() => { setAuthModal(authModal === 'login' ? 'register' : 'login'); setAuthError(null) }}
        />
      )}
    </div>
  )
}
