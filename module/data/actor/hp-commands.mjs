export function parseHpValueCommand(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  const match = text.match(/^([+-])\s*(\d+)\s*([a-zA-Z]?)$/);
  if (!match) return null;
  const sign = match[1];
  const amount = Number.parseInt(match[2], 10);
  const suffix = (match[3] || "").toUpperCase();
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { sign, amount, suffix };
}
