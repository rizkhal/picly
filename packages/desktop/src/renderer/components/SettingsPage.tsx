import { useEffect, useState } from 'react'
import { User, HardDrives, FaceMask, Brain, Info, Monitor, Sun, Moon } from '@phosphor-icons/react'
import type { AuthStatus, LocalModels, UpdateInfo } from '../types'
import type { ThemeMode } from '../hooks/useTheme'
import * as ipc from '../lib/electron'

type SettingsPageProps = {
  authStatus: AuthStatus
  onLogout: () => void
  onOpenAuth: (mode: 'login' | 'register') => void
  updateInfo: UpdateInfo | null
  updateChecking: boolean
  onCheckUpdate: () => void
  onOpenUpdate: () => void
  onClose: () => void
  showSingletons: boolean
  onToggleShowSingletons: () => void
  theme: ThemeMode
  onThemeChange: (theme: ThemeMode) => void
  section: SettingsSectionId
  onSectionChange: (section: SettingsSectionId) => void
}

type StoreStats = {
  photos: number
  faces: number
  persons: number
  folders: number
}

export type SettingsSectionId = 'appearance' | 'account' | 'storage' | 'faces' | 'models' | 'about'

function ModelRow({ title, desc, installed, latest }: { title: string; desc: string; installed: string | null; latest?: string | null }) {
  const hasNewer = !!latest && latest !== installed
  return (
    <div className="settings-model-row">
      <div className="settings-model-main">
        <div className="settings-model-title">{title}</div>
        <div className="settings-model-desc">{desc}</div>
      </div>
      <div className="settings-model-meta">
        <div className="settings-model-version">{installed || 'not found'}</div>
        {hasNewer && <div className="settings-model-newer">Latest: {latest}</div>}
      </div>
    </div>
  )
}

const MENU: Array<{ id: SettingsSectionId; label: string; icon: React.ReactNode }> = [
  { id: 'appearance', label: 'Appearance', icon: <Monitor size={16} /> },
  { id: 'account', label: 'Account', icon: <User size={16} /> },
  { id: 'storage', label: 'Storage', icon: <HardDrives size={16} /> },
  { id: 'faces', label: 'Faces', icon: <FaceMask size={16} /> },
  { id: 'models', label: 'Models (ML)', icon: <Brain size={16} /> },
  { id: 'about', label: 'About', icon: <Info size={16} /> },
]

