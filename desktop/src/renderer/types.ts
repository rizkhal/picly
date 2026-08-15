export type Person = { person_id: string; name: string; photo_count: number }

export type Photo = {
  photo_id: string
  path: string
  thumb_path?: string
  similarity?: number
  person_id?: string
  person_name?: string
  face_id?: string
  matched_persons?: string[]
  width?: number | null
  height?: number | null
}

export type Folder = {
  folder_id: string
  host_path: string
  container_path: string
  name: string
  photo_count: number
  available: boolean
}

export type ScanStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled' | 'paused'

export type ScanProgress = {
  scan_id: string
  folder: string
  total: number
  processed: number
  scanned: number
  removed?: number
  total_faces: number
  persons: number
  thumbs_generated: number
  errors: number
  status: ScanStatus
  current_file?: string | null
  started_at?: number
  finished_at?: number | null
}

export type PersonPreview = { person_id: string; name: string; photo_count: number; face_id?: string }

/** A photo that was moved to the Trash (soft-deleted) and can be restored. */
export type TrashView = {
  photo_id: string
  path: string
  thumb_path?: string
  width?: number | null
  height?: number | null
}

export type AuthStatus = { loggedIn: boolean; email: string | null }

export type UpdateInfo = {
  available: boolean
  current?: string | null
  latest?: string | null
  url?: string | null
  notes?: string[] | null
  /** Latest ML models bundled with this release (detector/recognizer/quality). */
  models?: { detector?: string; recognizer?: string; quality?: string } | null
  error?: string
}

/** The ML models actually installed on this device (basename of each ONNX). */
export type LocalModels = {
  detector: string | null
  recognizer: string | null
  quality: string | null
}
