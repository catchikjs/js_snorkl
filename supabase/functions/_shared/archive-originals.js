import { validateFiles } from "./contract.js";

// Copy all original bytes, verify the destination, then switch the DB pointer.
// Retrying a partial copy is safe. Existing destination files are never overwritten.
export async function archiveOriginals(candidate, storage, commit) {
  const source = new Map();
  await validateFiles(candidate.manifest, async (name) => {
    const { data, error } = await storage.download(candidate.id + "/" + name);
    if (error) throw error;
    source.set(name, data);
    return data.arrayBuffer();
  });
  for (const [name, blob] of source) {
    const path = candidate.target_prefix + "/" + name;
    const { error } = await storage.upload(path, blob, { upsert: false });
    if (error) {
      // A previous run or a timed-out successful upload may already have copied it.
      const existing = await storage.download(path);
      if (existing.error) throw error;
    }
  }
  await validateFiles(candidate.manifest, async (name) => {
    const { data, error } = await storage.download(
      candidate.target_prefix + "/" + name,
    );
    if (error) throw error;
    return data.arrayBuffer();
  });
  await commit({ id: candidate.id, target_prefix: candidate.target_prefix });
}
