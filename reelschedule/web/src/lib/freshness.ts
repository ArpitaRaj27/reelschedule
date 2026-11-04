/**
 * The latest change id this tab has seen over the live connection.
 *
 * Public reads add it as ?v=<id>. Each change therefore gets a new cache key: after an
 * update every viewer asks for the same new URL, the CDN fetches it from the API once, and
 * nobody is served a copy from before the change. The API ignores the parameter.
 */
let version = 0;

export function dataVersion(): number {
  return version;
}

/** Returns true when the version moved forward. */
export function setDataVersion(id: number): boolean {
  if (!Number.isFinite(id) || id <= version) return false;
  version = id;
  return true;
}

export function resetDataVersion(): void {
  version = 0;
}
