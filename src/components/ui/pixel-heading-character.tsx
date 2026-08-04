/**
 * Cult UI Pixel Heading (character) — adapted for Vite (no Tailwind/shadcn).
 * @see https://www.cult-ui.com/docs/components/pixel-heading-character
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react'

const PIXEL_FONTS = [
  'font-pixel-square',
  'font-pixel-grid',
  'font-pixel-circle',
  'font-pixel-triangle',
  'font-pixel-line',
] as const

const FONT_LABELS = ['Square', 'Grid', 'Circle', 'Triangle', 'Line'] as const
const FONT_COUNT = PIXEL_FONTS.length

const PREFIX_FONT_MAP: Record<string, string> = {
  square: 'font-pixel-square',
  grid: 'font-pixel-grid',
  circle: 'font-pixel-circle',
  triangle: 'font-pixel-triangle',
  line: 'font-pixel-line',
}

const ISOLATE_FONT_MAP: Record<string, string> = {
  sans: 'font-sans',
  mono: 'font-mono',
}

function resolveIsolateFont(value: string): string {
  return ISOLATE_FONT_MAP[value] ?? value
}

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

const PHI = (1 + Math.sqrt(5)) / 2
const TICK_MS = 50

function goldenBase(index: number): number {
  return Math.floor((index * PHI * FONT_COUNT) % FONT_COUNT)
}

function pseudoRandom(tick: number, index: number): number {
  return ((tick * 2654435761 + index * 340573321) >>> 0) % FONT_COUNT
}

function extractText(children: ReactNode): string {
  if (typeof children === 'string') return children
  if (typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(extractText).join('')
  if (
    children !== null &&
    children !== undefined &&
    typeof children === 'object' &&
    'props' in children
  ) {
    return extractText(
      (children as ReactElement<{ children?: ReactNode }>).props.children,
    )
  }
  return ''
}

export type PixelHeadingMode = 'uniform' | 'multi' | 'wave' | 'random'

export type PixelHeadingProps = {
  children: ReactNode
  as?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'span'
  className?: string
  cycleInterval?: number
  defaultFontIndex?: number
  onFontIndexChange?: (index: number) => void
  showLabel?: boolean
  mode?: PixelHeadingMode
  staggerDelay?: number
  autoPlay?: boolean
  prefix?: string
  prefixFont?: 'square' | 'grid' | 'circle' | 'triangle' | 'line' | 'none'
  isolate?: Record<string, string>
  /** When false, skip tabIndex (use inside buttons). */
  focusable?: boolean
} & Omit<ComponentProps<'h1'>, 'as' | 'children'>

