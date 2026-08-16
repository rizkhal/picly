import { useEffect, useState } from 'react'
import { Folder, HardDrives, Image, WarningCircle } from '@phosphor-icons/react'
import * as ipc from '../lib/electron'

type ManagePhotosPageProps = {
  onClose: () => void
}

type StoreStats = {
  photos: number
  faces: number
  persons: number
  folders: number
}

/**
 * Manage photos — full-page view in the main panel (not a modal).
 * v1: overview of the indexed library (stats + per-folder breakdown).
 * Future: bulk actions (delete unassigned, dedupe, cleanup thumbs, etc.).
 */
export function ManagePhotosPage({ onClose }: ManagePhotosPageProps) {
  const [stats, setStats] = useState<StoreStats | null>(null)

  useEffect(() => {
    ipc.local.stats().then((s: any) => setStats(s || null))
  }, [])

  return (
    <div className="settings-page manage-page">
      <div className="settings-header">
        <div className="settings-title">Manage photos</div>
        <button className="modal-close" onClick={onClose} title="Close">×</button>
      </div>

      <div className="settings-body">
        <div className="settings-section">
          <div className="settings-section-title">Library summary</div>
          <div className="manage-stats">
            <div className="manage-stat">
              <Folder size={18} />
              <div className="manage-stat-label">Folders</div>
              <div className="manage-stat-value">{stats?.folders ?? '—'}</div>
            </div>
            <div className="manage-stat">
              <Image size={18} />
              <div className="manage-stat-label">Photos</div>
              <div className="manage-stat-value">{stats?.photos ?? '—'}</div>
            </div>
            <div className="manage-stat">
              <WarningCircle size={18} />
              <div className="manage-stat-label">Faces</div>
              <div className="manage-stat-value">{stats?.faces ?? '—'}</div>
            </div>
            <div className="manage-stat">
              <HardDrives size={18} />
              <div className="manage-stat-label">Persons</div>
              <div className="manage-stat-value">{stats?.persons ?? '—'}</div>
            </div>
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-section-title">Actions</div>
          <div className="manage-placeholder">
            Photo management features (clean up unused faces, duplicates, cleanup) coming soon.
          </div>
        </div>
      </div>
    </div>
  )
}
