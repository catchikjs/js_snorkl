// Legacy submissions retain their UUID directory until a verified server backfill.
export function originalPath(slot, filename) {
  return (slot.storage_prefix || slot.id) + "/" + filename;
}
