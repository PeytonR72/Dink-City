/** Explicit input-instruction substitutions, applied only at the presentation boundary. */
let mobile = false;
let manual = false;
export function setTouchPresentation(eligible: boolean, effectiveManual: boolean) { mobile = eligible; manual = eligible && effectiveManual; }
export function manualLabel() { return mobile ? 'Touch' : 'Keyboard'; }
export function touchText(text: string): string {
  if (!manual) return text;
  const phrases: [string, string][] = [
    ['J / K / L to skip', 'Tap a shot to skip'],
    ['Press J, K or L to play again, or Esc for the menu.', 'Tap a shot to play again, or Menu for the map.'],
    ['You serve (J or K).', 'You serve (Dink or Hit).'],
    ['Soft (J)', 'Dink'],
    ['Esc to leave.', 'Menu to leave.'],
  ];
  return phrases.reduce((s, [from, to]) => s.replaceAll(from, to), text);
}
