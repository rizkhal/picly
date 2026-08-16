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
  const [natural, setNatural] = useState({ w: 0, h: 0 })
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 })
  // zoom: how much the photo is scaled beyond its contain fit. center: the
  // natural-image point the photo is anchored on (stage center). squarePx: the
  // on-screen crop frame size. Shrinking the frame zooms the photo in.
  const [zoom, setZoom] = useState(1)
  const [center, setCenter] = useState({ x: 0, y: 0 })
  const [squarePx, setSquarePx] = useState(320)
  const dragRef = useRef<{ mode: 'move' | 'resize'; startX: number; startY: number; origZoom: number; origSquarePx: number; origCenter: { x: number; y: number } } | null>(null)

  const MAX_ZOOM = 8
  const MIN_PX = 80

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

  /** Base layout at zoom = 1: the image fills as much of the stage as its
   *  aspect ratio allows (object-fit contain equivalent). */
  const contain = useMemo(() => {
    if (stageSize.w === 0 || stageSize.h === 0 || natural.w === 0 || natural.h === 0) return null
    const ratio = Math.min(stageSize.w / natural.w, stageSize.h / natural.h)
    return {
      left: (stageSize.w - natural.w * ratio) / 2,
      top: (stageSize.h - natural.h * ratio) / 2,
      width: natural.w * ratio,
      height: natural.h * ratio,
      ratio,
    }
  }, [stageSize, natural])

  const renderScale = contain ? contain.ratio * zoom : 0

  // Rendered image rect: anchored so `center` sits at the stage center, scaled
  // by renderScale.
  const imgRect = useMemo(() => {
    if (renderScale <= 0 || natural.w === 0) return null
    return {
      left: stageSize.w / 2 - center.x * renderScale,
      top: stageSize.h / 2 - center.y * renderScale,
      width: natural.w * renderScale,
      height: natural.h * renderScale,
      scale: renderScale,
    }
  }, [renderScale, center, natural, stageSize])

  const frameNatural = renderScale > 0 ? squarePx / renderScale : 0
  // Crop box in natural coordinates, centered on `center`.
  const box = useMemo(() => {
    if (frameNatural <= 0 || natural.w === 0) return { x: 0, y: 0, size: 0 }
    return { x: center.x - frameNatural / 2, y: center.y - frameNatural / 2, size: frameNatural }
  }, [center, frameNatural, natural])

  const clampAxis = (v: number, max: number, half: number) => {
    if (max <= 0) return 0
    // Frame bigger than the photo on this axis -> lock to the middle.
    if (half * 2 >= max) return max / 2
    return Math.max(half, Math.min(v, max - half))
  }
  const clampCenter = (c: { x: number; y: number }, halfN: number) => ({
    x: clampAxis(c.x, natural.w, halfN),
    y: clampAxis(c.y, natural.h, halfN),
  })

  // Keep the frame inside the stage and inside the rendered image.
  useEffect(() => {
    if (!imgRect) return
    const maxBase = Math.min(stageSize.w, stageSize.h) * 0.85
    const maxImg = Math.min(imgRect.width, imgRect.height) - 8
    const maxPx = Math.max(MIN_PX, Math.min(maxBase, maxImg))
    setSquarePx((cur) => Math.max(MIN_PX, Math.min(cur, maxPx)))
  }, [imgRect, stageSize])

  const onImageLoad = () => {
    const w = imgRef.current?.naturalWidth ?? 0
    const h = imgRef.current?.naturalHeight ?? 0
    setNatural({ w, h })
    setZoom(1)
    setCenter({ x: w / 2, y: h / 2 })
    setSquarePx(320)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const stage = stageRef.current
    if (!stage || !imgRect || box.size <= 0) return
    e.preventDefault()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch { /* already released */ }
    const sr = stage.getBoundingClientRect()
    const px = e.clientX - sr.left
    const py = e.clientY - sr.top
    const boxLeft = imgRect.left + box.x * imgRect.scale
    const boxTop = imgRect.top + box.y * imgRect.scale
    const boxSize = box.size * imgRect.scale // == squarePx
    // Corner grab (incl. the handle, which sticks out past the edge) -> resize.
    const cornerPad = 40
    if (px >= boxLeft + boxSize - cornerPad && py >= boxTop + boxSize - cornerPad) {
      dragRef.current = { mode: 'resize', startX: e.clientX, startY: e.clientY, origZoom: zoom, origSquarePx: squarePx, origCenter: center }
      return
    }
    if (px >= boxLeft && px <= boxLeft + boxSize && py >= boxTop && py <= boxTop + boxSize) {
      dragRef.current = { mode: 'move', startX: e.clientX, startY: e.clientY, origZoom: zoom, origSquarePx: squarePx, origCenter: center }
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d || !contain) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (d.mode === 'resize') {
      // Shrink the frame -> zoom the photo in (frame stays put on screen), grow
      // it -> zoom out. frameNatural therefore tracks the drag continuously.
      const maxBase = Math.min(stageSize.w, stageSize.h) * 0.85
      const maxImg = Math.min(imgRect ? imgRect.width : 0, imgRect ? imgRect.height : 0) - 8
      const maxPx = Math.max(MIN_PX, Math.min(maxBase, maxImg))
      const newPx = Math.max(MIN_PX, Math.min(d.origSquarePx + Math.max(dx, dy), maxPx))
      const newZoom = Math.min(MAX_ZOOM, Math.max(1, (d.origZoom * d.origSquarePx) / newPx))
      setZoom(newZoom)
      setSquarePx(newPx)
      setCenter((c) => clampCenter(c, newPx / (contain.ratio * newZoom) / 2))
    } else {
      const scale = contain.ratio * d.origZoom
      setCenter((c) => clampCenter({ x: d.origCenter.x - dx / scale, y: d.origCenter.y - dy / scale }, d.origSquarePx / (contain.ratio * d.origZoom) / 2))
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

  const boxStyle = imgRect && box.size > 0
    ? {
        left: imgRect.left + box.x * imgRect.scale,
        top: imgRect.top + box.y * imgRect.scale,
        width: box.size * imgRect.scale,
        height: box.size * imgRect.scale,
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
          style={imgRect ? { left: imgRect.left, top: imgRect.top, width: imgRect.width, height: imgRect.height } : undefined}
        />
        {box.size > 0 && imgRect && (
          <div className="avatar-crop-box" style={boxStyle}>
            <div className="avatar-crop-handle" />
          </div>
        )}
      </div>
      <div className="avatar-crop-hint">Drag the square to move it, drag the corner to zoom in and out. The square is what gets saved.</div>
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
