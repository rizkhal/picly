import { useCallback, useEffect, useRef, useState } from 'react'
import type { ScanProgress } from '../types'
import * as ipc from '../lib/electron'

const PAUSED_KEY = 'picly:paused-scans'
const DISMISSED_KEY = 'picly:dismissed-scans'

function loadPaused(): Record<string, ScanProgress> {
  try {
    const raw = localStorage.getItem(PAUSED_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function loadDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY)
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch {
    return new Set()
  }
}

function persistPaused(next: Record<string, ScanProgress>) {
  try { localStorage.setItem(PAUSED_KEY, JSON.stringify(next)) } catch { /* ignore */ }
}

function persistDismissed(next: Set<string>) {
  try { localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next])) } catch { /* ignore */ }
}

export function useScans(onRefresh: () => void) {
  const [activeScans, setActiveScans] = useState<ScanProgress[]>([])
  const [pausedScans, setPausedScans] = useState<Record<string, ScanProgress>>(loadPaused)
  const [dismissedScans, setDismissedScans] = useState<Set<string>>(loadDismissed)

  // Keep a ref of current scans so handlers never read stale state
  const scansRef = useRef<ScanProgress[]>([])
  useEffect(() => {
    scansRef.current = activeScans
  }, [activeScans])

  // Scan ids whose main-process scan should be ignored forever: paused, removed,
  // or cancelled ids. The main process can still emit straggler events (the final
  // 'cancelled' sent when its done promise resolves) AFTER we've resumed or
  // deleted the row — those must never re-add a row. Scan ids are unique per
  // scan, so once an id is ignored it never needs to be un-ignored.
  const ignoredIdsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    // Paused scans restored from storage on reload: their main-process scan may
    // still be running (reload doesn't kill main), so their events must be
    // ignored too. Only ever add — never remove.
    for (const id of Object.keys(pausedScans)) ignoredIdsRef.current.add(id)
  }, [pausedScans])

  // A scan is in flight until every tracked scan has finished
  const scanning = activeScans.some((s) => s.status === 'queued' || s.status === 'running')

  // Add folder(s) — scan directly via local services (no backend); live progress
  // is streamed via the 'local:scan-progress' IPC event.
  const startScanFor = useCallback(async (hostPaths: string[], mode: 'add' | 'rescan' = 'add') => {
    const started: ScanProgress[] = []
    for (const hostPath of hostPaths) {
      const data = mode === 'rescan' ? await ipc.local.rescanFolder(hostPath) : await ipc.local.scanFolder(hostPath)
      if (data?.scanId) {
        started.push({ scan_id: data.scanId, folder: hostPath, status: 'queued', total: 0, processed: 0, scanned: 0, total_faces: 0, persons: 0, thumbs_generated: 0, errors: 0 })
      }
    }
    if (started.length > 0) setActiveScans((prev) => [...prev, ...started])
  }, [])

  // Pick folder(s) then scan
  const scanFolder = useCallback(async () => {
    const paths = await ipc.shell.selectFolder()
    if (paths.length === 0) return
    await startScanFor(paths)
  }, [startScanFor])

  // Re-scan an existing folder — delta sync (add new, remove missing)
  const rescanFolder = useCallback(async (hostPath: string) => {
    await startScanFor([hostPath], 'rescan')
  }, [startScanFor])

  // Pause a running scan — cancel main's scan, persist the state so a reload
  // restores it with Resume/Hapus actions. Photos already scanned stay indexed.
  const pauseScan = useCallback(async (scanId: string) => {
    const current = activeScans.find((s) => s.scan_id === scanId)
    if (!current) return
    // Register FIRST (synchronously) so the 'cancelled' event main sends during
    // cancelScan is ignored — otherwise the UI flickers to stopped then back.
    // Once ignored, the id stays ignored forever (see ignoredIdsRef).
    ignoredIdsRef.current.add(scanId)
    await ipc.local.cancelScan(scanId)
    // Freeze the progress so Resume knows where to continue from
    const frozen = { ...current, status: 'paused' as const }
    setActiveScans((prev) => prev.map((s) => (s.scan_id === scanId ? frozen : s)))
    setPausedScans((prev) => {
      const next = { ...prev, [scanId]: frozen }
      persistPaused(next)
      return next
    })
  }, [activeScans])

  // Resume a paused scan — re-scan the same folder; the resume filter (in
  // startScan) skips already-indexed files so it continues from the remainder.
  const resumeScan = useCallback(async (scanId: string) => {
    const paused = pausedScans[scanId]
    if (!paused) return
    // Clear the persisted entry first so a reload during the re-scan doesn't
    // restore it as paused again. Also drop the old row — the resumed scan gets
    // a fresh scan_id, so without this the sidebar would show two rows.
    setPausedScans((prev) => {
      const next = { ...prev }
      delete next[scanId]
      persistPaused(next)
      return next
    })
    // Old id stays in ignoredIdsRef — the resumed scan gets a fresh scan_id, so
    // the old id's straggler 'cancelled' event must not re-add a row (double).
    setActiveScans((prev) => prev.filter((s) => s.scan_id !== scanId))
    await startScanFor([paused.folder])
  }, [pausedScans, startScanFor])

  // Remove a paused scan entry entirely (no photos deleted, just the status).
  // Defensively ignore the id here too — even if this scan never went through
  // pauseScan, its straggler events must never re-add a row.
  const removeScan = useCallback((scanId: string) => {
    ignoredIdsRef.current.add(scanId)
    setPausedScans((prev) => {
      const next = { ...prev }
      delete next[scanId]
      persistPaused(next)
      return next
    })
    setActiveScans((prev) => prev.filter((s) => s.scan_id !== scanId))
  }, [])

  // Remove a finished scan from the sidebar (ringkasan yang sudah selesai)
  const dismissScan = useCallback((scanId: string) => {
    setDismissedScans((prev) => {
      const next = new Set(prev)
      next.add(scanId)
      persistDismissed(next)
      return next
    })
  }, [])

  // Restore paused scans after a reload — main's in-process scan is gone, but
  // the persisted paused entries come back so the user can Resume or Hapus.
  const recoverScans = useCallback(() => {
    setActiveScans((prev) => {
      const existing = new Set(prev.map((s) => s.scan_id))
      const restored = Object.values(pausedScans).filter((s) => !existing.has(s.scan_id))
      return restored.length > 0 ? [...prev, ...restored] : prev
    })
  }, [pausedScans])

  // Live scan progress — streamed from main.cjs via IPC events (no polling).
  // When all tracked scans reach a terminal state, refresh the UI.
  useEffect(() => {
    const unsubscribe = ipc.local.onScanProgress((p: any) => {
      const scanId = p.scanId || p.scan_id
      // Any event for an ignored id (paused/cancelled/removed) is dropped — the
      // main process can still emit straggler progress + a final 'cancelled'
      // after the row is gone. Those must never re-add or re-run a row.
      if (ignoredIdsRef.current.has(scanId)) return
      const normalized: ScanProgress = {
        scan_id: scanId,
        folder: p.folder || '',
        total: p.total ?? 0,
        processed: p.processed ?? 0,
        scanned: p.scanned ?? 0,
        removed: p.removed ?? 0,
        total_faces: p.totalFaces ?? p.total_faces ?? 0,
        persons: p.persons ?? 0,
        thumbs_generated: p.thumbsGenerated ?? p.thumbs_generated ?? 0,
        errors: p.errors ?? 0,
        status: p.status || 'running',
        current_file: p.currentFile ?? p.current_file ?? null,
      }
      setActiveScans((prev) => {
        const byId = new Map(prev.map((s) => [s.scan_id, s]))
        byId.set(normalized.scan_id, normalized)
        return Array.from(byId.values())
      })
      // Terminal state -> refresh index so the UI reflects the new scan
      if (p.status === 'done' || p.status === 'error' || p.status === 'cancelled') {
        onRefresh()
      }
    })
    return () => unsubscribe?.()
  }, [onRefresh])

  return {
    activeScans,
    pausedScans,
    dismissedScans,
    scanning,
    scansRef,
    startScanFor,
    scanFolder,
    rescanFolder,
    pauseScan,
    resumeScan,
    removeScan,
    dismissScan,
    recoverScans,
  }
}
