/**
 * Spinner — shared loading indicator.
 * Renders the `.btn-spinner` CSS border spinner (same visual as the one used
 * on buttons). Size/weight props are accepted for icon-style usage; when used
 * inside a `.btn`, it matches the existing button spinner exactly.
 */
export function Spinner({ size = 11, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      className={`btn-spinner${className ? ` ${className}` : ''}`}
      style={size !== 11 ? { width: size, height: size } : undefined}
      aria-hidden="true"
    />
  )
}