export function SettingsPage({ authStatus, onLogout, onOpenAuth, updateInfo, updateChecking, onCheckUpdate, onOpenUpdate, onClose, showSingletons, onToggleShowSingletons, theme, onThemeChange, section, onSectionChange }: SettingsPageProps) {
  const [stats, setStats] = useState<StoreStats | null>(null)
  const [localModels, setLocalModels] = useState<LocalModels | null>(null)

  useEffect(() => {
    ipc.local.stats().then((s: any) => setStats(s || null))
    ipc.update.localModels().then((m) => setLocalModels(m))
  }, [])

  return (
    <div className="settings-page">
      <div className="settings-header">
        <div className="settings-title">Settings</div>
        <button className="modal-close" onClick={onClose}>×</button>
      </div>

      <div className="settings-layout">
        {/* Left: section menu */}
        <nav className="settings-nav">
          {MENU.map((m) => (
            <button
              key={m.id}
              className={`settings-nav-item${section === m.id ? ' active' : ''}`}
              onClick={() => onSectionChange(m.id)}
            >
              <span className="settings-nav-icon">{m.icon}</span>
              <span className="settings-nav-label">{m.label}</span>
            </button>
          ))}
        </nav>

        {/* Right: active section content */}
        <div className="settings-content">
          {section === 'appearance' && (
            <section className="settings-section">
              <div className="settings-section-title">Appearance</div>
              <div className="settings-row">
                <div className="settings-row-info">
                  <div className="settings-row-label">Theme</div>
                  <div className="settings-row-hint">Follow the system setting or force a dark / light appearance.</div>
                </div>
                <div className="theme-options" role="radiogroup" aria-label="Theme">
                  <button className={`theme-option${theme === 'system' ? ' active' : ''}`} role="radio" aria-checked={theme === 'system'} onClick={() => onThemeChange('system')}>
                    <Monitor size={14} /> System
                  </button>
                  <button className={`theme-option${theme === 'dark' ? ' active' : ''}`} role="radio" aria-checked={theme === 'dark'} onClick={() => onThemeChange('dark')}>
                    <Moon size={14} /> Dark
                  </button>
                  <button className={`theme-option${theme === 'light' ? ' active' : ''}`} role="radio" aria-checked={theme === 'light'} onClick={() => onThemeChange('light')}>
                    <Sun size={14} /> Light
                  </button>
                </div>
              </div>
            </section>
          )}

          {section === 'account' && (
            <section className="settings-section">
              <div className="settings-section-title">Account</div>
              {authStatus.loggedIn ? (
                <div className="settings-row">
                  <div className="settings-row-info">
                    <div className="settings-row-label">{authStatus.email}</div>
                    <div className="settings-row-hint">Connected</div>
                  </div>
                  <button className="btn" onClick={onLogout}>Logout</button>
                </div>
              ) : (
                <div className="settings-row">
                  <div className="settings-row-info">
                    <div className="settings-row-label">Not signed in</div>
                    <div className="settings-row-hint">Optional account — all local features keep working</div>
                  </div>
                  <div className="settings-row-actions">
                    <button className="btn" onClick={() => onOpenAuth('login')}>Login</button>
                    <button className="btn" onClick={() => onOpenAuth('register')}>Register</button>
                  </div>
                </div>
              )}
            </section>
          )}

          {section === 'storage' && (
            <section className="settings-section">
              <div className="settings-section-title">Storage</div>
              {stats ? (
                <div className="settings-stats">
                  <div className="stat-cell"><div className="stat-value">{stats.photos}</div><div className="stat-label">Photos</div></div>
                  <div className="stat-cell"><div className="stat-value">{stats.faces}</div><div className="stat-label">Faces</div></div>
                  <div className="stat-cell"><div className="stat-value">{stats.persons}</div><div className="stat-label">Persons</div></div>
                  <div className="stat-cell"><div className="stat-value">{stats.folders}</div><div className="stat-label">Folders</div></div>
                </div>
              ) : (
                <div className="settings-row-hint">Loading…</div>
              )}
            </section>
          )}

          {section === 'faces' && (
            <section className="settings-section">
              <div className="settings-section-title">Faces</div>
              <div className="settings-row">
                <div className="settings-row-info">
                  <div className="settings-row-label">Show one-time persons</div>
                  <div className="settings-row-hint">Crowded photos: people appearing only once are also shown in the face filter (blurry / low-quality ones stay hidden).</div>
                </div>
                <button
                  className={`toggle-btn ${showSingletons ? 'on' : ''}`}
                  role="switch"
                  aria-checked={showSingletons}
                  onClick={onToggleShowSingletons}
                  title={showSingletons ? 'Disable' : 'Enable'}
                >
                  <span className="toggle-knob" />
                </button>
              </div>
            </section>
          )}

          {section === 'models' && (
            <section className="settings-section">
              <div className="settings-section-title">Models (ML)</div>
              {!localModels ? (
                <div className="settings-row-hint">Loading…</div>
              ) : (
                <div className="settings-model-list">
                  <ModelRow
                    title="Face detection"
                    desc="SCRFD 10G — finds all faces in a photo."
                    installed={localModels.detector}
                    latest={updateInfo?.models?.detector}
                  />
                  <ModelRow
                    title="Face recognition"
                    desc="ArcFace (buffalo_l) — turns faces into embeddings for grouping."
                    installed={localModels.recognizer}
                    latest={updateInfo?.models?.recognizer}
                  />
                  <ModelRow
                    title="Face quality"
                    desc="eDifFIQA — scores sharpness before further processing."
                    installed={localModels.quality}
                    latest={updateInfo?.models?.quality}
                  />
                </div>
              )}
            </section>
          )}

          {section === 'about' && (
            <section className="settings-section">
              <div className="settings-section-title">About</div>
              <div className="settings-row">
                <div className="settings-row-info">
                  <div className="settings-row-label">
                    Picly
                    {updateInfo?.available && updateInfo?.latest && (
                      <span className="update-chip">Update available: {updateInfo.latest}</span>
                    )}
                  </div>
                  <div className="settings-row-hint">
                    Local photo manager — face recognition via ONNX (buffalo_l), all data on your device.
                  </div>
                  <div className="settings-row-hint">
                    Installed version: <span className="mono">{updateInfo?.current || '—'}</span>
                    {updateInfo?.latest && updateInfo?.latest !== updateInfo?.current && (
                      <> · Latest: <span className="mono">{updateInfo.latest}</span></>
                    )}
                  </div>
                  <div className="settings-row-hint">
                    {updateChecking ? 'Checking for updates…' : (
                      updateInfo?.available
                        ? (updateInfo.notes?.length ?? 0) > 0
                          ? updateInfo.notes!.join(' · ')
                          : 'A new version is available.'
                        : updateInfo?.error
                          ? `Update check failed (${updateInfo.error})`
                          : 'You are on the latest version.'
                    )}
                  </div>
                  {updateInfo?.available && updateInfo?.models && (
                    <div className="settings-row-hint">
                      Includes new models: {[updateInfo.models.detector, updateInfo.models.recognizer, updateInfo.models.quality].filter(Boolean).join(', ')}
                    </div>
                  )}
                </div>
                <div className="settings-row-actions">
                  {updateInfo?.available && updateInfo?.url && (
                    <button className="btn" onClick={onOpenUpdate}>Open page</button>
                  )}
                  <button className="btn" onClick={onCheckUpdate} disabled={updateChecking}>
                    {updateChecking ? 'Checking…' : 'Check for updates'}
                  </button>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
