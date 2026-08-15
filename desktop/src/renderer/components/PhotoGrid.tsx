import { useEffect, useRef, useState } from 'react'
import type { Photo } from '../types'
import * as ipc from '../lib/electron'

type ModalFace = { faceId: string; x1: number; y1: number; x2: number; y2: number; personId: string | null; personName: string | null }

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
}

export function PhotoModal({ photo, photos, index, onNavigate, onClose, onOpenLocation, onDeletePhoto, selectedPerson, personName }: PhotoModalProps) {
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

  // Native (non-passive) wheel listener so pinch-zoom can preventDefault.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        // Trackpad pinch (macOS) arrives as ctrlKey wheel. Zoom toward cursor.
        e.preventDefault()
        const rect = el.getBoundingClientRect()
        const cx = e.clientX - rect.left
        const cy = e.clientY - rect.top
        setZoom((z) => {
          const dy = Math.max(-100, Math.min(100, e.deltaY))
          const s2 = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z.s * Math.exp(-dy * 0.01)))
          if (s2 === z.s) return z
          if (s2 <= ZOOM_MIN) return { s: ZOOM_MIN, tx: 0, ty: 0 }
          const k = s2 / z.s
          return clampPan({ s: s2, tx: cx - (cx - z.tx) * k, ty: cy - (cy - z.ty) * k }, el, imgRef.current)
        })
      } else if (zoomRef.current.s > ZOOM_MIN) {
        // Two-finger scroll while zoomed pans instead of page scrolling.
        e.preventDefault()
        setZoom((z) =>
          clampPan(
            { ...z, tx: z.tx - (e.shiftKey ? e.deltaY : e.deltaX), ty: z.ty - e.deltaY },
            el,
            imgRef.current,
          ),
        )
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Drag-to-pan while zoomed (mouse/trackpad click-drag, ala Mac).
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (zoomRef.current.s <= ZOOM_MIN) return
    e.preventDefault()
    dragRef.current = { x: e.clientX, y: e.clientY, tx: zoomRef.current.tx, ty: zoomRef.current.ty }
    setDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d) return
    setZoom((z) =>
      clampPan({ ...z, tx: d.tx + (e.clientX - d.x), ty: d.ty + (e.clientY - d.y) }, scrollRef.current, imgRef.current),
    )
  }
  const endDrag = () => {
    dragRef.current = null
    setDragging(false)
  }

  // Faces (bbox + person) for the CURRENT photo — fetched when the photo or
  // the selected person filter changes. Used to draw the selected-person
  // rectangle even when the grid didn't pre-fetch boxes for this photo.
  const [faces, setFaces] = useState<ModalFace[]>([])
  useEffect(() => {
    let active = true
    setFaces([])
    ipc.local.photoFaces(photo.photo_id).then((rows) => {
      if (active) setFaces(rows)
    })
    return () => { active = false }
  }, [photo.photo_id])

  // Rectangle for the selected person in this photo: find the face whose
  // person matches the active person filter (fetched via photoFaces).
  const faceBoxForPhoto = selectedPerson ? faces.find((f) => f.personId === selectedPerson) ?? null : null
  const prevIndex = index - 1
  const nextIndex = index + 1
  const hasPrev = prevIndex >= 0
  const hasNext = nextIndex < photos.length

  // Keyboard navigation while the modal is open: arrows prev/next, Esc close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') { if (hasPrev) onNavigate(prevIndex) }
      else if (e.key === 'ArrowRight') { if (hasNext) onNavigate(nextIndex) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hasPrev, hasNext, prevIndex, nextIndex, onClose, onNavigate])

  // Auto-scroll the rail so the active photo stays visible
  const railRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [photo.photo_id])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-photo" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Photo {index + 1} / {photos.length}</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body photo-viewer">
          <div className="photo-stage">
            <div
              className="photo-scroll"
              ref={scrollRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onDoubleClick={resetZoom}
              style={{ cursor: zoom.s > 1 ? (dragging ? 'grabbing' : 'grab') : undefined }}
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
                  />
                  {faceBoxForPhoto && (
                    <div
                      className={`face-box${selectedPerson ? ' active' : ''}`}
                      style={{
                        left: `${(faceBoxForPhoto.x1 / (photo.width || 1)) * 100}%`,
                        top: `${(faceBoxForPhoto.y1 / (photo.height || 1)) * 100}%`,
                        width: `${((faceBoxForPhoto.x2 - faceBoxForPhoto.x1) / (photo.width || 1)) * 100}%`,
                        height: `${((faceBoxForPhoto.y2 - faceBoxForPhoto.y1) / (photo.height || 1)) * 100}%`,
                      }}
                    />
                  )}
                </div>
              </div>
              {zoom.s > 1 && (
                <button
                  className="photo-zoom-badge"
                  onClick={resetZoom}
                  title="Kembali ke ukuran asli (double-click)"
                >
                  {Math.round(zoom.s * 100)}%
                </button>
              )}
            </div>
          </div>
          {/* Photo rail — thumbnails of the current scope for quick navigation */}
          <div className="photo-rail" ref={railRef}>
            <div className="photo-rail-title">Semua di scope</div>
            <div className="photo-rail-grid">
              {photos.map((p, i) => (
                <div
                  key={p.photo_id}
                  ref={i === index ? activeRef : undefined}
                  className={`rail-thumb${i === index ? ' active' : ''}`}
                  onClick={() => onNavigate(i)}
                  title={p.path}
                >
                  <img src={p.thumb_path || `picly://thumb/${p.photo_id}.jpg`} alt="" loading="lazy" />
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="modal-meta">
          <div>ID: {photo.photo_id}</div>
          <div>Path: {photo.path}</div>
          {photo.width && photo.height && (
            <div>Original: {photo.width}×{photo.height}</div>
          )}
          {faceBoxForPhoto !== undefined && selectedPerson && (
            <div>Highlight: wajah terpilih ditandai di grid</div>
          )}
          {photo.similarity !== undefined && (
            <div>Similarity: {Math.round(photo.similarity * 100)}%</div>
          )}
          {photo.person_id && (
            <div>Person: {personName || 'Unknown'}</div>
          )}
        </div>
        <div className="modal-actions">
          <button
            className="btn"
            onClick={() => onOpenLocation(photo.path)}
            title="Reveal the original file in Finder"
          >
            Buka lokasi
          </button>
          <button
            className="btn btn-danger"
            onClick={onDeletePhoto}
            title="Pindah ke Trash (bisa di-restore)"
          >
            Pindah ke Trash
          </button>
        </div>
      </div>
    </div>
  )
}
