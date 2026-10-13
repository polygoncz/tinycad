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
  core: {},
  document: { deps: ['core'] },
  ops: { deps: ['core', 'document'] },
  persistence: { deps: ['core', 'document', 'ops'] },
  'persistence/idb': { deps: ['core', 'document', 'ops', 'persistence'] },
  kernel: { deps: ['core'] },
  'kernel-occt': { deps: ['core', 'kernel'] },
  regen: { deps: ['core', 'document', 'kernel'] },
  render: { deps: ['core'], types: ['kernel', 'interaction'], npm: ['three'] },
  interaction: { deps: ['core', 'document', 'ops'] },
  'plugin-api': { deps: ['core', 'document', 'regen', 'interaction'] },
  'features/*': {
    deps: ['core', 'document', 'ops', 'kernel', 'regen', 'interaction', 'plugin-api'],
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
      'regen',
      'render',
      'interaction',
      'plugin-api',
      'features/*',
    ],
  },
  ui: { deps: ['app', 'core'], types: ['document', 'interaction'], npm: ['vue'] },
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
      from: { path: from },
      to: { path: '^src/', pathNot: [own, ...[...deps, ...types].map(entryPoint)] },
    },
    {
      name: `${name}-allowed-npm`,
      severity: 'error',
      comment: `${name} may use npm packages: ${npm.join(', ') || 'none'} (${SPEC})`,
      from: { path: from, pathNot: '\\.test\\.ts$' },
      to: {
        dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-no-pkg', 'core'],
        ...(npm.length > 0 ? { pathNot: npmPath(npm) } : {}),
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
      to: { path: '^src/[^/]+/.+', pathNot: ['^src/$1/', '/index\\.ts$'] },
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
      to: { couldNotResolve: true },
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
