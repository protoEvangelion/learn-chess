import type { ButtonHTMLAttributes, FC, ReactNode } from 'react'
import {
  PixelHeading,
  type PixelHeadingMode,
} from '@/components/ui/pixel-heading-character'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode
  ghost?: boolean
  mode?: PixelHeadingMode
  autoPlay?: boolean
}

/** Text button with Cult UI pixel-heading character animation. */
export const PixelButton: FC<Props> = ({
  children,
  ghost,
  className,
  mode = 'wave',
  autoPlay = true,
  type = 'button',
  ...props
}) => (
  <button
    type={type}
    className={['pixel-btn', ghost ? 'ghost' : '', className]
      .filter(Boolean)
      .join(' ')}
    {...props}
  >
    <PixelHeading
      as="span"
      mode={mode}
      autoPlay={autoPlay}
      cycleInterval={120}
      staggerDelay={35}
      defaultFontIndex={2}
      className="pixel-btn-label"
    >
      {children}
    </PixelHeading>
  </button>
)
