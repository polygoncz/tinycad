// Fallback type for .vue imports in tools without Vue language support
// (typescript-eslint). vue-tsc resolves the real component types instead.
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent;
  export default component;
}
