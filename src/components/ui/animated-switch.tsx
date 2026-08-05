/**
 * Cult UI–style animated switch — adapted for Vite (no Tailwind).
 * Spring thumb + frosted track for compact settings rows.
 */
import { motion } from 'motion/react'
import type { ButtonHTMLAttributes, FC } from 'react'

type Props = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'onChange' | 'children'
> & {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  size?: 'sm' | 'md'
}

const THUMB_X = { sm: 16, md: 20 } as const

export const AnimatedSwitch: FC<Props> = ({
  checked,
  onCheckedChange,
  disabled,
  className,
  size = 'sm',
  id,
  ...props
}) => (
  <button
    type="button"
    role="switch"
    id={id}
    aria-checked={checked}
    disabled={disabled}
    className={['anim-switch', `anim-switch-${size}`, className]
      .filter(Boolean)
      .join(' ')}
    onClick={() => {
      if (disabled) return
      onCheckedChange(!checked)
    }}
    {...props}
  >
    <span className="anim-switch-track" data-checked={checked || undefined}>
      <motion.span
        className="anim-switch-thumb"
        initial={false}
        animate={{ x: checked ? THUMB_X[size] : 0 }}
        transition={{ type: 'spring', stiffness: 520, damping: 34, mass: 0.55 }}
      />
    </span>
  </button>
)
