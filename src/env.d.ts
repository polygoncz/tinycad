// Fallback type for .vue imports in tools without Vue language support
// (typescript-eslint). vue-tsc resolves the real component types instead.
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent;
  export default component;
}

// M39 (N3): the base URL of the native core (gRPC-Web through Envoy); unset = '/api' (N68).
interface ImportMetaEnv {
  readonly VITE_CORE_URL?: string;
}
