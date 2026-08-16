export class EventsUtils {
  static isValidEventId(id: string): boolean {
    return /^\d+$/.test(id) && BigInt(id) > 0n;
  }
}
