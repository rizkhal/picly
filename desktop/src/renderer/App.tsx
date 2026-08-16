import { useCallback, useEffect, useRef, useState } from 'react'
import { MagnifyingGlass, Camera, ArrowClockwise, X } from '@phosphor-icons/react'
import type { Folder, Photo } from './types'
import { useLibrary } from './hooks/useLibrary'
import { useScans } from './hooks/useScans'
import { useAuth } from './hooks/useAuth'
import * as ipc from './lib/electron'
import { Sidebar, FacesBar } from './components/Sidebar'
import { PhotoGrid, PhotoModal } from './components/PhotoGrid'
import { AuthModal } from './components/AuthModal'
import { UpdateBanner } from './components/UpdateBanner'
import { SettingsPage, type SettingsSectionId } from './components/SettingsPage'
import { ManagePhotosPage } from './components/ManagePhotosPage'
import { PersonManager } from './components/PersonManager'
import { ScanProgressPage } from './components/ScanProgressPage'

// Main-panel pages. Persisted so a reload stays on the same page the user left.
type PageId = 'library' | 'settings' | 'manage' | 'progress'
const PAGE_KEY = 'picly:page'
const SETTINGS_SECTION_KEY = 'picly:settings-section'

export default function App() {
  // Library: disks / folders / persons / photos
  const library = useLibrary()
  const {
    persons, personPreviews, folders, photos, setPhotos,
    loading, setLoading, driveStatus, scopeRef, trashCount,
    showSingletons, toggleShowSingletons,
    loadFolders, loadPersons, loadPhotos, loadTrashPhotos, loadTrashCount, searchFace, searchByName,
  } = library

  // Scan engine: 3-state (pause/resume/remove) + progress subscription
  const refreshAfterScan = useCallback(() => {
    loadPersons()
    loadFolders()
    loadTrashCount()
    setTimeout(() => {
      loadPhotos(scopeRef.current.person, null, scopeRef.current.folder)
    }, 300)
  }, [loadPersons, loadFolders, loadTrashCount, loadPhotos, scopeRef])
  const scans = useScans(refreshAfterScan)
    const { activeScans, dismissedScans, scanning, scanFolder, startScanFromDroppedFiles,
      pauseScan, resumeScan, removeScan, dismissScan, recoverScans, rescanFolder,
    } = scans

  // Auth + update banner
  const auth = useAuth()
  const {
    authStatus, authModal, setAuthModal, authEmail, setAuthEmail, authPassword, setAuthPassword,
    authBusy, authError, setAuthError, updateInfo, updateDismissed, setUpdateDismissed, updateChecking,
    submitAuth, handleLogout, checkForUpdate, openUpdatePage,
  } = auth

  // Selection state
  const [selectedPerson, setSelectedPerson] = useState<string | null>(null)
  const [selectedFolder, setSelectedFolder] = useState<Folder | null>(null)
  const [trashSelected, setTrashSelected] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchByNameActive, setSearchByNameActive] = useState(false)
  const [searchFacesDetected, setSearchFacesDetected] = useState<number | null>(null)
  const [searchMatchedPersons, setSearchMatchedPersons] = useState<string[]>([])
  const [scanError, setScanError] = useState<string | null>(null)
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null)
  const [photoIndex, setPhotoIndex] = useState(0)
  const [personManagerOpen, setPersonManagerOpen] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // Page routing is persisted so a reload stays on the same page the user left.
  // 'library' is the default (photo grid).
  const [page, setPage] = useState<PageId>(() => {
    try {
      const v = localStorage.getItem(PAGE_KEY)
      return v === 'settings' || v === 'manage' || v === 'progress' ? v : 'library'
    } catch {
      return 'library'
    }
  })
  useEffect(() => {
    try { localStorage.setItem(PAGE_KEY, page) } catch { /* ignore */ }
  }, [page])

  // Persist the active Settings section too, so reload stays on e.g. Models.
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>(() => {
    try {
      const v = localStorage.getItem(SETTINGS_SECTION_KEY)
      return v === 'account' || v === 'storage' || v === 'faces' || v === 'models' || v === 'about' ? v : 'account'
    } catch {
      return 'account'
    }
  })
  useEffect(() => {
    try { localStorage.setItem(SETTINGS_SECTION_KEY, settingsSection) } catch { /* ignore */ }
  }, [settingsSection])

  // Scan progress is a full page. "Add folder" from the sidebar now only
  // NAVIGATES there — the file picker opens from the page's own Add folder
  // button, so the user lands on the queue page first (no surprise dialog).
  const handleAddFolder = useCallback(() => {
    setPage('progress')
  }, [])

  // From the Scan progress page: open the folder picker + start scanning.
  const handleStartScan = useCallback(async () => {
    await scanFolder()
  }, [scanFolder])

  const handleRescanFolder = useCallback((folder: Folder) => {
    setPage('progress')
    rescanFolder(folder.host_path)
  }, [rescanFolder])

  // Track the current person/folder/no-faces scope for scan-completion refresh
  useEffect(() => {
    scopeRef.current = { person: selectedPerson, folder: selectedFolder?.container_path || null, trash: trashSelected }
  }, [selectedPerson, selectedFolder, trashSelected, scopeRef])

  // Load everything on mount
  useEffect(() => {
    loadPersons()
    loadFolders()
    loadTrashCount()
    checkForUpdate(true)
    recoverScans()
  }, [loadPersons, loadFolders, loadTrashCount, checkForUpdate, recoverScans])

  // Re-scan mounts when the window regains focus (drives can be plugged/unplugged)
  useEffect(() => {
    const onFocus = () => { loadFolders(); loadTrashCount(); recoverScans() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [loadFolders, loadTrashCount, recoverScans])

  // Global drag & drop guard: without a window-level dragover/drop preventDefault,
  // Electron may navigate the window to the dropped folder (or swallow the drop).
  // Dropping anywhere outside the progress page just routes there (its empty state
  // is the drop zone).
  useEffect(() => {
    const prevent = (e: DragEvent) => { e.preventDefault() }
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', prevent)
    }
  }, [])

  // Handle person selection
  const handlePersonClick = (personId: string) => {
    setPage('library')
    if (searchByNameActive) exitSearch()
    if (selectedPerson === personId) {
      setSelectedPerson(null)
      setSelectedFolder(null)
      setTrashSelected(false)
      setPhotos([])
      loadPhotos()
      return
    }
    setSelectedPerson(personId)
    setSelectedFolder(null)
    setTrashSelected(false)
    setPhotos([])
    loadPhotos(personId)
  }

  // Handle folder selection — photos are scoped to this folder only
  const handleFolderClick = (folder: Folder) => {
    setPage('library')
    if (searchByNameActive) exitSearch()
    if (selectedFolder?.folder_id === folder.folder_id) {
      setSelectedFolder(null)
      setSelectedPerson(null)
      setTrashSelected(false)
      setPhotos([])
      loadPhotos()
      return
    }
    setSelectedFolder(folder)
    setSelectedPerson(null)
    setTrashSelected(false)
    setPhotos([])
    loadPhotos(null, null, folder.container_path)
  }

  // Handle "Trash" selection — soft-deleted photos (restore / empty trash)
  const handleTrashClick = () => {
    setPage('library')
    if (searchByNameActive) exitSearch()
    if (trashSelected) {
      setTrashSelected(false)
      setSelectedFolder(null)
      setSelectedPerson(null)
      setPhotos([])
    } else {
      setTrashSelected(true)
      setSelectedFolder(null)
      setSelectedPerson(null)
      loadTrashPhotos()
    }
  }

  // Handle search file selection
  const handleSearchFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLoading(true)
    try {
      const res = await searchFace(file)
      setPhotos(res.photos)
      setSearchFacesDetected(res.facesDetected)
      setSearchMatchedPersons(res.matchedPersons)
      setSelectedPerson(null)
      setSelectedFolder(null)
      setTrashSelected(false)
    } catch (err) {
      console.error('Search failed', err)
      setScanError('Search failed — try again.')
    } finally {
      setLoading(false)
    }
  }

  // Text search — matches file path AND person name (global, ignores scope).
  // Debounced: keystrokes don't fire a query each time; the DB LIKE is cheap.
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleSearchQueryChange = useCallback((value: string) => {
    setSearchQuery(value)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    const q = value.trim()
    if (!q) {
      setSearchByNameActive(false)
      loadPhotos(selectedPerson || null, null, selectedFolder?.container_path || null)
      return
    }
    setSearchByNameActive(true)
    setLoading(true)
    searchTimer.current = setTimeout(async () => {
      try {
        const rows = await searchByName(q)
        setPhotos(rows)
        setSearchFacesDetected(null)
        setSearchMatchedPersons([])
      } catch (err) {
        console.error('Search by name failed', err)
      } finally {
        setLoading(false)
      }
    }, 250)
  }, [searchByName, loadPhotos, selectedPerson, selectedFolder])

  // Leaving search mode (clearing the query / changing scope) restores the
  // normal scope-based photo list.
  const exitSearch = useCallback(() => {
    setSearchQuery('')
    setSearchByNameActive(false)
    loadPhotos(selectedPerson || null, null, selectedFolder?.container_path || null)
  }, [loadPhotos, selectedPerson, selectedFolder])

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
      setScanError('Failed to remove folder.')
      return
    }
    if (selectedFolder?.folder_id === folder.folder_id) {
      setSelectedFolder(null)
      setPhotos([])
    }
    await loadFolders()
    await loadPersons()
    loadTrashCount()
    loadPhotos(scopeRef.current.person, null, scopeRef.current.folder)
  }

  // Open a photo in the detail modal — full-res source + reveal in Finder
  const openPhoto = (photo: Photo) => {
    const idx = photos.findIndex((p) => p.photo_id === photo.photo_id)
    setSelectedPhoto(photo)
    setPhotoIndex(idx >= 0 ? idx : 0)
  }

  // Delete photo (move to Trash) + refresh current scope
  // Delete photo (move to Trash) + refresh current scope
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
    loadTrashCount()
  }

  // Restore a photo from the Trash back to the live library
  const handleRestorePhoto = async (photoId: string) => {
    try {
      await ipc.local.restorePhoto(photoId)
    } catch (e) {
      console.error('Restore photo failed', e)
    }
    loadTrashPhotos()
    loadPersons()
    loadTrashCount()
  }

  // Permanently delete all trashed photos
  const handleEmptyTrash = async () => {
    if (!confirm('Permanently delete all photos in Trash?')) return
    try {
      await ipc.local.emptyTrash()
    } catch (e) {
      console.error('Empty trash failed', e)
    }
    loadTrashPhotos()
    loadPersons()
    loadFolders()
    loadTrashCount()
  }

  // Merge two+ persons into one (manual) — fixes over-split. After the merge,
  // drop the (now-empty) source ids from the selected filter and refresh.
  const handleMergePersons = async (targetId: string, sourceIds: string[]) => {
    await ipc.local.mergePersons(targetId, sourceIds)
    const mergedIds = new Set([targetId, ...sourceIds])
    if (selectedPerson && mergedIds.has(selectedPerson)) {
      setSelectedPerson(targetId)
      loadPhotos(targetId)
    }
    loadPersons()
  }

  // Split one person into per-face singletons (manual) — fixes false merge.
  const handleSplitPerson = async (personId: string) => {
    await ipc.local.splitPerson(personId)
    if (selectedPerson === personId) {
      setSelectedPerson(null)
      setPhotos([])
    }
    loadPersons()
  }

  // Click-face-to-filter: from the modal, jump to that face's person.
  // NOT a toggle — re-clicking the currently-selected person keeps the filter
  // (just closes the modal) instead of clearing the grid.
  const handleFaceClick = (personId: string) => {
    if (searchByNameActive) exitSearch()
    if (selectedPerson !== personId) {
      setSelectedPerson(personId)
      setSelectedFolder(null)
      setTrashSelected(false)
      loadPhotos(personId)
    }
    setSelectedPhoto(null)
  }

  // Manage photos — placeholder for now (open a dialog in the future).
  const handleManagePhotos = () => {
    setPage('manage')
  }

  // Logo click — back to the library, clearing the active scope
  const handleLogoClick = useCallback(() => {
    setSelectedPerson(null)
    setSelectedFolder(null)
    setTrashSelected(false)
    setPhotos([])
    setPage('library')
    if (searchByNameActive) exitSearch()
  }, [exitSearch, searchByNameActive])

  const handleReload = useCallback(() => {
    void ipc.app.reload()
  }, [])
  const handleNavigate = (index: number) => {
    if (index < 0 || index >= photos.length) return
    setPhotoIndex(index)
    setSelectedPhoto(photos[index])
  }

  return (
    <div className="app">
      <Sidebar
        scanError={scanError}
        folders={folders}
        selectedFolder={selectedFolder}
        onFolderClick={handleFolderClick}
        onRemoveFolder={handleRemoveFolder}
        onRescanFolder={handleRescanFolder}
        scanning={scanning}
        onAddFolder={handleAddFolder}
        onManagePhotos={handleManagePhotos}
        trashCount={trashCount}
        trashSelected={trashSelected}
        onTrashClick={handleTrashClick}
        driveStatus={driveStatus}
        personCount={persons.length}
        authEmail={authStatus.loggedIn ? authStatus.email : null}
        onOpenSettings={() => setPage('settings')}
        onLogoClick={handleLogoClick}
        onRestorePhoto={handleRestorePhoto}
        onEmptyTrash={handleEmptyTrash}
      />

      {/* Main content */}
      <div className="main">
        {/* Manage photos page — replaces the main panel content (full page, not modal) */}
        {page === 'manage' ? (
          <ManagePhotosPage onClose={() => setPage('library')} />
        ) : page === 'progress' ? (
          <ScanProgressPage
            scans={activeScans.filter((s) => !dismissedScans.has(s.scan_id))}
            scanning={scanning}
            onPause={pauseScan}
            onResume={resumeScan}
            onRemove={removeScan}
            onDismiss={dismissScan}
            onAddFolder={handleStartScan}
            onDropFolders={startScanFromDroppedFiles}
            onClose={() => setPage('library')}
          />
        ) : page === 'settings' ? (
          <SettingsPage
            authStatus={authStatus}
            onLogout={handleLogout}
            onOpenAuth={(mode) => { setAuthModal(mode); setAuthError(null) }}
            updateInfo={updateInfo}
            updateChecking={updateChecking}
            onCheckUpdate={() => checkForUpdate(false)}
            onOpenUpdate={openUpdatePage}
            onClose={() => setPage('library')}
            showSingletons={showSingletons}
            onToggleShowSingletons={() => { toggleShowSingletons(); loadPersons() }}
            section={settingsSection}
            onSectionChange={setSettingsSection}
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
                  placeholder="Search by file name or person…"
                  value={searchQuery}
                  onChange={(e) => handleSearchQueryChange(e.target.value)}
                />
                {searchByNameActive && (
                  <button
                    className="search-clear-btn"
                    onClick={() => exitSearch()}
                    title="Clear search"
                  >
                    <X size={12} />
                  </button>
                )}
                <button
                  className="btn search-image-btn"
                  onClick={() => fileInputRef.current?.click()}
                  title="Search by image"
                >
                  <Camera size={18} />
                </button>
              </div>
              {/* Reload — restart the renderer (page state persists via localStorage) */}
              <button
                className="toolbar-icon-btn"
                onClick={handleReload}
                title="Reload app"
              >
                <ArrowClockwise size={18} />
              </button>
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
              ) : trashSelected ? (
                <div className="trash-view">
                  <div className="trash-toolbar">
                    <div className="trash-title">Trash — {photos.length} photos deleted</div>
                    {photos.length > 0 && (
                      <button className="btn btn-danger" onClick={handleEmptyTrash}>
                        Empty Trash
                      </button>
                    )}
                  </div>
                  {photos.length === 0 ? (
                    <div className="empty">
                      <h3>Trash is empty</h3>
                      <p>Deleted photos appear here until restored or permanently deleted.</p>
                    </div>
                  ) : (
                    <div className="trash-grid">
                      {photos.map((p) => (
                        <div key={p.photo_id} className="trash-card">
                          <img src={p.thumb_path || `picly://thumb/${p.photo_id}.jpg`} alt="" loading="lazy" />
                          <button
                            className="btn trash-restore-btn"
                            onClick={() => handleRestorePhoto(p.photo_id)}
                            title="Restore to library"
                          >
                            Restore
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
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
          onFaceClick={handleFaceClick}
          persons={persons}
          previews={personPreviews}
          onPersonChanged={() => { loadPersons(); loadFolders(); loadTrashCount() }}
        />
      )}

      {/* Person manager — manual merge/split (survives re-cluster). NOTE: UI
          entry point removed temporarily at user request — re-enable when asked again. */}
      {false && personManagerOpen && (
        <PersonManager
          persons={persons}
          onClose={() => setPersonManagerOpen(false)}
          onMerge={handleMergePersons}
          onSplit={handleSplitPerson}
        />
      )}

      {/* Manage photos — replaced by a full page (see main panel) */}

      {/* Scan progress is a full page, not a modal. */}

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
