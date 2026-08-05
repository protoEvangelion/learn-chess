import type { ButtonHTMLAttributes, FC, ReactNode } from 'react'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode
  ghost?: boolean
  /** Icon-only circular control */
  icon?: boolean
}

/** Static action button — pixel type, no motion/beam animation. */
export const PixelButton: FC<Props> = ({
  children,
  ghost,
  icon,
  className,
  type = 'button',
  ...props
}) => (
  <button
    type={type}
    className={['pixel-btn', ghost ? 'ghost' : '', icon ? 'icon' : '', className]
      .filter(Boolean)
      .join(' ')}
    {...props}
  >
    {icon ? (
      children
    ) : (
      <span className="pixel-btn-label font-pixel-square">{children}</span>
    )}
  </button>
)
