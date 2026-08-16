import { useEffect, useRef, useState } from 'react'
import { Folder, Trash, GearSix, Aperture, ArrowClockwise, Plus } from '@phosphor-icons/react'
import type { Folder as FolderT, PersonPreview } from '../types'

type SidebarProps = {
  scanError: string | null
  folders: FolderT[]
  selectedFolder: FolderT | null
  onFolderClick: (folder: FolderT) => void
  onRemoveFolder: (folder: FolderT) => void
  onRescanFolder: (folder: FolderT) => void
  onAddFolder: () => void
  onManagePhotos?: () => void
  trashCount: number
  trashSelected: boolean
  onTrashClick: () => void
  driveStatus: string
  personCount: number
  onOpenSettings: () => void
  onLogoClick?: () => void
  authEmail?: string | null
  onRestorePhoto: (photoId: string) => void
  onEmptyTrash: () => void
}

export function Sidebar(props: SidebarProps) {
  const {
    scanError,
    folders, selectedFolder, onFolderClick, onRemoveFolder,
    onRescanFolder, onAddFolder, onManagePhotos,
    trashCount, trashSelected, onTrashClick,
    driveStatus, personCount, onOpenSettings, authEmail, onLogoClick,
  } = props
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menuOpen) return
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [menuOpen])
  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <button
          className="logo"
          onClick={onLogoClick}
          title="Home"
        >
          <Aperture size={18} weight="fill" className="logo-icon" />
          <span>Picly</span>
        </button>
      </div>

      {scanError && (
        <div className="scan-error" style={{ color: '#e5484d', fontSize: '13px', padding: '6px 10px' }}>
          {scanError}
        </div>
      )}

      {/* Folders + scanning scroll together; sidebar-bottom stays pinned */}
      <div className="sidebar-scroll">

        {/* Folders added via '+ Add folder' */}
        <div className="sidebar-section">
          <div className="sidebar-section-title-row">
            <div className="sidebar-section-title">Folders</div>
            <div className="sidebar-title-actions">
              <div className="sidebar-title-menu" ref={menuRef}>
                <button
                  className="icon-btn"
                  onClick={() => setMenuOpen((v) => !v)}
                  title="Folder options"
                >
                  <Plus size={14} weight="bold" />
                </button>
                {menuOpen && (
                  <div className="sidebar-title-dropdown">
                    <button
                      className="sidebar-title-dropdown-item"
                      onClick={() => { setMenuOpen(false); onAddFolder() }}
                    >
                      <Plus size={13} /> Add folder
                    </button>
                    {onManagePhotos && (
                      <button
                        className="sidebar-title-dropdown-item"
                        onClick={() => { setMenuOpen(false); onManagePhotos() }}
                      >
                        <Folder size={13} /> Manage photos
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
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
                    className="row-action-btn rescan-btn"
                    title="Re-scan folder (add new, remove missing)"
                    onClick={(e) => { e.stopPropagation(); onRescanFolder(folder) }}
                  >
                    <ArrowClockwise size={13} />
                  </button>
                  <button
                    className="row-action-btn delete-btn"
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

      {/* Bottom: pinned "Trash" scope + API status */}
      <div className="sidebar-bottom">
        <div className="sidebar-section">
          <div
            className={`nav-item trash-item ${trashSelected ? 'active' : ''}`}
            onClick={onTrashClick}
            title="Photos moved to Trash (soft-delete, can be restored)"
          >
            <Trash size={16} className="nav-icon" />
            <div className="disk-info">
              <div className="disk-name">Trash</div>
              <div className="disk-space">{trashCount} photos</div>
            </div>
          </div>
        </div>
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
            <span className="settings-gear-label">{authEmail || 'Settings'}</span>
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
        const size = Math.min(64, 44 + (person.photo_count || 1) * 1.2)
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
