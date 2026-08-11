import { useEffect, useRef } from 'react'
import type { FaceBox, Photo } from '../types'

type PhotoGridProps = {
  photos: Photo[]
  selectedPerson: string | null
  gridFaceBoxes: Record<string, FaceBox | null>
  onOpenPhoto: (photo: Photo) => void
}

export function PhotoGrid({ photos, selectedPerson, gridFaceBoxes, onOpenPhoto }: PhotoGridProps) {
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
          {selectedPerson && gridFaceBoxes[photo.photo_id] && (
            <div
              className="grid-face-box"
              style={{
                left: `${(gridFaceBoxes[photo.photo_id]!.x1 / (photo.width || 1)) * 100}%`,
                top: `${(gridFaceBoxes[photo.photo_id]!.y1 / (photo.height || 1)) * 100}%`,
                width: `${((gridFaceBoxes[photo.photo_id]!.x2 - gridFaceBoxes[photo.photo_id]!.x1) / (photo.width || 1)) * 100}%`,
                height: `${((gridFaceBoxes[photo.photo_id]!.y2 - gridFaceBoxes[photo.photo_id]!.y1) / (photo.height || 1)) * 100}%`,
              }}
            />
          )}
          {photo.face_id && (
            <img
              className="face-overlay"
              src={`picly://face/${photo.face_id}.jpg`}
              alt=""
              loading="lazy"
            />
          )}
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
  gridFaceBoxes: Record<string, FaceBox | null>
}

export function PhotoModal({ photo, photos, index, onNavigate, onClose, onOpenLocation, onDeletePhoto, selectedPerson, personName, gridFaceBoxes }: PhotoModalProps) {
  const faceBoxForPhoto = gridFaceBoxes[photo.photo_id]
  const prevIndex = index - 1
  const nextIndex = index + 1
  const hasPrev = prevIndex >= 0
  const hasNext = nextIndex < photos.length

  // Keyboard navigation while the modal is open: arrows prev/next, Esc close.
  // Only when the event target isn't an input/textarea.
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
            <div className="photo-scroll">
              <div className="photo-scaled">
                <img
                  className="modal-image"
                  src={`picly://src/${photo.photo_id}.jpg`}
                  alt=""
                />
              </div>
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
          >
            Delete photo
          </button>
        </div>
      </div>
    </div>
  )
}
