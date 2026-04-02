/**
 * Extracts property names of a type, excluding Function and symbol properties.
 * Aligns with UI5 TypedJSONModel conventions.
 */
type PropertiesOf<T> = {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  [Key in keyof T]: T[Key] extends Function ? never : T[Key] extends symbol ? never : Key;
}[keyof T];

/**
 * All valid absolute binding paths for a data type T.
 * Paths start with "/" and use "/" as separator: "/customer/name".
 *
 * Follows the same conventions as UI5's TypedJSONModel AbsoluteBindingPath.
 *
 * @example
 * type Person = { name: string; orders: Array<{ id: number }> };
 * type Paths = ModelPath<Person>;
 * // "/name" | "/orders" | "/orders/${number}" | "/orders/${number}/id"
 */
export type ModelPath<T> =
  T extends Array<unknown>
    ? `/${number}` | `/${number}${ModelPath<T[number]>}`
    : T extends object
      ? {
          [Key in string & PropertiesOf<T>]: T[Key] extends Array<unknown>
            ? `/${Key}` | `/${Key}/${number}` | `/${Key}/${number}${ModelPath<T[Key][number]>}`
            : `/${Key}` | `/${Key}${ModelPath<T[Key]>}`;
        }[string & PropertiesOf<T>]
      : never;

/**
 * Resolves the value type at an absolute path P within type T.
 *
 * @example
 * type Person = { name: string; age: number };
 * type Name = PathValue<Person, "/name">; // string
 */
export type PathValue<T, P extends string> = P extends `/${number}`
  ? T extends Array<infer U>
    ? U
    : never
  : P extends `/${number}${infer Rest}`
    ? T extends Array<infer U>
      ? PathValue<U, Rest>
      : never
    : P extends `/${infer Key}/${number}/${infer Rest}`
      ? Key extends keyof T
        ? T[Key] extends Array<infer U>
          ? PathValue<U, `/${Rest}`>
          : never
        : never
      : P extends `/${infer Key}/${number}`
        ? Key extends keyof T
          ? T[Key] extends Array<infer U>
            ? U
            : never
          : never
        : P extends `/${infer Key}/${infer Rest}`
          ? Key extends keyof T
            ? PathValue<T[Key], `/${Rest}`>
            : never
          : P extends `/${infer Key}`
            ? Key extends keyof T
              ? T[Key]
              : never
            : never;

/**
 * Options for the SignalModel constructor.
 */
export interface SignalModelOptions {
  /** When true, setProperty on nonexistent paths throws TypeError. Default: false. */
  strict?: boolean;
}
