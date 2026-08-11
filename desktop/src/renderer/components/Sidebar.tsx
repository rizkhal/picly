import { Folder, Trash, X, CaretRight, Pause, Play, GearSix } from '@phosphor-icons/react'
import type { Disk, Folder as FolderT, PersonPreview, ScanProgress } from '../types'

type ScanRowProps = {
  scan: ScanProgress
  onPause: (scanId: string) => void
  onResume: (scanId: string) => void
  onRemove: (scanId: string) => void
  onDismiss: (scanId: string) => void
}

function ScanRow({ scan, onPause, onResume, onRemove, onDismiss }: ScanRowProps) {
  const total = scan.total || 0
  const processed = scan.processed || 0
  const pct = total > 0
    ? Math.min(100, Math.round((processed / total) * 100))
    : (scan.status === 'done' || scan.status === 'error' ? 100 : 0)
  const name = (scan.folder || '').split('/').filter(Boolean).pop() || 'Folder'
  const isQueued = scan.status === 'queued'
  const isRunning = scan.status === 'running'
  const isPaused = scan.status === 'paused'
  const isDone = scan.status === 'done'
  const isError = scan.status === 'error'
  const isCancelled = scan.status === 'cancelled'
  return (
    <div key={scan.scan_id} className="scan-nav-item">
      <div className="scan-item-top">
        <div className="disk-info">
          <div className="disk-name" title={scan.folder}>{name}</div>
          <div className="disk-space">
            {isQueued ? 'Queued…' : isRunning ? `${processed}/${total}` : isPaused ? `⏸ ${processed}/${total}` : isDone ? (total === 0 ? 'Semua ter-index' : `✓ ${scan.scanned} photos`) : isCancelled ? 'Stopped' : 'Failed'}
          </div>
        </div>
        <div className="row-actions">
          {(isQueued || isRunning) && (
            <button className="scan-pause-btn" title="Pause scan" onClick={() => onPause(scan.scan_id)}>
              <Pause size={13} weight="bold" />
            </button>
          )}
          {isPaused && (
            <>
              <button className="scan-resume-btn" title="Lanjutkan scan" onClick={() => onResume(scan.scan_id)}>
                <Play size={13} weight="bold" />
              </button>
              <button className="scan-delete-btn" title="Hapus scan" onClick={() => onRemove(scan.scan_id)}>
                <Trash size={13} weight="bold" />
              </button>
            </>
          )}
          {(isDone || isError || isCancelled) && (
            <button className="scan-dismiss-btn" title="Sembunyikan" onClick={() => onDismiss(scan.scan_id)}>
              <X size={13} weight="bold" />
            </button>
          )}
        </div>
      </div>
      <div className="progress-bar">
        <div
          className={`progress-fill${isDone ? ' done' : ''}${isError ? ' error' : ''}${isCancelled ? ' cancelled' : ''}${isPaused ? ' paused' : ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="scan-item-sub">
        {isRunning && scan.current_file ? (
          <span className="scan-current" title={scan.current_file}>{scan.current_file.split('/').pop()}</span>
        ) : isQueued ? (
          <span>Waiting for a previous scan to finish…</span>
        ) : isPaused ? (
          <span className="scan-paused-line">Paused — Resume untuk lanjut dari sisa</span>
        ) : isDone ? (
          <span className="scan-done-line">
            {scan.scanned} new · {scan.total_faces} faces · {scan.persons} persons
            {scan.errors ? ` · ${scan.errors} errors` : ''}
          </span>
        ) : isCancelled ? (
          <span className="scan-cancelled-line">Stopped at {processed} of {total} files</span>
        ) : isError ? (
          <span className="scan-error-line">Scan failed{scan.errors ? ` (${scan.errors} errors)` : ''}</span>
        ) : null}
      </div>
    </div>
  )
}

type SidebarProps = {
  scanError: string | null
  activeScans: ScanProgress[]
  dismissedScans: Set<string>
  onPause: (scanId: string) => void
  onResume: (scanId: string) => void
  onRemove: (scanId: string) => void
  onDismiss: (scanId: string) => void
  folders: FolderT[]
  selectedFolder: FolderT | null
  onFolderClick: (folder: FolderT) => void
  onRemoveFolder: (folder: FolderT) => void
  scanning: boolean
  onAddFolder: () => void
  disks: Disk[]
  selectedDisk: string | null
  onDiskClick: (diskPath: string) => void
  diskCollapsed: boolean
  onToggleDisk: () => void
  driveStatus: string
  personCount: number
  onOpenSettings: () => void
}

export function Sidebar(props: SidebarProps) {
  const {
    scanError,
    activeScans, dismissedScans, onPause, onResume, onRemove, onDismiss,
    folders, selectedFolder, onFolderClick, onRemoveFolder,
    scanning, onAddFolder,
    disks, selectedDisk, onDiskClick, diskCollapsed, onToggleDisk,
    driveStatus, personCount, onOpenSettings,
  } = props
  const visibleScans = activeScans.filter((s) => !dismissedScans.has(s.scan_id))
  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="logo">Picly</div>
      </div>

      {scanError && (
        <div className="scan-error" style={{ color: '#e5484d', fontSize: '13px', padding: '6px 10px' }}>
          {scanError}
        </div>
      )}

      {/* Folders + scanning scroll together; sidebar-bottom stays pinned */}
      <div className="sidebar-scroll">

        {/* Scanning — live scan progress (aktif/baru selesai) lives in the sidebar */}
        {visibleScans.length > 0 && (
          <div className="sidebar-section">
            <div className="sidebar-section-title">Scanning</div>
            <div className="scan-progress scan-sidebar">
              {visibleScans.map((s) => (
                <ScanRow key={s.scan_id} scan={s} onPause={onPause} onResume={onResume} onRemove={onRemove} onDismiss={onDismiss} />
              ))}
            </div>
          </div>
        )}

        {/* Folders added via '+ Add folder' */}
        <div className="sidebar-section">
          <div className="sidebar-section-title-row">
            <div className="sidebar-section-title">Folders</div>
            <button className="add-folder-text-btn" onClick={onAddFolder} disabled={scanning}>
              {scanning ? (<><span className="btn-spinner" />Scanning…</>) : '+ Add folder'}
            </button>
          </div>
          <div className="nav-list">
            {folders.map((folder) => (
              <div
                key={folder.folder_id}
                className={`nav-item ${selectedFolder?.folder_id === folder.folder_id ? 'active' : ''} ${folder.available ? '' : 'unavailable'}`}
                onClick={() => onFolderClick(folder)}
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
                    onClick={(e) => { e.stopPropagation(); onRemoveFolder(folder) }}
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
            <button
              className="sidebar-section-title sidebar-collapse-btn"
              onClick={onToggleDisk}
            >
              <CaretRight size={12} className={`section-caret ${diskCollapsed ? '' : 'open'}`} />
              Disk
            </button>
            {!diskCollapsed && (
              <div className="nav-list">
                {disks.map((disk) => (
                  <div
                    key={disk.path}
                    className={`nav-item ${selectedDisk === disk.path ? 'active' : ''}`}
                    onClick={() => onDiskClick(disk.path)}
                  >
                    <Folder size={16} className="nav-icon" />
                    <div className="disk-info">
                      <div className="disk-name">{disk.name}</div>
                      <div className="disk-space">{disk.free_gb ?? ''}{disk.free_gb !== undefined ? ' GB free' : ''}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="sidebar-footer">
          <div className="sidebar-footer-row">
            <div className="sidebar-footer-text">
              <div>Status: {driveStatus}</div>
              <div style={{ marginTop: 2 }}>{personCount} persons indexed</div>
            </div>
          </div>
          {/* Settings — gear in the footer (account moved into Settings page) */}
          <button
            className="settings-gear-btn"
            onClick={onOpenSettings}
            title="Settings"
          >
            <GearSix size={15} weight="bold" />
            <span>Settings</span>
          </button>
        </div>
      </div>
    </div>
  )
}

type FacesBarProps = {
  persons: Array<PersonPreview & { photo_count: number }>
  selectedPerson: string | null
  onPersonClick: (personId: string) => void
}

export function FacesBar({ persons, selectedPerson, onPersonClick }: FacesBarProps) {
  return (
    <div className="faces-bar">
      {persons.map((person) => {
        const size = Math.min(48, 32 + (person.photo_count || 1) * 1.2)
        return (
          <div
            key={person.person_id}
            className={`face-chip ${selectedPerson === person.person_id ? 'active' : ''}`}
            onClick={() => onPersonClick(person.person_id)}
            title={`${person.name} — ${person.photo_count} photos`}
          >
            <img
              className="face-chip-img"
              style={{ width: size, height: size }}
              src={
                person.face_id
                  ? `picly://face/${person.face_id}.jpg`
                  : `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'><rect width='100%25' height='100%25' fill='%23222'/><text x='50%25' y='54%25' font-size='18' fill='%233b82f6' text-anchor='middle' font-family='sans-serif'>${person.name.charAt(0).toUpperCase()}</text></svg>`
              }
              alt={person.name}
            />
          </div>
        )
      })}
    </div>
  )
}
