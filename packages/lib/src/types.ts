/**
 * Recursively builds "/" separated path strings from an object type.
 * Handles nested objects and arrays with numeric indices.
 */
type PathImpl<T, Key extends keyof T> = Key extends string | number
  ? T[Key] extends Record<string, unknown>
    ? `${Key}` | `${Key}/${PathImpl<T[Key], Exclude<keyof T[Key], keyof unknown[]>>}`
    : T[Key] extends Array<infer U>
      ?
          | `${Key}`
          | `${Key}/${number}`
          | (U extends Record<string, unknown>
              ? `${Key}/${number}/${PathImpl<U, Exclude<keyof U, keyof unknown[]>>}`
              : never)
      : `${Key}`
  : never;

/**
 * All valid absolute paths for a data type T.
 * Paths start with "/" and use "/" as separator: "/customer/name"
 */
export type ModelPath<T> =
  | "/"
  | (T extends object ? `/${PathImpl<T, Exclude<keyof T, keyof unknown[]>>}` : never);

/**
 * Resolves the value type at a given path P within type T.
 */
export type PathValue<T, P extends string> = P extends "/"
  ? T
  : P extends `/${infer Rest}`
    ? PathValueImpl<T, Rest>
    : never;

type PathValueImpl<T, P extends string> = P extends `${infer Key}/${infer Rest}`
  ? Key extends keyof T
    ? PathValueImpl<T[Key], Rest>
    : Key extends `${number}`
      ? T extends Array<infer U>
        ? PathValueImpl<U, Rest>
        : never
      : never
  : P extends keyof T
    ? T[P]
    : P extends `${number}`
      ? T extends Array<infer U>
        ? U
        : never
      : never;

/**
 * Options for the SignalModel constructor.
 */
export interface SignalModelOptions {
  /** When true, setProperty on nonexistent paths throws TypeError. Default: false. */
  strict?: boolean;
}
