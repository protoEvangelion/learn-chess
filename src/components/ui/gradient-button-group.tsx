/**
 * Cult UI GradientButtonGroup — adapted for Vite (no Tailwind / next-themes).
 * @see https://www.cult-ui.com/docs/components/gradient-button-group
 */
import { useEffect, useState, type FC, type ReactNode } from 'react'
import { animate, LayoutGroup, useMotionValue } from 'motion/react'
import * as motion from 'motion/react-client'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

export type GradientButtonItem = {
  id: string
  label: string
  icon: ReactNode
  onClick: () => void
  disabled?: boolean
}

type Props = {
  items: GradientButtonItem[]
  /** Id that gets the spinning gradient ring (e.g. coach when open). */
  activeId?: string | null
  /** Unique per instance so multiple groups don’t share layoutIds. */
  layoutGroupId: string
  ariaLabel?: string
  className?: string
}

function InnerButtonOverlay({ active }: { active: boolean }) {
  const overlayProgress = useMotionValue(active ? 1 : 0)

  useEffect(() => {
    const controls = animate(overlayProgress, active ? 1 : 0, {
      delay: active ? 0.02 : 0,
      duration: active ? 0.18 : 0.14,
      ease: 'easeOut',
    })
    return () => controls.stop()
  }, [active, overlayProgress])

  return (
    <motion.span
      initial={false}
      className="gbg-inner-overlay"
      animate={
        active
          ? {
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.08)',
            }
          : {
              borderWidth: 0,
              borderColor: 'transparent',
              boxShadow: 'none',
            }
      }
      transition={{ borderColor: { duration: 0.16, ease: 'easeOut' } }}
      style={{ borderStyle: 'solid' }}
    />
  )
}

export const GradientButtonGroup: FC<Props> = ({
  items,
  activeId = null,
  layoutGroupId,
  ariaLabel = 'Actions',
  className,
}) => {
  const [overlayReadyId, setOverlayReadyId] = useState<string | null>(activeId)

  useEffect(() => {
    if (!activeId) setOverlayReadyId(null)
  }, [activeId])

  return (
    <TooltipProvider delayDuration={350}>
      <LayoutGroup id={layoutGroupId}>
        <div className={['gbg', className].filter(Boolean).join(' ')}>
          <div className="gbg-tray" aria-hidden="true" />
          <div className="gbg-raised">
            <div className="gbg-bezel" aria-hidden="true" />
            <nav className="gbg-nav" aria-label={ariaLabel}>
              {items.map((item) => {
                const isActive = activeId === item.id
                const isOverlayActive = isActive && overlayReadyId === item.id

                return (
                  <Tooltip key={item.id}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className={[
                          'gbg-btn',
                          isActive ? 'is-active' : '',
                          item.disabled ? 'is-disabled' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        aria-label={item.label}
                        aria-pressed={isActive || undefined}
                        disabled={item.disabled}
                        onClick={item.onClick}
                      >
                        {isActive && (
                          <>
                            <motion.span
                              layoutId={`${layoutGroupId}-well`}
                              className="gbg-well"
                              transition={{
                                type: 'spring',
                                stiffness: 400,
                                damping: 30,
                              }}
                            />
                            <motion.span
                              layoutId={`${layoutGroupId}-gold-ring`}
                              className="gbg-gold-ring"
                              onLayoutAnimationComplete={() =>
                                setOverlayReadyId(item.id)
                              }
                              transition={{
                                type: 'spring',
                                stiffness: 400,
                                damping: 30,
                              }}
                            >
                              <span className="gbg-gold-spin" />
                            </motion.span>
                            <motion.span
                              layoutId={`${layoutGroupId}-inner-ring`}
                              className="gbg-inner-ring"
                              transition={{
                                type: 'spring',
                                stiffness: 400,
                                damping: 30,
                              }}
                            />
                          </>
                        )}
                        <motion.span
                          initial={false}
                          className={[
                            'gbg-btn-face',
                            isActive ? 'is-active' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          animate={
                            isActive
                              ? { scale: 1, opacity: 1 }
                              : { scale: 0.985, opacity: 0.96 }
                          }
                          transition={{
                            type: 'spring',
                            stiffness: 380,
                            damping: 30,
                            delay: isActive ? 0.12 : 0,
                          }}
                        >
                          <InnerButtonOverlay active={!!isOverlayActive} />
                          <span className="gbg-icon">{item.icon}</span>
                        </motion.span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="bottom"
                      sideOffset={8}
                      className="z-[80]"
                    >
                      {item.label}
                    </TooltipContent>
                  </Tooltip>
                )
              })}
            </nav>
          </div>
        </div>
      </LayoutGroup>
    </TooltipProvider>
  )
}

/** Bot / coach glyph. */
export function CoachBotIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <path d="M9 13v2" />
      <path d="M15 13v2" />
    </svg>
  )
}

/**
 * Side mark for the seat-flip control. A filled king in that side's color,
 * with a contrasting rim so both read on the dark toolbar.
 */
export function SeatKingIcon({
  color,
  spinning = false,
}: {
  color: 'white' | 'black'
  spinning?: boolean
}) {
  const white = color === 'white'
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      className={['hud-seat-mark', spinning ? 'is-spinning' : '']
        .filter(Boolean)
        .join(' ')}
      aria-hidden="true"
    >
      <path
        fill={white ? '#f6f3ec' : '#140e1c'}
        stroke={white ? '#241536' : '#f6f3ec'}
        strokeWidth={white ? 0.9 : 1.15}
        strokeLinejoin="round"
        d="M10.6 1.1h2.8v2.2h3.3v2.8h-3.3v2.3h-2.8V6.1H7.3V3.3h3.3z
           M8.4 10.7c0-.6 1.6-.85 3.6-.85s3.6.25 3.6.6v1.15H8.4z
           M6.9 11.2h10.2l.55 1.25H6.35z
           M7.3 12.7h9.4l1.35 4.7H5.95z
           M4.4 17.65h15.2v1.85H4.4z
           M5.7 19.75h12.6v1.85H5.7z"
      />
    </svg>
  )
}
