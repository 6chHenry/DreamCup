/**
 * 人物无照片时的占位：仅灰白层次，与全站单色梦境 UI 一致。
 */
const MONO_GRADIENTS = [
  "from-white/[0.16] to-white/[0.05]",
  "from-white/[0.14] to-white/[0.045]",
  "from-white/[0.12] to-white/[0.04]",
  "from-white/[0.1] to-white/[0.035]",
  "from-white/[0.15] to-white/[0.06]",
  "from-white/[0.11] to-white/[0.045]",
  "from-white/[0.13] to-white/[0.05]",
  "from-white/[0.09] to-white/[0.03]",
];

export function getMonochromeAvatarGradient(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return MONO_GRADIENTS[Math.abs(hash) % MONO_GRADIENTS.length];
}