export function PixelHeading({
  children,
  as: Tag = 'h1',
  className,
  cycleInterval = 150,
  defaultFontIndex = 0,
  onFontIndexChange,
  showLabel = false,
  mode = 'multi',
  staggerDelay = 50,
  autoPlay = false,
  prefix,
  prefixFont = 'none',
  isolate,
  focusable,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
  onKeyDown,
  ...props
}: PixelHeadingProps) {
  const text = useMemo(() => extractText(children), [children])
  const [msElapsed, setMsElapsed] = useState(0)
  const [isActive, setIsActive] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const prevUniformIndex = useRef(defaultFontIndex)
  const canFocus = focusable ?? Tag !== 'span'

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  useEffect(() => {
    if (!autoPlay) return
    setIsActive(true)
    setMsElapsed(0)
    intervalRef.current = setInterval(() => {
      setMsElapsed((prev) => prev + TICK_MS)
    }, TICK_MS)
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [autoPlay])

  const charFonts = useMemo(() => {
    const fonts: number[] = []
    let vi = 0
    for (let i = 0; i < text.length; i++) {
      if (text[i] === ' ') {
        fonts.push(-1)
        continue
      }
      switch (mode) {
        case 'uniform': {
          const cycles = Math.floor(msElapsed / cycleInterval)
          fonts.push((defaultFontIndex + cycles) % FONT_COUNT)
          break
        }
        case 'multi': {
          const base = goldenBase(vi)
          const charMs = Math.max(0, msElapsed - vi * staggerDelay)
          const cycles = Math.floor(charMs / cycleInterval)
          fonts.push((base + cycles) % FONT_COUNT)
          break
        }
        case 'wave': {
          const charMs = Math.max(0, msElapsed - vi * staggerDelay)
          const cycles = Math.floor(charMs / cycleInterval)
          fonts.push((vi + cycles) % FONT_COUNT)
          break
        }
        case 'random': {
          const charMs = Math.max(0, msElapsed - vi * staggerDelay)
          const cycles = Math.floor(charMs / cycleInterval)
          fonts.push(cycles > 0 ? pseudoRandom(cycles, vi) : goldenBase(vi))
          break
        }
      }
      vi++
    }
    return fonts
  }, [text, mode, msElapsed, cycleInterval, staggerDelay, defaultFontIndex])

  useEffect(() => {
    if (mode !== 'uniform') return
    const idx = charFonts.find((f) => f !== -1) ?? defaultFontIndex
    if (idx !== prevUniformIndex.current) {
      prevUniformIndex.current = idx
      onFontIndexChange?.(idx)
    }
  }, [charFonts, mode, defaultFontIndex, onFontIndexChange])

  const activeLabel = useMemo(() => {
    if (mode === 'uniform') {
      const idx = charFonts.find((f) => f !== -1) ?? 0
      return FONT_LABELS[idx]
    }
    const modeLabels: Record<PixelHeadingMode, string> = {
      uniform: '',
      multi: 'Multi',
      wave: 'Wave',
      random: 'Random',
    }
    return modeLabels[mode]
  }, [mode, charFonts])

  const startCycling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    setIsActive(true)
    setMsElapsed(0)
    intervalRef.current = setInterval(() => {
      setMsElapsed((prev) => prev + TICK_MS)
    }, TICK_MS)
  }, [])

  const stopCycling = useCallback(() => {
    if (autoPlay) {
      setIsActive(true)
      return
    }
    setIsActive(false)
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [autoPlay])

  const handleMouseEnter = useCallback(
    (e: MouseEvent<HTMLElement>) => {
      startCycling()
      onMouseEnter?.(e as MouseEvent<HTMLHeadingElement>)
    },
    [startCycling, onMouseEnter],
  )

  const handleMouseLeave = useCallback(
    (e: MouseEvent<HTMLElement>) => {
      stopCycling()
      onMouseLeave?.(e as MouseEvent<HTMLHeadingElement>)
    },
    [stopCycling, onMouseLeave],
  )

  const handleFocus = useCallback(
    (e: FocusEvent<HTMLElement>) => {
      startCycling()
      onFocus?.(e as FocusEvent<HTMLHeadingElement>)
    },
    [startCycling, onFocus],
  )

  const handleBlur = useCallback(
    (e: FocusEvent<HTMLElement>) => {
      stopCycling()
      onBlur?.(e as FocusEvent<HTMLHeadingElement>)
    },
    [stopCycling, onBlur],
  )

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        if (canFocus) e.preventDefault()
        setMsElapsed((prev) => prev + cycleInterval)
      }
      onKeyDown?.(e as KeyboardEvent<HTMLHeadingElement>)
    },
    [cycleInterval, onKeyDown, canFocus],
  )

  const uniformIdx =
    mode === 'uniform'
      ? (charFonts.find((f) => f !== -1) ?? defaultFontIndex)
      : 0

  return (
    <div data-slot="pixel-heading" className="pixel-heading">
      <Tag
        data-state={isActive ? 'active' : 'idle'}
        data-mode={mode}
        aria-label={prefix ? `${prefix} ${text}` : text}
        tabIndex={canFocus ? 0 : undefined}
        className={cn(
          'pixel-heading-text',
          mode === 'uniform' && PIXEL_FONTS[uniformIdx],
          className,
        )}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        {...props}
      >
        {prefix && (
          <>
            <span
              className={
                prefixFont !== 'none' ? PREFIX_FONT_MAP[prefixFont] : undefined
              }
              aria-hidden
            >
              {prefix}
            </span>
            <span> </span>
          </>
        )}

        {mode === 'uniform'
          ? children
          : text.split('').map((char, i) =>
              char === ' ' ? (
                <span key={i}> </span>
              ) : isolate?.[char] ? (
                <span
                  key={i}
                  className={resolveIsolateFont(isolate[char])}
                  aria-hidden
                >
                  {char}
                </span>
              ) : (
                <span
                  key={i}
                  className={PIXEL_FONTS[charFonts[i]]}
                  aria-hidden
                >
                  {char}
                </span>
              ),
            )}
      </Tag>
      {showLabel && (
        <output
          data-slot="pixel-heading-label"
          aria-live="polite"
          className={cn(
            'pixel-heading-label',
            isActive || autoPlay ? 'is-visible' : '',
          )}
        >
          {activeLabel}
        </output>
      )}
    </div>
  )
}
