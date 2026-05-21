export default function AXDotLoader({ size = 4, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <span style={{ display: 'inline-flex', gap: '0.2rem', alignItems: 'center' }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: size,
            height: size,
            borderRadius: '50%',
            background: color,
            display: 'inline-block',
            animation: 'ax-dot-pulse 1.2s ease-in-out infinite',
            animationDelay: `${i * 0.2}s`,
          }}
        />
      ))}
    </span>
  )
}
