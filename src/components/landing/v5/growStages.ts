/** Frames of the growth clip (public/landing/lottie/grow.json, 111 frames at 30 fps), measured with lottie_light.
 * The clip starts in an empty pot, flowers by frame ~85, and empties the pot again from GROW_RESET_FRAME. */
export const GROW_START_FRAME = 6 // the sprout just breaks the soil
export const GROW_STAGES = [
  { label: 'Minggu 1', frame: 25 },
  { label: 'Minggu 3', frame: 42 },
  { label: 'Minggu 5', frame: 56 },
  { label: 'Berbunga', frame: 92 },
] as const
export const GROW_RESET_FRAME = 100
