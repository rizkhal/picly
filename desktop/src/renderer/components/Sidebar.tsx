import { useEffect, useRef, useState, useMemo, forwardRef, useImperativeHandle } from 'react'
import { createPortal } from 'react-dom'
import { Folder, Trash, GearSix, Aperture, ArrowClockwise, Plus, PencilSimple, X, UploadSimple } from '@phosphor-icons/react'
import type { Folder as FolderT, PersonPreview } from '../types'
import * as ipc from '../lib/electron'

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
  onAvatarSaved?: () => void
}

/**
 * Simple square-crop editor used by the avatar modal: the user picks an image
 * and drags/resizes a square region; the visible selection is what gets saved.
 * Kept dependency-free (canvas-based) to avoid adding a crop library.
 */
type AvatarCropHandle = {
  /** Crop box in natural image coordinates — sent to main for the sharp crop. */
  getCropBox: () => { x: number; y: number; size: number } | null
}

const AvatarCropEditor = forwardRef<AvatarCropHandle, { src: string }>(function AvatarCropEditor({ src }, ref) {
  const imgRef = useRef<HTMLImageElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ x: 0, y: 0, size: 0 })
  const [natural, setNatural] = useState({ w: 0, h: 0 })
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 })
  const dragRef = useRef<{ mode: 'move' | 'resize'; startX: number; startY: number; orig: { x: number; y: number; size: number } } | null>(null)

  // Track the stage size so the contain-rect (where the image is actually
  // drawn) stays in sync on window/modal resize.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const cr = entry.contentRect
        setStageSize({ w: cr.width, h: cr.height })
      }
    })
    ro.observe(stage)
    return () => ro.disconnect()
  }, [])

  // Normalize the crop box to a square within [0, naturalW] x [0, naturalH].
  const clampBox = (x: number, y: number, size: number) => {
    const { w, h } = natural
    if (w === 0 || h === 0) return { x: 0, y: 0, size: 0 }
    const maxSize = Math.min(w, h)
    size = Math.max(8, Math.min(size, maxSize))
    x = Math.max(0, Math.min(x, w - size))
    y = Math.max(0, Math.min(y, h - size))
    return { x, y, size }
  }

  /**
   * The image is drawn with object-fit: contain, so it fills as much of the
   * fixed stage as its aspect ratio allows. Compute that "contain rect" (px,
   * stage-relative) once and derive every mapping from it — no scroll involved.
   */
  const contain = useMemo(() => {
    if (stageSize.w === 0 || stageSize.h === 0 || natural.w === 0 || natural.h === 0) return null
    const ratio = Math.min(stageSize.w / natural.w, stageSize.h / natural.h)
    const width = natural.w * ratio
    const height = natural.h * ratio
    return {
      left: (stageSize.w - width) / 2,
      top: (stageSize.h - height) / 2,
      width,
      height,
      ratio,
    }
  }, [stageSize, natural])

  /** Cursor position in natural image coordinates. */
  const toNatural = (e: React.PointerEvent) => {
    const stage = stageRef.current
    if (!stage || !contain) return null
    const sr = stage.getBoundingClientRect()
    return {
      x: (e.clientX - sr.left - contain.left) / contain.ratio,
      y: (e.clientY - sr.top - contain.top) / contain.ratio,
    }
  }

  const onImageLoad = () => {
    const img = imgRef.current
    if (!img) return
    const w = img.naturalWidth
    const h = img.naturalHeight
    setNatural({ w, h })
    // Default to a centered 80% square so both axes stay movable and there's
    // room to grow/shrink (a full-size default locks one axis on non-square photos).
    const maxSize = Math.min(w, h)
    const size = Math.max(8, Math.round(maxSize * 0.8))
    setBox({ x: Math.round((w - size) / 2), y: Math.round((h - size) / 2), size })
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const pt = toNatural(e)
    if (!pt) return
    e.preventDefault()
    // Capture the pointer so move/up keep firing even when the cursor leaves
    // the stage (e.g. fast drags or the crop box sitting on top of the img).
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch { /* already released */ }
    const { x, y } = pt
    // Grab near the bottom-right corner (including the handle, which sticks
    // out a few px past the box edge) -> resize. Checked BEFORE the inside-box
    // test, otherwise the corner/handle never reaches resize mode.
    const cornerPad = 40
    if (x >= box.x + box.size - cornerPad && y >= box.y + box.size - cornerPad) {
      dragRef.current = { mode: 'resize', startX: e.clientX, startY: e.clientY, orig: { ...box } }
      return
    }
    if (x >= box.x && x <= box.x + box.size && y >= box.y && y <= box.y + box.size) {
      dragRef.current = { mode: 'move', startX: e.clientX, startY: e.clientY, orig: { ...box } }
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d || !contain) return
    const scale = 1 / contain.ratio
    const dx = (e.clientX - d.startX) * scale
    const dy = (e.clientY - d.startY) * scale
    if (d.mode === 'resize') {
      const size = Math.max(8, d.orig.size + Math.max(dx, dy))
      setBox(clampBox(d.orig.x, d.orig.y, size))
    } else {
      setBox(clampBox(d.orig.x + dx, d.orig.y + dy, d.orig.size))
    }
  }

  const endDrag = (e?: React.PointerEvent) => {
    dragRef.current = null
    try {
      e?.currentTarget?.releasePointerCapture?.(e.pointerId)
    } catch { /* already released */ }
  }

  // Expose the crop box (natural image coordinates). Main process does the
  // actual crop with sharp — deterministic, no canvas taint/dataURL issues.
  useImperativeHandle(ref, () => ({
    getCropBox: () => {
      if (box.size < 8) return null
      return { x: Math.round(box.x), y: Math.round(box.y), size: Math.round(box.size) }
    },
  }))

  // Position the box in PIXELS relative to the stage, derived from the contain
  // rect — never percentages, which drift when the stage is wider than the
  // image or scrolls (the classic cause of dead corners/handles).
  const boxStyle = contain
    ? {
        left: contain.left + box.x * contain.ratio,
        top: contain.top + box.y * contain.ratio,
        width: box.size * contain.ratio,
        height: box.size * contain.ratio,
      }
    : { left: 0, top: 0, width: 0, height: 0 }

  return (
    <div className="avatar-crop-editor">
      <div
        ref={stageRef}
        className="avatar-crop-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <img
          ref={imgRef}
          src={src}
          alt="crop"
          draggable={false}
          className="avatar-crop-img"
          onLoad={onImageLoad}
        />
        {contain && box.size > 0 && (
          <div className="avatar-crop-box" style={boxStyle}>
            <div className="avatar-crop-handle" />
          </div>
        )}
      </div>
      <div className="avatar-crop-hint">Drag to move the square, grab the corner to resize. The square is what gets saved.</div>
    </div>
  )
})

