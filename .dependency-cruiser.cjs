// @ts-check
// Module boundaries (ADR 0008, ADR 0009). The table below mirrors
// "Povolené závislosti" in docs/20-spec/01-architektura.md – keep them in sync.
//
// Whitelist semantics: a module may import only itself, the index.ts of the
// modules listed in `deps` (`types` = type-only imports), the data entry point
// constants.ts of the modules listed in `constants` (values too, M20 D6) and the
// npm packages listed in `npm`. Everything else is a violation.
//
// Tests live outside src/ (ADR 0023): test/unit/<module>/ mirrors src/<module>/ and belongs
// to that module, so the test rules map test/unit/<module>/ back to the module.

/**
 * @typedef {{ deps?: string[]; types?: string[]; constants?: string[]; npm?: string[] }} ModuleSpec
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
  // M37: letter outlines over opentype.js and the bundled fonts (ADR 0029); only app imports it.
  'text-opentype': { deps: ['core', 'sketch'], npm: ['opentype.js'] },
  // M39 (Q106): code generated from server/proto by npm run gen:proto; only remote imports it.
  protocol: { npm: ['@bufbuild/protobuf'] },
  // M39 (Q106): adapters of the ports over the gRPC protocol of the native core; only app imports
  // it. kernel for createKernelError: a failed call rejects like a kernel call (spec 14).
  remote: {
    deps: ['core', 'kernel', 'sketch', 'protocol'],
    npm: ['@bufbuild/protobuf', '@connectrpc/connect', '@connectrpc/connect-web'],
  },
  regen: { deps: ['core', 'document', 'kernel', 'sketch'] },
  render: { deps: ['core'], types: ['kernel', 'interaction'], npm: ['three'] },
  interaction: { deps: ['core', 'document', 'ops', 'sketch'] },
  // M20: the sketcher over interaction (ADR 0024); interaction never imports it. ops only for
  // the tests (anOpsSession of ops/testing.ts); the rule sketcher-ops-only-in-tests keeps its
  // production code off ops/index.ts.
  sketcher: { deps: ['core', 'document', 'ops', 'sketch', 'interaction'] },
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
      'text-opentype',
      'remote',
      'regen',
      'render',
      'interaction',
      'sketcher',
      'plugin-api',
      'features/*',
    ],
  },
  // vue-i18n: ADR 0014; Tabler Icons: the only UI dependency (spec 11 "Styl").
  // M20 (D6): values of interaction and sketcher only from their data entry points constants.ts.
  ui: {
    deps: ['app', 'core'],
    types: ['document', 'interaction', 'sketcher'],
    constants: ['interaction', 'sketcher'],
    npm: ['vue', 'vue-i18n', '@tabler/icons-webfont'],
  },
};

/**
 * Modules with a data entry point constants.ts next to index.ts (M20, D6): values without any
 * import beyond core, so a module that may take only types from the module (ui) can still take
 * its constants. Each module lists its own data files constants.ts may import (without `.ts`):
 * files of plain data with no import of their own (interaction: mode.ts with the type Mode,
 * which toolModes returns; sketcher: none). The rule `<module>-constants-only-data` keeps
 * constants.ts and those files free of dependencies.
 * @type {Record<string, string[]>}
 */
const DATA_ENTRY_MODULES = { interaction: ['mode'], sketcher: [] };

const SPEC = 'see docs/20-spec/01-architektura.md';

/** Regex matching every file of a module (persistence excludes its idb adapter). */
function ownFiles(/** @type {string} */ name) {
  if (name === 'features/*') return '^src/features/[^/]+/';
  if (name === 'persistence') return '^src/persistence/(?!idb/)';
  return `^src/${name}/`;
}

/** Regex matching the unit tests of a module: everything under test/unit/<module>/ (ADR 0023). */
function testFiles(/** @type {string} */ name) {
  if (name === 'features/*') return '^test/unit/features/([^/]+)/';
  if (name === 'persistence') return '^test/unit/persistence/(?!idb/)';
  return `^test/unit/${name}/`;
}

