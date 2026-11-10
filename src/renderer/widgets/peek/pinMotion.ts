import { springEasing } from '../tabBarMotion'

/** A map pin drops onto its spot once the card has nearly landed, and settles with a bounce. */
export const PIN_DROP: Keyframe[] = [
  { transform: 'translate(-50%, -120%) translateY(-1.25rem) scale(0.6)', opacity: 0 },
  { transform: 'translate(-50%, -120%) translateY(0) scale(1)', opacity: 1 }
]
export const PIN_DROP_TIMING: KeyframeAnimationOptions = {
  duration: 650,
  delay: 220,
  easing: springEasing({ response: 0.4, damping: 0.55 }, 0.65),
  fill: 'backwards'
}
/** A soft ring spreading from the pin, again and again, so the spot is easy to find. */
export const PULSE: Keyframe[] = [
  { transform: 'translate(-50%, -50%) scale(0.4)', opacity: 0.55 },
  { transform: 'translate(-50%, -50%) scale(2.6)', opacity: 0 }
]
export const PULSE_TIMING: KeyframeAnimationOptions = {
  duration: 1800,
  delay: 700,
  iterations: Infinity,
  easing: 'ease-out'
}
