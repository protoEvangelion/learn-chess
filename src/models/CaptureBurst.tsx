import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { FC } from 'react'
import * as THREE from 'three'

type Particle = {
  pos: THREE.Vector3
  vel: THREE.Vector3
  color: THREE.Color
}

const COUNT = 24

export const CaptureBurst: FC<{
  position: [number, number, number]
  active: boolean
  burstKey: string
}> = ({ position, active, burstKey }) => {
  const pointsRef = useRef<THREE.Points>(null)
  const lightRef = useRef<THREE.PointLight>(null)
  const start = useRef(0)
  const particles = useMemo(() => {
    const list: Particle[] = []
    for (let i = 0; i < COUNT; i++) {
      const dir = new THREE.Vector3(
        Math.random() * 2 - 1,
        Math.random() * 1.2 + 0.2,
        Math.random() * 2 - 1,
      ).normalize()
      list.push({
        pos: new THREE.Vector3(0, 0.2, 0),
        vel: dir.multiplyScalar(2.5 + Math.random() * 3.5),
        color: new THREE.Color().setHSL(0.05 + Math.random() * 0.08, 0.9, 0.55),
      })
    }
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [burstKey])

  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const positions = new Float32Array(COUNT * 3)
    const colors = new Float32Array(COUNT * 3)
    for (let i = 0; i < COUNT; i++) {
      positions[i * 3] = 0
      positions[i * 3 + 1] = 0
      positions[i * 3 + 2] = 0
      colors[i * 3] = particles[i].color.r
      colors[i * 3 + 1] = particles[i].color.g
      colors[i * 3 + 2] = particles[i].color.b
    }
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    return g
  }, [particles])

  useFrame((_, delta) => {
    if (!active || !pointsRef.current) return
    if (!start.current) start.current = performance.now()
    const t = (performance.now() - start.current) / 1000
    const pos = geo.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < COUNT; i++) {
      const p = particles[i]
      p.vel.y -= 9 * delta
      p.pos.addScaledVector(p.vel, delta)
      pos.setXYZ(i, p.pos.x, p.pos.y, p.pos.z)
    }
    pos.needsUpdate = true
    const mat = pointsRef.current.material as THREE.PointsMaterial
    mat.opacity = Math.max(0, 1 - t * 2.2)
    if (lightRef.current) {
      lightRef.current.intensity = Math.max(0, 2.8 * (1 - t * 3))
    }
  })

  if (!active) return null

  return (
    <group position={position}>
      <points ref={pointsRef} geometry={geo}>
        <pointsMaterial
          size={0.18}
          vertexColors
          transparent
          depthWrite={false}
          sizeAttenuation
        />
      </points>
      <pointLight
        ref={lightRef}
        color="#ff6a2a"
        intensity={2.5}
        distance={4}
        decay={2}
      />
    </group>
  )
}