/** Regex matching the public entry point of a module. */
function entryPoint(/** @type {string} */ name) {
  if (name === 'features/*') return '^src/features/[^/]+/index\\.ts$';
  return `^src/${name}/index\\.ts$`;
}

/** Regex matching the data entry point of a module: constants.ts (M20, D6). */
function dataEntryPoint(/** @type {string} */ name) {
  return `^src/${name}/constants\\.ts$`;
}

/**
 * Regexes matching the data files of a module that its constants.ts may import (M20, D6); none
 * for a module without data files.
 * @returns {string[]}
 */
function dataFiles(/** @type {string} */ name, /** @type {string[]} */ files) {
  return files.length === 0 ? [] : [`^src/${name}/(${files.join('|')})\\.ts$`];
}

/** Regex matching the test-only entry point of a module (builders, fakes): testing.ts. */
function testingEntryPoint(/** @type {string} */ name) {
  if (name === 'features/*') return '^src/features/[^/]+/testing\\.ts$';
  return `^src/${name}/testing\\.ts$`;
}

/**
 * Test code: the unit tests in test/unit/ and the testing.ts helpers in src/. It may also use the
 * testing.ts entry points of allowed modules (builders compose) and vitest (fakes with vi.fn).
 */
const TESTING_FILE = '/testing\\.ts$';

/**
 * Test code of a module: its unit tests and its testing.ts (only at the module root).
 * For features/* the lookahead captures the plugin name as $1 for both alternatives, so the
 * rules can say "the same plugin" with ^src/features/$1/.
 */
function testCodeOf(/** @type {string} */ name) {
  if (name === 'features/*') {
    return (
      '^(?=(?:src|test/unit)/features/([^/]+)/)' +
      '(?:src/features/[^/]+/testing\\.ts$|test/unit/features/[^/]+/)'
    );
  }
  const tests = testFiles(name).slice(1);
  return `^(?:src/${name}/testing\\.ts$|${tests})`;
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
  const constants = spec.constants ?? [];
  const npm = spec.npm ?? [];
  // features/* plugins must not import each other: "own" means the same plugin.
  const own = name === 'features/*' ? '^src/features/$1/' : ownFiles(name);
  const from = name === 'features/*' ? '^src/features/([^/]+)/' : ownFiles(name);
  const testCode = testCodeOf(name);
  // Production code of the module: its files in src/ except its testing.ts.
  const production = { path: from, pathNot: `${from}testing\\.ts$` };
  const allowed = [
    ...[...deps, ...types].map((d) => d.replace('features/*', 'features')),
    ...constants.map((c) => `${c}/constants.ts`),
  ];

  /** @type {import('dependency-cruiser').IForbiddenRuleType[]} */
  const rules = [
    {
      name: `${name}-allowed-deps`,
      severity: 'error',
      comment: `${name} may import only: ${allowed.join(', ') || 'nothing'} (${SPEC})`,
      from: production,
      to: {
        path: '^src/',
        pathNot: [own, ...[...deps, ...types].map(entryPoint), ...constants.map(dataEntryPoint)],
      },
    },
    {
      name: `${name}-allowed-deps-in-tests`,
      severity: 'error',
      comment: `tests of ${name} may import only: ${allowed.join(', ') || 'nothing'}, via index.ts or testing.ts (${SPEC})`,
      from: { path: testCode },
      to: {
        path: '^src/',
        // testing.ts holds values, so only `deps` open it, not type-only `types`.
        pathNot: [
          own,
          ...[...deps, ...types].map(entryPoint),
          ...constants.map(dataEntryPoint),
          ...deps.map(testingEntryPoint),
        ],
      },
    },
    {
      name: `${name}-allowed-npm`,
      severity: 'error',
      comment: `${name} may use npm packages: ${npm.join(', ') || 'none'} (${SPEC})`,
      from: production,
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
      from: production,
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
      from: { path: [from, testFiles(name)] },
      to: { path: entryPoint(t), dependencyTypesNot: ['type-only'] },
    });
  }
  return rules;
});

