/** Emerald's sprites exist for the first 386; Gen 3 setups use them to match the game. */
const GEN3_LAST = 386

/** Self-hosted sprite (see scripts/fetch-sprites.mjs); nothing for a custom Pokemon or a missing file. */
export function Sprite({ id, gen = 9, size = 40 }: { id: number | undefined; gen?: number; size?: number }) {
  if (id === undefined) return null
  const src = gen <= 3 && id <= GEN3_LAST ? `/sprites/g3/${id}.png` : `/sprites/${id}.png`
  return (
    <img
      // Sprites are drawn at 96px: keep pixels crisp at full size, smooth when shrunk.
      class={size >= 96 ? 'sprite crisp' : 'sprite'}
      src={src}
      width={size}
      height={size}
      alt=""
      loading="lazy"
      onError={(e) => {
        e.currentTarget.style.visibility = 'hidden'
      }}
    />
  )
}
