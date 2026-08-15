import { useEffect, useRef, useState } from 'react'
import { PencilSimple, LinkBreak } from '@phosphor-icons/react'
import type { Photo, Person } from '../types'
import * as ipc from '../lib/electron'

type ModalFace = { faceId: string; x1: number; y1: number; x2: number; y2: number; personId: string | null; personName: string | null; faceQuality?: string; lowQuality?: boolean; qualityScore?: number }

// --- Pinch-zoom / pan state for the modal photo preview ---
// The image renders at natural size, constrained to the stage width
// (max-width: 100%). .photo-frame wraps exactly the image (width: fit-content,
// no min-width) so face boxes in PERCENTAGES are pixel-accurate. The frame is
// centered in the stage by flex; tall photos grow the stage and scroll.
// Transform translate(tx,ty) scale(s) with origin top-left, s >= 1 (unzoomed
// is s=1, tx/ty=0). Panning is clamped so the image never leaves the viewport.
type ZoomState = { s: number; tx: number; ty: number }
const ZOOM_MIN = 1
const ZOOM_MAX = 10

function clampPan(z: ZoomState, el: HTMLElement | null, img: HTMLImageElement | null): ZoomState {
  if (z.s <= ZOOM_MIN) return { s: ZOOM_MIN, tx: 0, ty: 0 }
  if (!el || !img) return z
  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
  const cw = el.clientWidth
  const ch = el.clientHeight
  const iw = img.clientWidth * z.s
  const ih = img.clientHeight * z.s
  return {
    s: z.s,
    tx: clamp(z.tx, Math.min(0, cw - iw), Math.max(0, cw - iw)),
    ty: clamp(z.ty, Math.min(0, ch - ih), Math.max(0, ch - ih)),
  }
}

type PhotoGridProps = {
  photos: Photo[]
  onOpenPhoto: (photo: Photo) => void
}

export function PhotoGrid({ photos, onOpenPhoto }: PhotoGridProps) {
  return (
    <div className="photo-grid">
      {photos.map((photo) => (
        <div
          key={photo.photo_id}
          className="photo-card"
          onClick={() => onOpenPhoto(photo)}
        >
          <img
            src={photo.thumb_path || `picly://thumb/${photo.photo_id}.jpg`}
            alt=""
            loading="lazy"
          />
          {photo.similarity !== undefined && (
            <div className="similarity">{Math.round(photo.similarity * 100)}%</div>
          )}
        </div>
      ))}
    </div>
  )
}

/**
 * One face row inside the detail panel: crop thumbnail + person name (inline
 * editable) + actions. Rename edits the whole person (all its faces); unassign
 * detaches this single face; an unassigned face can be joined to the currently
 * filtered person. Low-quality crops are blurred so low-res/out-of-focus faces
 * don't dominate the panel.
 */
function DetailFaceRow({ face, onEdited }: {
  face: ModalFace
  onEdited: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')

  const startEdit = () => {
    if (!face.personId) return
    setName(face.personName || '')
    setEditing(true)
  }

  const save = async () => {
    if (!face.personId) return
    const trimmed = name.trim()
    setEditing(false)
    if (!trimmed || trimmed === face.personName) return
    await ipc.local.renamePerson(face.personId, trimmed)
    onEdited()
  }

  const unassign = async () => {
    if (!face.personId) return
    if (!confirm(`Lepas wajah ini dari "${face.personName}"?`)) return
    await ipc.local.setFacePerson(face.faceId, null)
    onEdited()
  }

  const low = face.lowQuality || face.faceQuality === 'very_low'
  const pct = face.qualityScore != null ? Math.round(face.qualityScore * 100) : null

  return (
    <div className="detail-face">
      <div className={`detail-face-img-wrap${low ? ' blur' : ''}`}>
        <img className="detail-face-img" src={`picly://face/${face.faceId}.jpg`} alt="" loading="lazy" />
      </div>
      <div className="detail-face-info">
        {editing ? (
          <input
            className="detail-face-name-input"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save()
              else if (e.key === 'Escape') setEditing(false)
            }}
            onBlur={save}
          />
        ) : (
          <div className="detail-face-name" title={face.personName || 'Belum di-assign'}>
            {face.personName || 'Belum di-assign'}
          </div>
        )}
        <div className="detail-face-sub">
          <span>{Math.max(1, Math.round(face.x2 - face.x1))}px{pct != null ? ` · ${pct}%` : ''}</span>
        </div>
      </div>
      <div className="detail-face-actions">
        {face.personId && !editing && (
          <button className="detail-icon-btn" title="Rename person" onClick={startEdit}>
            <PencilSimple size={13} />
          </button>
        )}
        {face.personId && !editing && (
          <button className="detail-icon-btn danger" title="Lepas wajah dari person" onClick={unassign}>
            <LinkBreak size={13} />
          </button>
        )}
      </div>
    </div>
  )
}

