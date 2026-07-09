export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends (infer U)[]
    ? DeepPartial<NonNullable<U>>[]
    : T[K] extends object
    ? DeepPartial<T[K]>
    : T[K];
};
