/**
 * Tells TypeScript that a value is there, for a place that the code has already made sure of (a page past its early
 * exits has its record: a read that did not answer with it is a placeholder, an error or "not found" before this point).
 * It checks nothing at run time, so there is no branch for a state that cannot happen.
 */
export function assertPresent<T>(_value: T): asserts _value is NonNullable<T> {
  // Intentionally empty: the assertion exists only for the type checker.
}
