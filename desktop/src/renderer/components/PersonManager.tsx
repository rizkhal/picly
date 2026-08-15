import { useEffect, useMemo, useState } from 'react'
import { SplitHorizontal, X } from '@phosphor-icons/react'
import type { Person } from '../types'
import * as ipc from '../lib/electron'

type FaceRow = { faceId: string; photoPath: string | null; faceQuality: string }

const QUALITY_LABEL: Record<string, string> = {
  high: 'High',
  medium: 'Med',
  low: 'Low',
  very_low: 'V.Low',
}

/**
 * PersonManager — manual merge/split dialog with a live face-crop preview.
 *
 * WHY: offline HAC clustering is good but not perfect — the same person can
 * end up split across 2-3 clusters (over-split). Merge fixes that by joining
 * two+ persons into one; Split is the escape hatch when a cluster actually
 * contains two different people (false merge). Both are recorded in
 * `person_manual` so a startup re-cluster never un-does the user's edits.
 *
 * The right-hand rail previews the actual face crops inside the selected
 * person (with quality badge + source photo), so you can see WHO is in a
 * cluster before merging/splitting.
 */
type PersonManagerProps = {
  persons: Person[]
  onClose: () => void
  onMerge: (targetId: string, sourceIds: string[]) => Promise<void>
  onSplit: (personId: string) => Promise<void>
}

export function PersonManager({ persons, onClose, onMerge, onSplit }: PersonManagerProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [faces, setFaces] = useState<FaceRow[] | null>(null)
  const [facesLoading, setFacesLoading] = useState(false)

  const toggle = (id: string) => {
    setMsg(null)
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const canMerge = selected.size >= 2
  const canSplit = selected.size === 1

  // Preview: load face crops for the SINGLE selected person (merge picks a
  // target later; split shows exactly what will be split). Cleared when none
  // or multiple are selected.
  const previewPersonId = selected.size === 1 ? [...selected][0] : null
  useEffect(() => {
    if (!previewPersonId) {
      setFaces(null)
      setFacesLoading(false)
      return
    }
    let active = true
    setFacesLoading(true)
    setFaces([])
    ipc.local
      .listFacesForPerson(previewPersonId)
      .then((rows) => {
        if (active) setFaces(rows)
      })
      .finally(() => {
        if (active) setFacesLoading(false)
      })
    return () => { active = false }
  }, [previewPersonId])

  const previewPerson = previewPersonId ? persons.find((p) => p.person_id === previewPersonId) : null

  const merge = async () => {
    if (!canMerge) return
    setBusy(true)
    setMsg(null)
    const [target, ...sources] = [...selected]
    try {
      await onMerge(target, sources)
      setMsg(`Menggabungkan ${selected.size} person jadi 1.`)
      setSelected(new Set())
    } catch (e) {
      setMsg('Gagal merge — coba lagi.')
    } finally {
      setBusy(false)
    }
  }

  const split = async () => {
    if (!canSplit) return
    const [personId] = [...selected]
    const person = persons.find((p) => p.person_id === personId)
    if (!confirm(`Split "${person?.name || 'person'}" menjadi per-wajah? Semua wajahnya jadi person terpisah.`)) return
    setBusy(true)
    setMsg(null)
    try {
      await onSplit(personId)
      setMsg('Dipecah per-wajah.')
      setSelected(new Set())
    } catch (e) {
      setMsg('Gagal split — coba lagi.')
    } finally {
      setBusy(false)
    }
  }

  const selectionInfo = useMemo(() => {
    const names = [...selected]
      .map((id) => persons.find((p) => p.person_id === id)?.name)
      .filter(Boolean)
    return names.join(' + ')
  }, [selected, persons])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal person-manager" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Kelola Person</div>
          <button className="modal-close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="modal-body pm-body">
          {/* Left: person list + actions */}
          <div className="pm-main">
            <div className="pm-hint">
              Pilih 2+ person lalu <strong>Merge</strong> (gabungkan — orang yang sama
              kepecah). Pilih 1 person lalu <strong>Split</strong> (pecah per-wajah —
              cluster berisi orang berbeda). Perubahan tersimpan permanen (tidak
              di-undo oleh re-scan/cluster ulang).
            </div>

            <div className="pm-list">
              {persons.map((p) => {
                const isSel = selected.has(p.person_id)
                return (
                  <button
                    key={p.person_id}
                    className={`pm-item${isSel ? ' selected' : ''}`}
                    onClick={() => toggle(p.person_id)}
                  >
                    <span className="pm-check">{isSel ? '✓' : ''}</span>
                    <span className="pm-name">{p.name}</span>
                    <span className="pm-count">{p.photo_count} foto</span>
                  </button>
                )
              })}
            </div>

            {msg && <div className="pm-msg">{msg}</div>}

            <div className="modal-actions pm-actions">
              <span className="pm-selection" title={selectionInfo}>
                {selected.size === 0 ? 'Belum ada pilihan' : selectionInfo}
              </span>
              <button
                className="btn btn-primary"
                disabled={!canMerge || busy}
                onClick={merge}
                title="Gabungkan person terpilih jadi satu"
              >
                Merge ({selected.size})
              </button>
              <button
                className="btn"
                disabled={!canSplit || busy}
                onClick={split}
                title="Pecah person terpilih jadi per-wajah"
              >
                <SplitHorizontal size={14} /> Split
              </button>
            </div>
          </div>

          {/* Right: live face-crop preview of the single selected person */}
          <div className="pm-preview">
            <div className="pm-preview-title">
              {previewPerson
                ? `Wajah — ${previewPerson.name}`
                : selected.size > 1
                  ? 'Pilih 1 person untuk preview'
                  : 'Pilih person untuk lihat wajahnya'}
            </div>
            {facesLoading ? (
              <div className="pm-preview-empty">Memuat wajah…</div>
            ) : previewPersonId && faces && faces.length > 0 ? (
              <div className="pm-preview-grid">
                {faces.map((f) => (
                  <div key={f.faceId} className="pm-face" title={f.photoPath || ''}>
                    <img src={`picly://face/${f.faceId}.jpg`} alt="" loading="lazy" />
                    <span className={`pm-face-quality q-${f.faceQuality}`}>
                      {QUALITY_LABEL[f.faceQuality] || f.faceQuality}
                    </span>
                  </div>
                ))}
              </div>
            ) : previewPersonId ? (
              <div className="pm-preview-empty">Tidak ada wajah (mungkin belum di-scan ulang).</div>
            ) : (
              <div className="pm-preview-empty">—</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
