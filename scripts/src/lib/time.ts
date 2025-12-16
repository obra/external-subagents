export function formatRelativeTime(timestamp: string | undefined, nowMs: number): string {
  if (!timestamp) {
    return 'unknown';
  }
  const value = Date.parse(timestamp);
  if (Number.isNaN(value)) {
    return 'unknown';
  }
  const diff = Math.max(0, nowMs - value);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rem = minutes % 60;
    return rem === 0 ? `${hours}h ago` : `${hours}h ${rem}m ago`;
  }
  const days = Math.floor(hours / 24);
  return days === 1 ? '1d ago' : `${days}d ago`;
}
