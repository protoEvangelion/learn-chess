import { useId, type FC, type SVGProps } from 'react'

type Props = SVGProps<SVGSVGElement> & {
  title?: string
}

/** HUD brand mark — faceted knight inside the teal→magenta frame. */
export const BrandMark: FC<Props> = ({ title = '3D Chess', className, ...rest }) => {
  const uid = useId().replace(/:/g, '')
  const clip = `bm-clip-${uid}`
  const edge = `bm-edge-${uid}`

  return (
    <svg
      className={['hud-brand-mark', className].filter(Boolean).join(' ')}
      viewBox="0 0 40 40"
      width={40}
      height={40}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
      {...rest}
    >
      <title>{title}</title>
      <defs>
        <linearGradient id={edge} x1="4" y1="2" x2="36" y2="38" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2dd4bf" />
          <stop offset="1" stopColor="#c026d3" />
        </linearGradient>
        <clipPath id={clip}>
          <rect x="5.4" y="5.4" width="29.2" height="29.2" rx="5.2" />
        </clipPath>
      </defs>
      <rect x="2.2" y="2.2" width="35.6" height="35.6" rx="7.6" fill="#ffffff" />
      <image
        href="/brand-knight.png"
        x="5.4"
        y="5.4"
        width="29.2"
        height="29.2"
        clipPath={`url(#${clip})`}
        preserveAspectRatio="xMidYMid slice"
      />
      <rect
        x="1.5"
        y="1.5"
        width="37"
        height="37"
        rx="9"
        stroke={`url(#${edge})`}
        strokeWidth="1.6"
      />
    </svg>
  )
}
