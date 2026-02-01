import { getAvatarMeta } from '../../utils/helpers'

function AvatarEmoji({ seed, className = '', emojiClassName = '' }) {
  const meta = getAvatarMeta(seed)
  return (
    <div
      className={`flex items-center justify-center ${className}`}
      style={{ backgroundColor: meta.bg }}
      aria-hidden="true"
    >
      <span className={emojiClassName}>{meta.emoji}</span>
    </div>
  )
}

export default AvatarEmoji
