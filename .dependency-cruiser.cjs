// @ts-check
// Module boundaries (ADR 0008, ADR 0009). The table below mirrors
// "Povolené závislosti" in docs/20-spec/01-architektura.md – keep them in sync.
//
// Whitelist semantics: a module may import only itself, the index.ts of the
// modules listed in `deps` (`types` = type-only imports) and the npm packages
// listed in `npm`. Everything else is a violation.

/**
 * @typedef {{ deps?: string[]; types?: string[]; npm?: string[] }} ModuleSpec
 * @type {Record<string, ModuleSpec>}
 */
const modules = {
  // gl-matrix only behind the vec3/mat4 facade in src/core/math/ (ADR 0012).
  core: { npm: ['gl-matrix'] },
  document: { deps: ['core'] },
  ops: { deps: ['core', 'document'] },
  persistence: { deps: ['core', 'document', 'ops'] },
  'persistence/idb': { deps: ['core', 'document', 'ops', 'persistence'] },
  kernel: { deps: ['core'] },
  'kernel-occt': { deps: ['core', 'kernel'], npm: ['replicad-opencascadejs'] },
  // M12: sketch data model, regions and the ConstraintSolver port (ADR 0017).
  sketch: { deps: ['core'] },
  // M12: solver adapter in a worker (ADR 0016); only app imports it.
  'solver-planegcs': { deps: ['core', 'sketch'], npm: ['@salusoft89/planegcs'] },
  regen: { deps: ['core', 'document', 'kernel', 'sketch'] },
  render: { deps: ['core'], types: ['kernel', 'interaction'], npm: ['three'] },
  interaction: { deps: ['core', 'document', 'ops', 'sketch'] },
  'plugin-api': { deps: ['core', 'document', 'regen', 'interaction'] },
  'features/*': {
    deps: ['core', 'document', 'ops', 'kernel', 'sketch', 'regen', 'interaction', 'plugin-api'],
  },
  app: {
    deps: [
      'core',
      'document',
      'ops',
      'persistence',
      'persistence/idb',
      'kernel',
      'kernel-occt',
      'sketch',
      'solver-planegcs',
      'regen',
      'render',
      'interaction',
      'plugin-api',
      'features/*',
    ],
  },
  // vue-i18n: ADR 0014; Tabler Icons: the only UI dependency (spec 11 "Styl").
  ui: {
    deps: ['app', 'core'],
    types: ['document', 'interaction'],
    npm: ['vue', 'vue-i18n', '@tabler/icons-webfont'],
  },
};

const SPEC = 'see docs/20-spec/01-architektura.md';

/** Regex matching every file of a module (persistence excludes its idb adapter). */
function ownFiles(/** @type {string} */ name) {
  if (name === 'features/*') return '^src/features/[^/]+/';
  if (name === 'persistence') return '^src/persistence/(?!idb/)';
  return `^src/${name}/`;
}

/** Regex matching the public entry point of a module. */
function entryPoint(/** @type {string} */ name) {
  if (name === 'features/*') return '^src/features/[^/]+/index\\.ts$';
  return `^src/${name}/index\\.ts$`;
}

/** Regex matching the test-only entry point of a module (builders, fakes): testing.ts. */
function testingEntryPoint(/** @type {string} */ name) {
  if (name === 'features/*') return '^src/features/[^/]+/testing\\.ts$';
  return `^src/${name}/testing\\.ts$`;
}

/**
 * Test code: *.test.ts and the testing.ts helpers themselves. It may also use the
 * testing.ts entry points of allowed modules (builders compose) and vitest (fakes with vi.fn).
 */
const TEST_FILES = '(\\.test\\.ts|/testing\\.ts)$';

/** Test code of a module whose files match `from` (testing.ts only at the module root). */
function testCodeOf(/** @type {string} */ from) {
  return `${from}(.*\\.test\\.ts|testing\\.ts)$`;
}

/**
 * Vite asset import with a query (`replicad-opencascadejs/wasm?url`, spec 06 "Vite").
 * enhanced-resolve takes the query as part of the package exports subpath and cannot resolve
 * it; Vite resolves it at build time (a wrong path fails `vite build`).
 */
const VITE_ASSET_QUERY = '\\?(url|raw|inline)$';

/** Regex for npm packages, including scoped helpers (vue → @vue/*). */
function npmPath(/** @type {string[]} */ names) {
  return `node_modules/(${names.map((n) => `${n}|@${n}`).join('|')})/`;
}

