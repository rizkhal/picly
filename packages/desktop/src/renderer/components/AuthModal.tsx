type AuthModalProps = {
  mode: 'login' | 'register'
  email: string
  password: string
  busy: boolean
  error: string | null
  onEmail: (v: string) => void
  onPassword: (v: string) => void
  onSubmit: () => void
  onClose: () => void
  onSwitchMode: () => void
}

export function AuthModal({ mode, email, password, busy, error, onEmail, onPassword, onSubmit, onClose, onSwitchMode }: AuthModalProps) {
  return (
    <div className="auth-modal-overlay" onClick={onClose}>
      <div className="auth-modal" onClick={(e) => e.stopPropagation()}>
        <div className="auth-modal-title">
          {mode === 'login' ? 'Sign in' : 'Create account'}
        </div>
        <div className="auth-modal-hint">
          Account for entitlement & updates. Photos stay 100% local on this device.
        </div>

        <label className="auth-label">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => onEmail(e.target.value)}
          placeholder="you@email.com"
          className="auth-input"
        />

        <label className="auth-label">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => onPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !busy) onSubmit() }}
          placeholder="At least 8 characters"
          className="auth-input"
        />

        {error && (
          <div className="auth-error">{error}</div>
        )}

        <button
          onClick={onSubmit}
          disabled={busy}
          className="auth-submit"
        >
          {busy ? 'Processing…' : mode === 'login' ? 'Sign in' : 'Sign up'}
        </button>

        <div className="auth-switch">
          {mode === 'login' ? (
            <>No account yet?{' '}
              <span onClick={onSwitchMode}>Sign up</span>
            </>
          ) : (
            <>Already have an account?{' '}
              <span onClick={onSwitchMode}>Sign in</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
