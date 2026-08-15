import { Folder, Plus, Trash, Pause, Play, X } from '@phosphor-icons/react'
import type { ScanProgress } from '../types'

type ScanProgressPageProps = {
  scans: ScanProgress[]
  scanning: boolean
  onPause: (scanId: string) => void
  onResume: (scanId: string) => void
  onRemove: (scanId: string) => void
  onDismiss: (scanId: string) => void
  onAddFolder: () => void
  onClose: () => void
}

function ScanRow({
  scan, onPause, onResume, onRemove, onDismiss,
}: {
  scan: ScanProgress
  onPause: (scanId: string) => void
  onResume: (scanId: string) => void
  onRemove: (scanId: string) => void
  onDismiss: (scanId: string) => void
}) {
  const total = scan.total || 0
  const processed = scan.processed || 0
  const pct = total > 0
    ? Math.min(100, Math.round((processed / total) * 100))
    : (scan.status === 'done' || scan.status === 'error' ? 100 : 0)
  const name = (scan.folder || '').split('/').filter(Boolean).pop() || 'Folder'
  const isQueued = scan.status === 'queued'
  const isRunning = scan.status === 'running'
  const isPaused = scan.status === 'paused'
  const isDone = scan.status === 'done'
  const isError = scan.status === 'error'
  const isCancelled = scan.status === 'cancelled'

  return (
    <div className={`queue-row ${isPaused ? 'paused' : ''} ${isDone ? 'done' : ''} ${isError ? 'error' : ''}`}>
      <div className="queue-row-main">
        <div className="queue-row-name" title={scan.folder}>{name}</div>
        <div className="queue-row-status">
          {isQueued ? 'Queued…' : isRunning ? `${processed}/${total}` : isPaused ? `⏸ Paused — ${processed}/${total}` : isDone ? `✓ ${scan.scanned} photos` : isCancelled ? 'Stopped' : 'Failed'}
        </div>
        <div className="queue-row-sub">
          {isRunning && scan.current_file ? (
            <span title={scan.current_file}>{scan.current_file.split('/').pop()}</span>
          ) : isQueued ? (
            <span>Waiting for a previous scan to finish…</span>
          ) : isPaused ? (
            <span className="scan-paused-line">Paused — Resume untuk lanjut dari sisa</span>
          ) : isDone ? (
            <span className="scan-done-line">
              {scan.scanned} new · {scan.total_faces} faces · {scan.persons} persons
              {scan.removed ? ` · ${scan.removed} removed` : ''}
              {scan.errors ? ` · ${scan.errors} errors` : ''}
            </span>
          ) : isCancelled ? (
            <span className="scan-cancelled-line">Stopped at {processed} of {total} files</span>
          ) : isError ? (
            <span className="scan-error-line">Scan failed{scan.errors ? ` (${scan.errors} errors)` : ''}</span>
          ) : null}
        </div>
        {!isDone && !isError && !isCancelled && (
          <div className="progress-bar">
            <div className={`progress-fill${isPaused ? ' paused' : ''}`} style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      <div className="queue-row-actions">
        {(isQueued || isRunning) && (
          <button className="scan-pause-btn" title="Pause scan" onClick={() => onPause(scan.scan_id)}>
            <Pause size={14} weight="bold" />
          </button>
        )}
        {isPaused && (
          <>
            <button className="scan-resume-btn" title="Lanjutkan scan" onClick={() => onResume(scan.scan_id)}>
              <Play size={14} weight="bold" />
            </button>
            <button className="scan-delete-btn" title="Hapus scan" onClick={() => onRemove(scan.scan_id)}>
              <Trash size={14} weight="bold" />
            </button>
          </>
        )}
        {(isDone || isError || isCancelled) && (
          <button className="scan-dismiss-btn" title="Sembunyikan" onClick={() => onDismiss(scan.scan_id)}>
            <X size={14} weight="bold" />
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Scan progress — full-page view of all scans (active, paused, finished).
 * No modal: this page is the single place for scan progress + resume/remove.
 */
export function ScanProgressPage({ scans, scanning, onPause, onResume, onRemove, onDismiss, onAddFolder, onClose }: ScanProgressPageProps) {
  const activeCount = scans.filter((s) => s.status === 'queued' || s.status === 'running').length
  return (
    <div className="settings-page manage-page scan-queue-page">
      <div className="settings-header">
        <div className="settings-title">
          Scan progress
          {activeCount > 0 && <span className="queue-header-count">{activeCount} berjalan</span>}
        </div>
        <div className="settings-header-actions">
          <button className="btn" onClick={onAddFolder} disabled={scanning}>
            {scanning ? <span className="btn-spinner" /> : <Plus size={14} />} Add folder
          </button>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
      </div>

      <div className="settings-body">
        <div className="settings-section">
          <div className="settings-section-title">Daftar scan</div>
          {scans.length === 0 ? (
            <div className="queue-empty">
              <Folder size={28} />
              <p>Tidak ada scan.</p>
              <p>Tambahkan folder untuk mulai meng-index foto.</p>
            </div>
          ) : (
            <div className="queue-list">
              {scans.map((s) => (
                <ScanRow key={s.scan_id} scan={s} onPause={onPause} onResume={onResume} onRemove={onRemove} onDismiss={onDismiss} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
