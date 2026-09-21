/**
 * ANSI colouring for terminal output. Enabled only when stdout is a TTY, NO_COLOR is unset and
 * TERM is not "dumb", so piped output stays plain. Exported helpers take an explicit flag so
 * formatting functions remain pure and testable.
 */

const RESET = '[0m';
const DIM = '[2m';
const BOLD = '[1m';

/** 256-colour foreground codes, spread around the hue circle so neighbours stay distinct. */
const SPEAKER_COLOURS = [39, 208, 41, 205, 214, 75, 166, 114, 170, 179, 45, 203] as const;
const UNKNOWN_COLOUR = 244;
const THOUGHT_COLOUR = 140;

export function colourEnabled(): boolean {
  const env = process.env;
  if (env['NO_COLOR'] !== undefined && env['NO_COLOR'] !== '') return false;
  if (env['FORCE_COLOR'] !== undefined && env['FORCE_COLOR'] !== '0') return true;
  return process.stdout.isTTY === true && env['TERM'] !== 'dumb';
}

function fg(code: number): string {
  return `[38;5;${code}m`;
}

/** Wraps `text` in the colour for `speaker`; the same name always gets the same colour within a run. */
export function colourSpeaker(text: string, speaker: string, palette: SpeakerPalette): string {
  return `${fg(palette.colourOf(speaker))}${BOLD}${text}${RESET}`;
}

export function colourUnknown(text: string): string {
  return `${fg(UNKNOWN_COLOUR)}${text}${RESET}`;
}

export function colourThought(text: string): string {
  return `${fg(THOUGHT_COLOUR)}${text}${RESET}`;
}

export function dim(text: string): string {
  return `${DIM}${text}${RESET}`;
}

export interface SpeakerPalette {
  colourOf(speaker: string): number;
}

/** Assigns colours in order of first appearance, wrapping around when the palette runs out. */
export function createSpeakerPalette(): SpeakerPalette {
  const assigned = new Map<string, number>();
  return {
    colourOf(speaker) {
      const existing = assigned.get(speaker);
      if (existing !== undefined) return existing;
      const colour = SPEAKER_COLOURS[assigned.size % SPEAKER_COLOURS.length]!;
      assigned.set(speaker, colour);
      return colour;
    },
  };
}
