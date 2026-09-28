import type { Box } from './types';

// Keep the existing description column and archive format compatible.
// The label is independent of the automatically allocated internal number.
export function boxLabel(box: Pick<Box, 'description' | 'box_number'>) {
  return box.description?.trim() || `Box ${box.box_number}`;
}
