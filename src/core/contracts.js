// @ts-check

/** @typedef {{hash:string, oid:string, size:number, mode:number}} Fingerprint */
/** @typedef {{path:string, kind:string, after:Fingerprint|null, before:Fingerprint|null}} Change */
/** @typedef {{version:3, id:string, root:string, mirror:string, source:string, target:string,
 * branch:string, direction:'ai-to-original'|'original-to-ai'|'serialize', originalHead:string,
 * originalIndex:string|null, mirrorHead:string, mirrorIndex:string|null, policyHash:string,
 * changes:Change[]}} Plan */

/** @param {unknown} value @returns {value is Fingerprint|null} */
function validFingerprint(value) {
  if (value === null) return true;
  if (typeof value !== 'object' || !value) return false;
  const f = /** @type {Record<string, unknown>} */ (value);
  return typeof f.hash === 'string' && /^[a-f0-9]{64}$/.test(f.hash) && typeof f.oid === 'string' && /^[a-f0-9]{40}$/.test(f.oid)
    && typeof f.mode === 'number' && Number.isInteger(f.mode) && f.mode >= 0 && f.mode <= 0o777
    && typeof f.size === 'number' && Number.isSafeInteger(f.size) && f.size >= 0;
}
/** Validate disk data before recovery performs any mutations.
 * @param {unknown} input @returns {asserts input is Plan}
 */
export function validatePlan(input) {
  if (typeof input !== 'object' || input === null) throw new Error('Invalid transaction plan.');
  const p = /** @type {Record<string, unknown>} */ (input);
  if (p.version !== 3 || typeof p.id !== 'string' || !/^[a-f0-9-]{36}$/.test(p.id)
    || !['ai-to-original', 'original-to-ai', 'serialize'].includes(String(p.direction))
    || ['root','mirror','source','target','branch'].some(k => typeof p[k] !== 'string' || !p[k])
    || ['originalHead','mirrorHead'].some(k => !/^[a-f0-9]{40}$/.test(String(p[k])))
    || !Array.isArray(p.changes)) throw new Error('Invalid transaction plan.');
  const seen = new Set();
  for (const file of p.changes) {
    if (!file || typeof file.path !== 'string' || seen.has(file.path) || !validFingerprint(file.after) || !validFingerprint(file.before)) throw new Error('Invalid transaction file entry.');
    seen.add(file.path);
  }
}
