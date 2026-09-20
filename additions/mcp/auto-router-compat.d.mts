export type CompatibilityAutoRouteOptions = Readonly<{
  nets?: readonly string[];
  ignoreNets?: readonly string[];
}>;

export declare function buildCompatibilityAutoRouteDsl(
  options?: CompatibilityAutoRouteOptions,
): string;

export declare function registerCompatibilityAutoRouter(options: Readonly<{
  server: unknown;
  bridge: unknown;
  runPcbRouterDsl: (...args: any[]) => Promise<unknown>;
  textResult: (value: unknown) => unknown;
  z: any;
}>): void;
