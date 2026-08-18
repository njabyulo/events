export class Env {
  static integer(
    name: string,
    fallback: number,
    options: { minimum?: number; maximum?: number } = {},
  ): number {
    const raw = process.env[name]?.trim();
    if (!raw) return fallback;
    const value = Number(raw);
    const minimum = options.minimum ?? 1;
    const maximum = options.maximum ?? Number.MAX_SAFE_INTEGER;
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
      throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
    }
    return value;
  }

  static number(
    name: string,
    fallback: number,
    options: { minimum: number; maximum: number },
  ): number {
    const raw = process.env[name]?.trim();
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < options.minimum || value > options.maximum) {
      throw new Error(`${name} must be from ${options.minimum} to ${options.maximum}`);
    }
    return value;
  }

  static boolean(name: string, fallback: boolean): boolean {
    const raw = process.env[name]?.trim().toLowerCase();
    if (!raw) return fallback;
    if (raw === "true") return true;
    if (raw === "false") return false;
    throw new Error(`${name} must be true or false`);
  }

  static channel(name: string, fallback: string): string {
    const value = process.env[name]?.trim() || fallback;
    if (!/^[a-z_][a-z0-9_$]*$/i.test(value)) {
      throw new Error(`${name} must be a valid PostgreSQL identifier`);
    }
    return value;
  }

  static timeZone(name: string, fallback: string): string {
    const value = process.env[name]?.trim() || fallback;
    try {
      new Intl.DateTimeFormat("en", { timeZone: value }).format();
      return value;
    } catch {
      throw new Error(`${name} must be a valid IANA time zone`);
    }
  }

  static clock(name: string, fallback: string): string {
    const value = process.env[name]?.trim() || fallback;
    const match = /^(\d{2}):(\d{2})$/.exec(value);
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
      throw new Error(`${name} must use HH:mm in 24-hour time`);
    }
    return value;
  }
}
