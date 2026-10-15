
export function getUtcMonth(date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");

  return `${year}-${month}`;
}

export function parseMonth(
  value: unknown
): string | null {
  if (value === undefined) {
    return getUtcMonth();
  }

  if (
    typeof value !== "string" ||
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)
  ) {
    return null;
  }

  return value;
}

export function monthStart(month: string): string {
  return `${month}-01`;
}

export function monthBounds(month: string): {
  start: string;
  end: string;
} {
  const [year, monthNumber] = month.split("-").map(Number);

  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;

  return {
    start: `${month}-01`,
    end: `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`,
  };
}

export function remaining(
  allowance: string,
  consumed: string
): string {
  const difference = BigInt(allowance) - BigInt(consumed);

  return difference > 0n ? difference.toString() : "0";
}
