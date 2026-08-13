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

export type Disk = { name: string; path: string; free_gb?: number; total_gb?: number }

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

export type AuthStatus = { loggedIn: boolean; email: string | null }

export type UpdateInfo = {
  available: boolean
  current?: string | null
  latest?: string | null
  url?: string | null
  notes?: string[] | null
  error?: string
}
