import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Folder, HardDrives, Image, WarningCircle, Trash, Copy, UserMinus, FileX, Eraser } from '@phosphor-icons/react'
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

type CleanupStats = {
  unassignedFaces: number
  lowQualityFaces: number
  duplicateGroups: number
  duplicatePhotos: number
  emptyPersons: number
  orphanThumbs: number
}

type DupGroup = {
  hash: string
  photos: Array<{ photoId: string; path: string; thumbUrl?: string | null; thumbPath?: string | null }>
}

/**
 * Manage photos — full-page view in the main panel (not a modal).
 * v1: overview of the indexed library (stats + per-folder breakdown).
 * Cleanup: unassigned/low-quality faces, duplicate photos, empty persons,
 * orphan thumb files. Every action shows its count first and confirms before
 * running (all irreversible).
 */
export function ManagePhotosPage({ onClose }: ManagePhotosPageProps) {
  const [stats, setStats] = useState<StoreStats | null>(null)
  const [cleanup, setCleanup] = useState<CleanupStats | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [dups, setDups] = useState<DupGroup[] | null>(null)

  const refresh = useCallback(async () => {
    ipc.local.stats().then((s: any) => setStats(s || null))
    ipc.local.cleanupStats().then((c: any) => setCleanup(c || null))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const run = async (action: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(action)
    setMsg(null)
    try {
      const n = await fn()
      setMsg(done.replace('{n}', String(n ?? 0)))
    } catch (e) {
      console.error(`${action} failed`, e)
      setMsg(`${done} failed — try again.`)
    } finally {
      setBusy(null)
      refresh()
    }
  }

  const cleanupUnassigned = () => {
    const n = cleanup?.unassignedFaces ?? 0
    if (n === 0) return
    if (!confirm(`Remove ${n} unassigned face${n === 1 ? '' : 's'} permanently? They'll be gone from the photo (box + crop), and can't be linked later.`)) return
    run('unassigned', () => ipc.local.cleanupUnassignedFaces(), `Removed {n} unassigned faces.`)
  }

  const cleanupLowQuality = () => {
    const n = cleanup?.lowQualityFaces ?? 0
    if (n === 0) return
    if (!confirm(`Remove ${n} very low-quality face${n === 1 ? '' : 's'} permanently? (Blurry / too-small faces that can't be recognized.)`)) return
    run('lowquality', () => ipc.local.cleanupLowQualityFaces(), `Removed {n} low-quality faces.`)
  }

  const cleanupEmpty = () => {
    const n = cleanup?.emptyPersons ?? 0
    if (n === 0) return
    if (!confirm(`Remove ${n} empty person${n === 1 ? '' : 's'} (no faces)? These are invisible in the UI anyway.`)) return
    run('emptypersons', () => ipc.local.cleanupEmptyPersons(), `Removed {n} empty persons.`)
  }

  const cleanupOrphans = () => {
    const n = cleanup?.orphanThumbs ?? 0
    if (n === 0) return
    if (!confirm(`Delete ${n} orphan thumbnail/crop file${n === 1 ? '' : 's'}? (Leftover files no longer referenced by any photo or face.)`)) return
    run('orphans', () => ipc.local.cleanupOrphanThumbs(), `Deleted {n} orphan files.`)
  }

  const openDupReview = async () => {
    setBusy('dups')
    try {
      const groups = await ipc.local.cleanupDuplicates()
      setDups(groups || [])
    } catch (e) {
      console.error('cleanupDuplicates failed', e)
    } finally {
      setBusy(null)
    }
  }

  const deleteDupPhoto = async (_groupId: string, photoId: string) => {
    // Soft-delete (Trash) — the review modal is the safe path for dupes.
    await ipc.local.deletePhoto(photoId)
    setDups((prev) => {
      if (!prev) return prev
      return prev
        .map((g) => ({ ...g, photos: g.photos.filter((p) => p.photoId !== photoId) }))
        .filter((g) => g.photos.length > 1)
    })
    refresh()
  }

  const row = (label: string, desc: string, count: number, onClick: () => void, icon: ReactNode, actionLabel = 'Remove') => (
    <div className="cleanup-row">
      <div className="cleanup-icon">{icon}</div>
      <div className="cleanup-info">
        <div className="cleanup-label">{label}</div>
        <div className="cleanup-desc">{desc}</div>
      </div>
      <div className="cleanup-count">{count}</div>
      <button className="btn btn-sm" disabled={count === 0 || !!busy} onClick={onClick}>
        {actionLabel}
      </button>
    </div>
  )

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
          <div className="settings-section-title">Cleanup</div>
          {msg && <div className="cleanup-msg">{msg}</div>}
          <div className="cleanup-list">
            {row(
              'Unassigned faces',
              'Faces not assigned to any person (removed permanently from the photo).',
              cleanup?.unassignedFaces ?? 0,
              cleanupUnassigned,
              <UserMinus size={16} />,
            )}
            {row(
              'Low-quality faces',
              'Very blurry / too-small faces that can\'t be recognized.',
              cleanup?.lowQualityFaces ?? 0,
              cleanupLowQuality,
              <FileX size={16} />,
            )}
            {row(
              'Duplicate photos',
              'Same photo indexed more than once (same content hash).',
              cleanup?.duplicatePhotos ?? 0,
              openDupReview,
              <Copy size={16} />,
              'Review',
            )}
            {row(
              'Empty persons',
              'Persons with no faces (invisible in the UI).',
              cleanup?.emptyPersons ?? 0,
              cleanupEmpty,
              <UserMinus size={16} />,
            )}
            {row(
              'Orphan files',
              'Thumbnail/crop files no longer referenced by any photo or face.',
              cleanup?.orphanThumbs ?? 0,
              cleanupOrphans,
              <Eraser size={16} />,
            )}
          </div>
        </div>
      </div>

      {/* Duplicate review modal — safest path for duplicates (pick which to keep) */}
      {dups && (
        <div className="modal-overlay" onClick={() => setDups(null)}>
          <div className="modal dup-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">
                Duplicate photos
                {dups.length > 0 && <span className="modal-title-count">{dups.length} group{dups.length === 1 ? '' : 's'}</span>}
              </div>
              <button className="modal-close" onClick={() => setDups(null)} title="Close (Esc)">×</button>
            </div>
            <div className="dup-modal-body">
              {dups.length === 0 ? (
                <div className="detail-empty">No duplicates found.</div>
              ) : (
                dups.map((g, gi) => (
                  <div key={g.hash} className="dup-group">
                    <div className="dup-group-title">Group {gi + 1}</div>
                    <div className="dup-group-photos">
                      {g.photos.map((p) => (
                        <div key={p.photoId} className="dup-photo">
                          <img src={p.thumbUrl || p.thumbPath || ''} alt="" loading="lazy" />
                          <div className="dup-photo-path" title={p.path}>{p.path}</div>
                          <button
                            className="btn btn-sm btn-danger"
                            onClick={() => deleteDupPhoto(g.hash, p.photoId)}
                            title="Move this copy to Trash"
                          >
                            <Trash size={13} /> Trash
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
