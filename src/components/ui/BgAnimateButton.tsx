import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react'

type Animation = 'spin-slow' | 'spin' | 'spin-fast' | 'pulse'
type Gradient = 'ocean' | 'nebula' | 'default' | 'forest' | 'sunset'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode
  /** Cult UI bg-animate-button animation. Default spin-slow (8s). */
  animation?: Animation
  gradient?: Gradient
  /** Speeds the conic spin while a request is in flight. */
  loading?: boolean
}

/**
 * Cult UI–style bg-animate-button (no Tailwind).
 * @see https://www.cult-ui.com/docs/components/bg-animate-button
 */
export const BgAnimateButton = forwardRef<HTMLButtonElement, Props>(
  function BgAnimateButton(
    {
      children,
      className,
      animation = 'spin-slow',
      gradient = 'ocean',
      loading = false,
      disabled,
      type = 'button',
      ...props
    },
    ref,
  ) {
    const spin: Animation = loading ? 'spin-fast' : animation
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled}
        aria-busy={loading || undefined}
        className={[
          'bg-animate-btn',
          `is-${gradient}`,
          `is-${spin}`,
          loading ? 'is-loading' : '',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        {...props}
      >
        <span className="bg-animate-btn-spin" aria-hidden />
        <span className="bg-animate-btn-label font-pixel-square">
          {children}
        </span>
      </button>
    )
  },
)
