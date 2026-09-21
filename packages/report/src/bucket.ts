export interface Bucket<T> {
  readonly label: string;
  readonly items: readonly T[];
}

/**
 * Splits an ordered list into at most `maxBuckets` contiguous groups of equal size so a
 * per-chapter chart keeps its marks wide enough to hit, however long the book is.
 */
export function bucketItems<T>(
  items: readonly T[],
  maxBuckets: number,
  label: (group: readonly T[]) => string,
): Bucket<T>[] {
  if (items.length === 0 || maxBuckets < 1) return [];
  const size = Math.max(1, Math.ceil(items.length / maxBuckets));
  const buckets: Bucket<T>[] = [];
  for (let start = 0; start < items.length; start += size) {
    const group = items.slice(start, start + size);
    buckets.push({ label: label(group), items: group });
  }
  return buckets;
}
