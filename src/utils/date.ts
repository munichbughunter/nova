/**
 * Format a date into a human-readable time ago string
 * @param date The date to format
 * @returns A string like "2d ago" or "3h ago"
 */
export function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  
  // Convert to days/hours/minutes
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor(diff / (1000 * 60));
  
  if (days > 0) {
    return `${days}d ago`;
  } else if (hours > 0) {
    return `${hours}h ago`;
  } else if (minutes > 0) {
    return `${minutes}m ago`;
  } else {
    return 'just now';
  }
}

/**
 * Format a date to a short date string
 * @param date The date to format
 * @returns A string like "2023-12-25"
 */
export function formatShortDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Format a date to include both date and time
 * @param date The date to format
 * @returns A string like "2023-12-25 14:30"
 */
export function formatDateTime(date: Date): string {
  return date.toISOString().replace('T', ' ').split('.')[0];
} 