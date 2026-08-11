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
  photoZoom: number
  onSetZoom: (z: number | ((prev: number) => number)) => void
  onClose: () => void
  onOpenLocation: (filePath: string) => void
  onRenamePerson: (personId: string) => void
  onDeletePhoto: () => void
  // Extra meta from the grid scope (person filter / search similarity)
  selectedPerson: string | null
  personName?: string
  gridFaceBoxes: Record<string, FaceBox | null>
}

export function PhotoModal({ photo, photoZoom, onSetZoom, onClose, onOpenLocation, onRenamePerson, onDeletePhoto, selectedPerson, personName, gridFaceBoxes }: PhotoModalProps) {
  const faceBoxForPhoto = gridFaceBoxes[photo.photo_id]
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-photo" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Photo</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="photo-stage">
            {/* Zoom controls */}
            <div className="photo-zoom-controls">
              <button className="btn btn-sm" onClick={() => onSetZoom((z: number) => Math.max(0.5, +(z - 0.25).toFixed(2)))}>−</button>
              <span className="photo-zoom-label">{Math.round(photoZoom * 100)}%</span>
              <button className="btn btn-sm" onClick={() => onSetZoom((z: number) => Math.min(4, +(z + 0.25).toFixed(2)))}>+</button>
              <button className="btn btn-sm" onClick={() => onSetZoom(1)}>Reset</button>
            </div>
            <div className="photo-scroll" style={{ cursor: photoZoom > 1 ? 'grab' : 'default' }}>
              <div className="photo-scaled" style={{ transform: `scale(${photoZoom})` }}>
                <img
                  className="modal-image"
                  src={`picly://src/${photo.photo_id}.jpg`}
                  alt=""
                />
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
            className="btn"
            onClick={() => onRenamePerson(photo.person_id || '')}
          >
            Rename person
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
