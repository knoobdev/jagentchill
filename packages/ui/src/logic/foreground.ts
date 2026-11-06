export function isForeground(state: string | null): boolean {
  return state === "active";
}

export function shouldAnimate(active: boolean, reduceMotion: boolean, state: string | null): boolean {
  return active && !reduceMotion && isForeground(state);
}
