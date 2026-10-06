export function getFlexibleAdvantageDescription(entry) {
  return String((typeof entry === "string" ? entry : entry?.description) ?? "");
}
