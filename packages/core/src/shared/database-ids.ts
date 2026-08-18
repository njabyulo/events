export class DatabaseIds {
  static readonly MAX_VALUE = 9_223_372_036_854_775_807n;

  static normalize(value: unknown, allowZero = false): string | null {
    if (typeof value === "number") {
      if (!Number.isSafeInteger(value)) return null;
      value = String(value);
    }
    if (typeof value !== "string" || !/^\d{1,19}$/.test(value)) return null;

    const parsed = BigInt(value);
    const minimum = allowZero ? 0n : 1n;
    return parsed >= minimum && parsed <= DatabaseIds.MAX_VALUE ? String(parsed) : null;
  }

  static isValid(value: unknown, allowZero = false): boolean {
    return DatabaseIds.normalize(value, allowZero) !== null;
  }
}
