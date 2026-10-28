// Limit whole-file operations, including uploads, response bodies and hashing.
// Stop scheduling on failure, then drain active work before the caller can exit
// or advance to sealing/admission. Do not leave background publication running.
export async function forEachReleaseFile(items, operation) {
  let next = 0, failure;
  const workers = Array.from({ length: Math.min(4, items.length) }, async () => {
    while (!failure && next < items.length) {
      const item = items[next++];
      try { await operation(item); }
      catch (error) { failure ??= { error }; }
    }
  });
  await Promise.all(workers);
  if (failure) throw failure.error;
}
