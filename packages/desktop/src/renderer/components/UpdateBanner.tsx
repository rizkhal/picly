import type { UpdateInfo } from '../types'

type UpdateBannerProps = {
  info: UpdateInfo
  onOpen: () => void
  onDismiss: () => void
}

export function UpdateBanner({ info, onOpen, onDismiss }: UpdateBannerProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: 'linear-gradient(135deg, #1a3a5c, #2d5a8a)', borderBottom: '1px solid rgba(255,255,255,0.1)', fontSize: 13 }}>
      <div style={{ flex: 1 }}>
        <strong>Update available — Picly {info.latest}</strong>
        {info.current && <span style={{ opacity: 0.7, marginLeft: 8 }}>(you have {info.current})</span>}
        {info.models && (
          <div style={{ opacity: 0.7, marginTop: 2, fontSize: 11 }}>
            Includes new ML models ({[info.models.detector, info.models.recognizer, info.models.quality].filter(Boolean).join(', ')})
          </div>
        )}
      </div>
      <button
        onClick={onOpen}
        style={{ padding: '6px 14px', borderRadius: 6, background: '#fff', border: 'none', color: '#1a3a5c', fontWeight: 600, cursor: 'pointer', fontSize: 12 }}
      >Update</button>
      <button
        onClick={onDismiss}
        style={{ padding: 6, borderRadius: 6, background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)', cursor: 'pointer', fontSize: 13 }}
        title="Close"
      >✕</button>
    </div>
  )
}