/** @type {import('dependency-cruiser').IForbiddenRuleType[]} */
const dataEntryRules = Object.entries(DATA_ENTRY_MODULES).map(([name, files]) => ({
  name: `${name}-constants-only-data`,
  severity: 'error',
  comment:
    `src/${name}/constants.ts holds data only: it imports nothing but core and its data files ` +
    `(${files.join(', ') || 'none'}), which import nothing but core too, so a module that may ` +
    `take only types from ${name} can take its constants (M20, D6; ${SPEC})`,
  from: { path: [dataEntryPoint(name), ...dataFiles(name, files)] },
  to: { pathNot: [entryPoint('core'), ...dataFiles(name, files)] },
}));

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-deep-import',
      severity: 'error',
      comment:
        'Import another module only through its index.ts (ADR 0008). ' +
        'Deep imports bypass the public API.',
      // The unit tests of a module (test/unit/<module>/) count as the module (ADR 0023).
      from: { path: '^(?:src|test/unit)/(features/[^/]+|persistence/idb|[^/]+)/' },
      to: {
        path: '^src/[^/]+/.+',
        pathNot: [
          '^src/$1/',
          '/index\\.ts$',
          '/testing\\.ts$',
          ...Object.keys(DATA_ENTRY_MODULES).map(dataEntryPoint),
        ],
      },
    },
    {
      name: 'no-deep-import-from-scenario-tests',
      severity: 'error',
      comment:
        'Integration and e2e tests belong to no module (spec 01): they import a module only ' +
        'through its index.ts or testing.ts (ADR 0008, ADR 0023).',
      from: { path: '^test/(?:integration|e2e)/' },
      to: {
        path: '^src/(features/[^/]+|persistence/idb|[^/]+)/.+',
        pathNot: [
          '/index\\.ts$',
          '/testing\\.ts$',
          ...Object.keys(DATA_ENTRY_MODULES).map(dataEntryPoint),
        ],
      },
    },
    {
      name: 'testing-only-in-tests',
      severity: 'error',
      comment:
        'testing.ts (builders, fakes) is for tests only, so it never reaches the production bundle ' +
        '(see docs/20-spec/01-architektura.md).',
      from: { path: '^src/', pathNot: TESTING_FILE },
      to: { path: '^src/.+/testing\\.ts$' },
    },
    {
      name: 'no-test-in-production',
      severity: 'error',
      comment: 'Production code in src/ never imports anything from test/ (ADR 0023).',
      from: { path: '^src/' },
      to: { path: '^test/' },
    },
    {
      name: 'gl-matrix-only-in-core-math',
      severity: 'error',
      comment:
        'gl-matrix is hidden behind the vec3/mat4 facade in src/core/math/ (ADR 0012). ' +
        'Use Vec3, Mat4, vec3 and mat4 from core instead.',
      from: { pathNot: ['^src/core/math/', '^test/unit/core/math/'] },
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
          '^src/render/(body-diff|bounds|camera-input|camera-math|camera-model|camera-ops|display-style|' +
          'edge-pick|frame-scheduler|highlight-targets|manipulator-pick|mesh-cache|mesh-index|' +
          'material-presets|overlay-shapes|pick-math|scene-sync|ao-parameters|sketch-drawing|sketch-grid|sketch-pick|view-cube-fade|' +
          'view-change|view-cube-geometry|view-cube-labels|view-cube-layout|view-events)\\.ts$',
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
      name: 'sketcher-ops-only-in-tests',
      severity: 'error',
      comment:
        'sketcher has ops in its deps only for ops/testing.ts in its tests; its production code ' +
        'changes the document through FeatureEditor of interaction, never through ops (ADR 0024, ' +
        `${SPEC}).`,
      from: { path: ownFiles('sketcher'), pathNot: testingEntryPoint('sketcher') },
      to: { path: entryPoint('ops') },
    },
    {
      name: 'main-allowed-deps',
      severity: 'error',
      comment: 'main.ts only wires app and ui together.',
      from: { path: '^src/main\\.ts$' },
      to: { path: '^src/', pathNot: [entryPoint('app'), entryPoint('ui')] },
    },
    ...moduleRules,
    ...dataEntryRules,
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
