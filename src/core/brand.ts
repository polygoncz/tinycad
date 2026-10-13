// Nominal typing on top of TypeScript's structural types: two ids that are both
// strings at runtime cannot be mixed up at compile time. The brand exists only
// in the type system; there is no runtime cost.
declare const brand: unique symbol;

export type Brand<T, B extends string> = T & { readonly [brand]: B };
