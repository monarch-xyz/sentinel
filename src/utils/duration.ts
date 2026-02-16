/**
 * Centralized duration parsing utility.
 * Single source of truth for all duration string handling in Sentinel.
 */

const DURATION_REGEX = /^(\d+)(s|m|h|d|w)$/;

const MULTIPLIERS: Record<string, number> = {
  s: 1000, // seconds
  m: 60 * 1000, // minutes
  h: 60 * 60 * 1000, // hours
  d: 24 * 60 * 60 * 1000, // days
  w: 7 * 24 * 60 * 60 * 1000, // weeks
};

/**
 * Parses a duration string (e.g., "30s", "15m", "2h", "7d", "1w") into milliseconds.
 *
 * @param duration - Duration string in format "{number}{unit}"
 * @returns Duration in milliseconds
 * @throws Error if format is invalid
 *
 * @example
 * parseDuration("30s") // 30000
 * parseDuration("1h")  // 3600000
 * parseDuration("7d")  // 604800000
 */
export function parseDuration(duration: string): number {
  const match = duration.match(DURATION_REGEX);
  if (!match) {
    throw new Error(
      `Invalid duration format: "${duration}". Expected format: {number}{unit} where unit is s|m|h|d|w`,
    );
  }

  const value = Number.parseInt(match[1], 10);
  const unit = match[2];

  return value * MULTIPLIERS[unit];
}

/**
 * Validates that a string is a valid duration format.
 *
 * @param duration - String to validate
 * @returns true if valid duration format
 */
export function isValidDuration(duration: string): boolean {
  return DURATION_REGEX.test(duration);
}

/**
 * Formats milliseconds back to a human-readable duration string.
 * Uses the largest unit that divides evenly.
 *
 * @param ms - Duration in milliseconds
 * @returns Formatted duration string
 */
export function formatDuration(ms: number): string {
  if (ms >= MULTIPLIERS.w && ms % MULTIPLIERS.w === 0) {
    return `${ms / MULTIPLIERS.w}w`;
  }
  if (ms >= MULTIPLIERS.d && ms % MULTIPLIERS.d === 0) {
    return `${ms / MULTIPLIERS.d}d`;
  }
  if (ms >= MULTIPLIERS.h && ms % MULTIPLIERS.h === 0) {
    return `${ms / MULTIPLIERS.h}h`;
  }
  if (ms >= MULTIPLIERS.m && ms % MULTIPLIERS.m === 0) {
    return `${ms / MULTIPLIERS.m}m`;
  }
  return `${ms / MULTIPLIERS.s}s`;
}
