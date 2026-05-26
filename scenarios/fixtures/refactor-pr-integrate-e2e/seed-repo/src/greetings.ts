export function greet(name: string): string {
  const trimmed = name.trim();
  const normalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
  return `Hello, ${normalized}!`;
}

export function farewell(name: string): string {
  const trimmed = name.trim();
  const normalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
  return `Goodbye, ${normalized}!`;
}
