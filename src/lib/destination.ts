import type { Box, Location } from './types';

export function rememberDestination(userId: string, destination: string) {
  try { localStorage.setItem(`inventory-destination:${userId}`, destination); } catch { /* Storage may be disabled. */ }
}

export function lastDestination(userId: string, locations: Location[], boxes: Box[]) {
  try {
    const value = localStorage.getItem(`inventory-destination:${userId}`) || '';
    const id = value.slice(2);
    return (value.startsWith('b:') && boxes.some(box => box.id === id)) ||
      (value.startsWith('l:') && locations.some(location => location.id === id)) ? value : '';
  } catch { return ''; }
}