type PhotoModalProps = {
  photo: Photo
  photos: Photo[]
  index: number
  onNavigate: (index: number) => void
  onClose: () => void
  onOpenLocation: (filePath: string) => void
  onDeletePhoto: () => void
  // Extra meta from the grid scope (person filter / search similarity)
  selectedPerson: string | null
  personName?: string
  persons?: Person[]
  // Click-face-to-filter: navigate to a person (or open manage for unassigned)
  onFaceClick: (personId: string) => void
  // Called after a person edit (rename/unassign/assign) so the sidebar + grid
  // refresh with the new names/counts.
  onPersonChanged: () => void
}

export function PhotoModal({ photo, photos, index, onNavigate, onClose, onOpenLocation, onDeletePhoto, selectedPerson, personName, persons = [], onFaceClick, onPersonChanged }: PhotoModalProps) {
  // Pinch-zoom: scale + pan (trackpad pinch zooms to cursor; two-finger
  // scroll / drag pans when zoomed; double-click resets). Reset per photo.
  const [zoom, setZoom] = useState<ZoomState>({ s: 1, tx: 0, ty: 0 })
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    setZoom({ s: 1, tx: 0, ty: 0 })
    dragRef.current = null
  }, [photo.photo_id])

  const resetZoom = () => {
    setZoom({ s: ZOOM_MIN, tx: 0, ty: 0 })
    dragRef.current = null
  }

  // --- Faces for the overlay + detail panel ---
  const [faces, setFaces] = useState<ModalFace[]>([])
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null)
  const [assignFace, setAssignFace] = useState<ModalFace | null>(null)
  const [assignSearch, setAssignSearch] = useState('')

  const loadFaces = async () => {
    const rows = await ipc.local.photoFaces(photo.photo_id)
    setFaces((rows || []).map((r) => ({ ...r })))
  }

  useEffect(() => {
    loadFaces()
  }, [photo.photo_id])

  // Assign a face (picked from the preview) to an explicit person.
  const assignFaceTo = async (personId: string) => {
    if (!assignFace) return
    await ipc.local.setFacePerson(assignFace.faceId, personId)
    setAssignFace(null)
    setAssignSearch('')
    await refreshFaces()
  }

  // Called after rename / unassign / assign — refetch faces (names change) and
  // let the parent refresh sidebar + grid counts.
  const refreshFaces = async () => {
    await loadFaces()
    onPersonChanged()
  }

  // Face boxes are positioned in % of the image (the .photo-frame wraps exactly
  // the image, so % == raw image coordinates scaled to display size).
  const dims =
    photo.width && photo.height
      ? { w: photo.width, h: photo.height }
      : imgSize
  const faceBoxes = dims
    ? faces.map((f) => ({
        ...f,
        left: (f.x1 / dims.w) * 100,
        top: (f.y1 / dims.h) * 100,
        width: ((f.x2 - f.x1) / dims.w) * 100,
        height: ((f.y2 - f.y1) / dims.h) * 100,
      }))
    : []

  // --- Pinch-zoom: ctrl+wheel (trackpad pinch), zoom to cursor ---
  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    const el = scrollRef.current
    const img = imgRef.current
    if (!el || !img) return
    const rect = el.getBoundingClientRect()
    const z = zoomRef.current
    const px = clientX - rect.left
    const py = clientY - rect.top
    const s = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z.s * factor))
    const ix = (px - z.tx) / z.s
    const iy = (py - z.ty) / z.s
    setZoom(clampPan({ s, tx: px - ix * s, ty: py - iy * s }, el, img))
  }

  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey) return // plain scroll / trackpad two-finger scroll
    e.preventDefault()
    zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const t = e.target as HTMLElement
    if (t.closest('.face-box') || t.closest('button')) return
    if (zoomRef.current.s <= ZOOM_MIN) return
    e.preventDefault()
    dragRef.current = { x: e.clientX, y: e.clientY, tx: zoomRef.current.tx, ty: zoomRef.current.ty }
    setDragging(true)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    const el = scrollRef.current
    const img = imgRef.current
    if (!el || !img) return
    const d = dragRef.current
    const next = clampPan(
      { s: zoomRef.current.s, tx: d.tx + (e.clientX - d.x), ty: d.ty + (e.clientY - d.y) },
      el,
      img,
    )
    setZoom(next)
  }

  const endDrag = () => {
    dragRef.current = null
    setDragging(false)
  }

  // --- Keyboard: Esc closes, ←/→ navigates (skip while typing a name) ---
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') onNavigate(index + 1)
      else if (e.key === 'ArrowLeft') onNavigate(index - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onNavigate, index])

  // Keep the active rail thumbnail in view when navigating
  const railRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [index])

  const base = (p: string) => {
    const parts = p.split('/')
    return parts[parts.length - 1]
  }

  return (
    <div className="modal-overlay">
      <div className="modal modal-photo">
        <div className="modal-header">
          <div className="modal-title">
            <span className="modal-title-name" title={photo.path}>{base(photo.path)}</span>
            <span className="modal-title-count">{index + 1} / {photos.length}{personName ? ` · ${personName}` : ''}</span>
          </div>
          <button className="modal-close" onClick={onClose} title="Tutup (Esc)">×</button>
        </div>

        <div className="modal-body">
          <div className="modal-main-row">
            {/* Left: full-res photo stage with face overlay + zoom/pan */}
            <div className="photo-stage">
              <div
                ref={scrollRef}
                className="photo-scroll"
                onWheel={onWheel}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerLeave={endDrag}
                onDoubleClick={resetZoom}
                style={{
                  touchAction: 'none',
                  cursor: dragging ? 'grabbing' : zoom.s > 1 ? 'grab' : undefined,
                }}
              >
                <div className="photo-stage-inner">
                  <div
                    className="photo-frame"
                    style={{ transform: `translate(${zoom.tx}px, ${zoom.ty}px) scale(${zoom.s})` }}
                  >
                    <img
                      ref={imgRef}
                      className="modal-image"
                      src={`picly://src/${photo.photo_id}.jpg`}
                      alt=""
                      draggable={false}
                      onLoad={(e) => {
                        const im = e.currentTarget
                        setImgSize({ w: im.naturalWidth, h: im.naturalHeight })
                      }}
                    />
                    {faceBoxes.map((f) => (
                      <div
                        key={f.faceId}
                        className={`face-box${f.personId === selectedPerson ? ' active' : ''}${!f.personId ? ' unassigned' : ''}`}
                        style={{
                          left: `${f.left}%`,
                          top: `${f.top}%`,
                          width: `${f.width}%`,
                          height: `${f.height}%`,
                        }}
                        title={f.personName || 'Klik untuk assign ke person'}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (f.personId) onFaceClick(f.personId)
                          else {
                            setAssignFace(f)
                            setAssignSearch('')
                          }
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>
              {zoom.s > 1 && (
                <button className="photo-zoom-badge" onClick={resetZoom} title="Reset zoom (double-click)">
                  {Math.round(zoom.s * 100)}%
                </button>
              )}
            </div>

            {/* Right: detail panel — info + editable face/person list */}
            <aside className="detail-panel">
              <div className="detail-panel-header">
                <div className="detail-photo-name" title={photo.path}>{base(photo.path)}</div>
                <div className="detail-photo-meta">
                  {dims ? `${dims.w}×${dims.h}px` : ''}{dims ? ' · ' : ''}{faces.length} wajah
                </div>
              </div>
              <div className="detail-face-list">
                {selectedPerson && (
                  <>
                    <div className="detail-section-title">Selected person</div>
                    {faces.filter((f) => f.personId === selectedPerson).map((f) => (
                      <DetailFaceRow
                        key={f.faceId}
                        face={f}
                        onEdited={refreshFaces}
                      />
                    ))}
                  </>
                )}
                <div className="detail-section-title">Semua wajah di foto ({faces.filter((f) => f.personId !== null && f.personId !== selectedPerson).length})</div>
                {faces.filter((f) => f.personId !== null && f.personId !== selectedPerson).length === 0 ? (
                  <div className="detail-empty">Tidak ada wajah lain di foto ini.</div>
                ) : (
                  faces.filter((f) => f.personId !== null && f.personId !== selectedPerson).map((f) => (
                    <DetailFaceRow
                      key={f.faceId}
                      face={f}
                      onEdited={refreshFaces}
                    />
                  ))
                )}
              </div>

              {/* Assign picker — shown when an unassigned face box is clicked */}
              {assignFace && (
                <div className="detail-picker detail-picker-anchored">
                  <div className="detail-picker-header">Assign wajah ke person…</div>
                  <input
                    className="detail-picker-search"
                    autoFocus
                    placeholder="Cari person… (Esc untuk tutup)"
                    value={assignSearch}
                    onChange={(e) => setAssignSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') { setAssignFace(null); setAssignSearch('') }
                    }}
                  />
                  <div className="detail-picker-list">
                    {persons.filter((p) => {
                      const s = assignSearch.trim().toLowerCase()
                      return !s || p.name.toLowerCase().includes(s)
                    }).length === 0 && (
                      <div className="detail-picker-empty">Tidak ada person yang cocok.</div>
                    )}
                    {persons
                      .filter((p) => {
                        const s = assignSearch.trim().toLowerCase()
                        return !s || p.name.toLowerCase().includes(s)
                      })
                      .sort((a, b) => {
                        if (a.person_id === selectedPerson) return -1
                        if (b.person_id === selectedPerson) return 1
                        return b.photo_count - a.photo_count
                      })
                      .map((p) => (
                        <button key={p.person_id} className="detail-picker-item" onClick={() => assignFaceTo(p.person_id)}>
                          <span className="detail-picker-name">{p.name}</span>
                          <span className="detail-picker-count">{p.photo_count} foto</span>
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </aside>
          </div>

          {/* Bottom: thumbnail rail — horizontal scroll, navigates scope */}
          <div className="photo-rail" ref={railRef}>
            <div className="photo-rail-title">
              <span>Photos in scope</span>
              <div className="photo-rail-nav">
                <button onClick={() => onNavigate(index - 1)} disabled={index <= 0} title="Sebelumnya (←)">‹</button>
                <button onClick={() => onNavigate(index + 1)} disabled={index >= photos.length - 1} title="Berikutnya (→)">›</button>
              </div>
            </div>
            <div className="photo-rail-grid">
              {photos.map((p, i) => (
                <button
                  key={p.photo_id}
                  ref={i === index ? activeRef : undefined}
                  className={`rail-thumb${i === index ? ' active' : ''}`}
                  onClick={() => onNavigate(i)}
                >
                  <img src={p.thumb_path || `picly://thumb/${p.photo_id}.jpg`} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={() => onOpenLocation(photo.path)}>Buka lokasi</button>
          <button className="btn btn-danger" onClick={onDeletePhoto}>Pindah ke Trash</button>
        </div>
      </div>
    </div>
  )
}