/** @type {import('dependency-cruiser').IForbiddenRuleType[]} */
const moduleRules = Object.entries(modules).flatMap(([name, spec]) => {
  const deps = spec.deps ?? [];
  const types = spec.types ?? [];
  const npm = spec.npm ?? [];
  // features/* plugins must not import each other: "own" means the same plugin.
  const own = name === 'features/*' ? '^src/features/$1/' : ownFiles(name);
  const from = name === 'features/*' ? '^src/features/([^/]+)/' : ownFiles(name);
  const allowed = [...deps, ...types].map((d) => d.replace('features/*', 'features'));

  /** @type {import('dependency-cruiser').IForbiddenRuleType[]} */
  const rules = [
    {
      name: `${name}-allowed-deps`,
      severity: 'error',
      comment: `${name} may import only: ${allowed.join(', ') || 'nothing'} (${SPEC})`,
      from: { path: from, pathNot: testCodeOf(from) },
      to: { path: '^src/', pathNot: [own, ...[...deps, ...types].map(entryPoint)] },
    },
    {
      name: `${name}-allowed-deps-in-tests`,
      severity: 'error',
      comment: `tests of ${name} may import only: ${allowed.join(', ') || 'nothing'}, via index.ts or testing.ts (${SPEC})`,
      from: { path: testCodeOf(from) },
      to: {
        path: '^src/',
        // testing.ts holds values, so only `deps` open it, not type-only `types`.
        pathNot: [own, ...[...deps, ...types].map(entryPoint), ...deps.map(testingEntryPoint)],
      },
    },
    {
      name: `${name}-allowed-npm`,
      severity: 'error',
      comment: `${name} may use npm packages: ${npm.join(', ') || 'none'} (${SPEC})`,
      from: { path: from, pathNot: testCodeOf(from) },
      to: {
        dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-no-pkg', 'core'],
        ...(npm.length > 0 ? { pathNot: npmPath(npm) } : {}),
      },
    },
    {
      // Vite asset imports (`pkg/file?url`) stay unresolved (see VITE_ASSET_QUERY), so the
      // rule above does not see them; the same npm whitelist applies to them here.
      name: `${name}-allowed-npm-assets`,
      severity: 'error',
      comment: `${name} may use npm packages: ${npm.join(', ') || 'none'} (${SPEC})`,
      from: { path: from, pathNot: testCodeOf(from) },
      to: {
        couldNotResolve: true,
        path: VITE_ASSET_QUERY,
        ...(npm.length > 0 ? { pathNot: `^(${npm.join('|')})/` } : {}),
      },
    },
  ];
  for (const t of types) {
    rules.push({
      name: `${name}-type-only-${t}`,
      severity: 'error',
      comment: `${name} may import only types from ${t} (use "import type") (${SPEC})`,
      from: { path: from },
      to: { path: entryPoint(t), dependencyTypesNot: ['type-only'] },
    });
  }
  return rules;
});

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-deep-import',
      severity: 'error',
      comment:
        'Import another module only through its index.ts (ADR 0008). ' +
        'Deep imports bypass the public API.',
      from: { path: '^src/(features/[^/]+|persistence/idb|[^/]+)/' },
      to: { path: '^src/[^/]+/.+', pathNot: ['^src/$1/', '/index\\.ts$', '/testing\\.ts$'] },
    },
    {
      name: 'testing-only-in-tests',
      severity: 'error',
      comment:
        'testing.ts (builders, fakes) is for tests only, so it never reaches the production bundle ' +
        '(see docs/20-spec/01-architektura.md).',
      from: { path: '^src/', pathNot: TEST_FILES },
      to: { path: '^src/.+/testing\\.ts$' },
    },
    {
      name: 'gl-matrix-only-in-core-math',
      severity: 'error',
      comment:
        'gl-matrix is hidden behind the vec3/mat4 facade in src/core/math/ (ADR 0012). ' +
        'Use Vec3, Mat4, vec3 and mat4 from core instead.',
      from: { pathNot: '^src/core/math/' },
      to: { path: 'node_modules/gl-matrix/' },
    },
    {
      name: 'render-pure-files-without-three',
      severity: 'error',
      comment:
        'The pure files of render (diffs, math, caches) are tested in Node without WebGL, so they ' +
        'must not import three (docs/20-spec/09-vykreslovani.md "Testy", Q061).',
      from: {
        path:
          '^src/render/(body-diff|bounds|camera-input|camera-math|camera-model|camera-ops|' +
          'edge-pick|frame-scheduler|highlight-targets|manipulator-pick|mesh-cache|mesh-index|' +
          'overlay-shapes|pick-math|scene-sync|sketch-drawing|sketch-pick|view-cube-fade|' +
          'view-cube-geometry|view-cube-labels|view-cube-layout|view-events)\\.ts$',
      },
      to: { path: 'node_modules/three/' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies are forbidden (ADR 0008).',
      from: {},
      to: { circular: true },
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      comment: 'Import cannot be resolved – missing package or wrong path.',
      from: {},
      to: { couldNotResolve: true, pathNot: VITE_ASSET_QUERY },
    },
    {
      name: 'main-allowed-deps',
      severity: 'error',
      comment: 'main.ts only wires app and ui together.',
      from: { path: '^src/main\\.ts$' },
      to: { path: '^src/', pathNot: [entryPoint('app'), entryPoint('ui')] },
    },
    ...moduleRules,
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      extensions: ['.ts', '.vue', '.js'],
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
    },
    reporterOptions: {
      dot: { collapsePattern: '^src/(features/[^/]+|persistence/idb|[^/]+)/' },
    },
  },
};
