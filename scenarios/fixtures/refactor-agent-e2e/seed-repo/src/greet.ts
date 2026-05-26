export function formatGreet(name: string): string {
  const trimmed = name.trim();
  const titled = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return `Hello, ${titled}!`;
}

export function formatFarewell(name: string): string {
  const trimmed = name.trim();
  const titled = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return `Goodbye, ${titled}!`;
}
