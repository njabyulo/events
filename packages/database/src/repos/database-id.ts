const MAX_DATABASE_ID = 9_223_372_036_854_775_807n;

export function databaseId(value: string | number | bigint): bigint | null {
  if (typeof value === "bigint") {
    return value > 0n && value <= MAX_DATABASE_ID ? value : null;
  }

  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? BigInt(value) : null;
  }

  if (!/^[1-9]\d{0,18}$/.test(value)) return null;

  try {
    const parsed = BigInt(value);
    return parsed <= MAX_DATABASE_ID ? parsed : null;
  } catch {
    return null;
  }
}

export function requiredDatabaseId(value: string | number | bigint, name = "id"): bigint {
  const id = databaseId(value);
  if (id === null) throw new Error(`${name} must be a positive integer`);
  return id;
}