/**
 * Modal for setting a person's avatar: pick an image file, crop it to a
 * square, then save. The crop is rendered to a 256×256 PNG dataURL in the
 * renderer and sent to the main process, which stores it as person-<id>.jpg.
 */
function AvatarModal({
  person,
  onClose,
  onSaved,
}: {
  person: { person_id: string; name: string; avatar_url?: string | null; face_id?: string }
  onClose: () => void
  onSaved: () => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cropRef = useRef<AvatarCropHandle>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewSrc, setPreviewSrc] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    // Keep the File in state — the <input> is unmounted as soon as the crop
    // editor renders, so reading ref.current.files at Save time would be null.
    setSelectedFile(file)
    const url = URL.createObjectURL(file)
    setPreviewSrc(url)
    setError(null)
  }

  const save = async () => {
    const crop = cropRef.current?.getCropBox()
    if (!crop) {
      setError('Adjust the crop square first')
      return
    }
    if (!selectedFile) {
      setError('No file selected')
      return
    }
    const filePath = ipc.getPathForFile(selectedFile)
    if (!filePath) {
      setError('Could not resolve the file path')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const ok = await ipc.local.setPersonAvatar(person.person_id, filePath, crop)
      if (!ok) throw new Error('Save failed')
      onSaved()
    } catch (err: any) {
      setError(err?.message || 'Failed to save avatar')
    } finally {
      setSaving(false)
    }
  }

  const currentFace = person.avatar_url
    ? person.avatar_url
    : person.face_id
      ? `picly://face/${person.face_id}.jpg`
      : null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal avatar-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Set avatar — {person.name}</div>
          <button className="modal-close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">
          {!previewSrc ? (
            <div className="avatar-picker">
              <div className="avatar-preview-ring">
                {currentFace ? (
                  <img src={currentFace} alt={person.name} className="avatar-preview-img" />
                ) : (
                  <div className="avatar-preview-fallback">{person.name.charAt(0).toUpperCase()}</div>
                )}
              </div>
              <div className="avatar-picker-hint">Choose a photo for {person.name}'s avatar.</div>
              <button className="btn btn-primary" onClick={() => fileInputRef.current?.click()}>
                <UploadSimple size={14} /> Choose photo
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={onFile}
              />
            </div>
          ) : (
            <>
              <AvatarCropEditor ref={cropRef} src={previewSrc} />
              {error && <div className="avatar-error">{error}</div>}
            </>
          )}
        </div>
        {previewSrc && (
          <div className="modal-actions">
            <button className="btn" onClick={() => { setPreviewSrc(null); setError(null) }}>
              Choose different photo
            </button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save avatar'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export function FacesBar({ persons, selectedPerson, onPersonClick, onAvatarSaved }: FacesBarProps) {
  const [editing, setEditing] = useState<string | null>(null)
  const editingPerson = persons.find((p) => p.person_id === editing) || null
  return (
    <div className="faces-bar">
      {persons.map((person) => {
        const imgSrc = person.avatar_url
          ? person.avatar_url
          : person.face_id
            ? `picly://face/${person.face_id}.jpg`
            : null
        return (
          <div
            key={person.person_id}
            className={`face-chip-wrap ${selectedPerson === person.person_id ? 'active' : ''}`}
            onClick={() => onPersonClick(person.person_id)}
            title={`${person.name} — ${person.photo_count} photos`}
          >
            <div className="face-chip">
              {imgSrc ? (
                <img className="face-chip-img" src={imgSrc} alt={person.name} />
              ) : (
                <div className="face-chip-fallback">{person.name.charAt(0).toUpperCase()}</div>
              )}
            </div>
            <button
              className="face-chip-edit"
              title="Change avatar"
              onClick={(e) => { e.stopPropagation(); setEditing(person.person_id) }}
            >
              <PencilSimple size={12} weight="bold" />
            </button>
          </div>
        )
      })}
      {editingPerson &&
        createPortal(
          <AvatarModal
            person={editingPerson}
            onClose={() => setEditing(null)}
            onSaved={() => { setEditing(null); onAvatarSaved?.() }}
          />,
          document.body,
        )}
    </div>
  )
}
