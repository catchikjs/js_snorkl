export function analysisInput(payload) {
  const { question, ...rest } = payload;
  return {
    ...rest,
    question: { ...question, images: undefined },
    // Folder names contain account identifiers; they are not analysis input.
    storage_prefix: undefined,
    manifest: undefined,
    description: rest.manifest?.description,
  };
}
