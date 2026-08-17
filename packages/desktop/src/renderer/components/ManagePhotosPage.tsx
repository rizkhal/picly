import { useCallback, useEffect, useState } from 'react'
import { Folder, HardDrives, Image, WarningCircle, Database } from '@phosphor-icons/react'
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

type FolderBreakdown = {
  folderId: string
  hostPath: string
  name: string
  lastScannedAt: string | null
  photoCount: number
  faceCount: number
  personCount: number
  sizeBytes: number
  available: boolean
}

type StorageInfo = {
  photoBytes: number
  thumbBytes: number
}

function formatBytes(n: number): string {
  if (!n || n <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

/**
 * Manage photos — full-page view in the main panel (not a modal).
 * Library overview: summary stats, disk usage, per-folder breakdown.
 */
export function ManagePhotosPage({ onClose }: ManagePhotosPageProps) {
  const [stats, setStats] = useState<StoreStats | null>(null)
  const [folders, setFolders] = useState<FolderBreakdown[] | null>(null)
  const [storage, setStorage] = useState<StorageInfo | null>(null)

  const refresh = useCallback(async () => {
    ipc.local.stats().then((s: any) => setStats(s || null))
    ipc.local.folderBreakdown().then((f: any) => setFolders(f || null))
    ipc.local.libraryStorage().then((st: any) => setStorage(st || null))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return (
    <div className="settings-page manage-page">
      <div className="settings-header">
        <div className="settings-title">Manage photos</div>
        <button className="modal-close" onClick={onClose} title="Close">×</button>
      </div>

      <div className="settings-body">
        <div className="settings-section">
          <div className="settings-section-title">Library</div>
          <div className="manage-stats">
            <div className="manage-stat">
              <div className="manage-stat-icon"><Folder size={16} /></div>
              <div className="manage-stat-label">Folders</div>
              <div className="manage-stat-value">{stats?.folders ?? '—'}</div>
            </div>
            <div className="manage-stat">
              <div className="manage-stat-icon"><Image size={16} /></div>
              <div className="manage-stat-label">Photos</div>
              <div className="manage-stat-value">{stats?.photos ?? '—'}</div>
            </div>
            <div className="manage-stat">
              <div className="manage-stat-icon"><WarningCircle size={16} /></div>
              <div className="manage-stat-label">Faces</div>
              <div className="manage-stat-value">{stats?.faces ?? '—'}</div>
            </div>
            <div className="manage-stat">
              <div className="manage-stat-icon"><HardDrives size={16} /></div>
              <div className="manage-stat-label">Persons</div>
              <div className="manage-stat-value">{stats?.persons ?? '—'}</div>
            </div>
            <div className="manage-stat">
              <div className="manage-stat-icon"><Database size={16} /></div>
              <div className="manage-stat-label">Library size</div>
              <div className="manage-stat-value">{storage ? formatBytes(storage.photoBytes) : '—'}</div>
            </div>
            <div className="manage-stat">
              <div className="manage-stat-icon"><Image size={16} /></div>
              <div className="manage-stat-label">Thumbs & crops</div>
              <div className="manage-stat-value">{storage ? formatBytes(storage.thumbBytes) : '—'}</div>
            </div>
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-section-title">Folders</div>
          {!folders || folders.length === 0 ? (
            <div className="detail-empty">No folders indexed yet. Add a folder from the sidebar.</div>
          ) : (
            <div className="folder-breakdown-list">
              {folders.map((f) => (
                <div key={f.folderId} className={`folder-breakdown-row${f.available ? '' : ' offline'}`}>
                  <div className="folder-breakdown-info">
                    <div className="folder-breakdown-name">{f.name}</div>
                    <div className="folder-breakdown-path" title={f.hostPath}>{f.hostPath}</div>
                  </div>
                  <div className="folder-breakdown-meta">
                    <span>{f.photoCount} photos</span>
                    <span>· {f.faceCount} faces</span>
                    <span>· {f.personCount} persons</span>
                    <span>· {formatBytes(f.sizeBytes)}</span>
                    {!f.available && <span className="folder-offline-badge">offline</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
