import vm from 'node:vm';

/**
 * Execute the source of an n8n Code node outside n8n.
 *
 * This exists so Scout's classification, mapping and validation logic can be
 * tested without an n8n instance, a network, or credentials. It mocks only the
 * handful of n8n globals Scout actually uses. It is a test harness, not an n8n
 * emulator: anything Scout does not use is deliberately absent so a workflow
 * that quietly starts depending on more than this fails loudly in tests.
 *
 * The sandbox has no `process`, `require`, `import`, filesystem or network.
 */

const CODE_NODE_TYPE = 'n8n-nodes-base.code';

function normalizeItems(items) {
  return (items ?? []).map((item) =>
    item && typeof item === 'object' && 'json' in item ? item : { json: item }
  );
}

/**
 * A Date whose "now" is pinned, so time-dependent Code nodes are
 * deterministic. Workflow code uses ordinary `Date` and `+$now`, both of which
 * behave identically in real n8n.
 */
function createFrozenDate(nowMs) {
  return new Proxy(Date, {
    construct(target, args) {
      return args.length === 0 ? new target(nowMs) : new target(...args);
    },
    get(target, prop, receiver) {
      if (prop === 'now') return () => nowMs;
      return Reflect.get(target, prop, receiver);
    }
  });
}

export async function executeCodeNode({
  workflow,
  nodeName,
  inputItems = [],
  nodeOutputs = {},
  now = new Date()
}) {
  const node = workflow?.nodes?.find((n) => n.name === nodeName);
  if (!node) {
    throw new Error(`Workflow has no node named "${nodeName}".`);
  }
  if (node.type !== CODE_NODE_TYPE) {
    throw new Error(`Node "${nodeName}" is a ${node.type}, not a Code node.`);
  }

  const source = node.parameters?.jsCode;
  if (typeof source !== 'string' || source.trim() === '') {
    throw new Error(`Code node "${nodeName}" has no jsCode.`);
  }

  const items = normalizeItems(inputItems);
  const outputs = Object.fromEntries(
    Object.entries(nodeOutputs).map(([name, value]) => [name, normalizeItems(value)])
  );
  const nowMs = now instanceof Date ? now.getTime() : Number(now);

  const nodeAccessor = (name) => {
    if (!Object.hasOwn(outputs, name)) {
      throw new Error(
        `Code node "${nodeName}" referenced node "${name}", which was not supplied to executeCodeNode.`
      );
    }
    const stored = outputs[name];
    return {
      all: () => stored,
      first: () => stored[0],
      last: () => stored[stored.length - 1]
    };
  };

  const sandbox = {
    $input: {
      all: () => items,
      first: () => items[0],
      last: () => items[items.length - 1]
    },
    $: nodeAccessor,
    $now: new Date(nowMs),
    JSON,
    Math,
    Date: createFrozenDate(nowMs),
    Object,
    Array,
    String,
    Number,
    Boolean,
    RegExp,
    Error,
    TypeError,
    Map,
    Set,
    // No `URL` here, deliberately. n8n 2.36.8 Code nodes do not define it, and
    // a harness that supplies it will pass code that cannot run in n8n. This
    // sandbox exists to match that runtime, not to be convenient. Scout parses
    // URLs with its own inlined `parseHttpUrl` for the same reason.
    isNaN,
    isFinite,
    parseInt,
    parseFloat,
    encodeURIComponent,
    decodeURIComponent,
    console: { log: () => {}, warn: () => {}, error: () => {} }
  };

  const context = vm.createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false }
  });

  const wrapped = `(async () => {\n${source}\n})()`;
  const script = new vm.Script(wrapped, { filename: `${nodeName}.js` });

  const raw = await script.runInContext(context, { timeout: 5000 });

  if (!Array.isArray(raw)) {
    throw new Error(`Code node "${nodeName}" must return an array, got ${typeof raw}.`);
  }

  // Values built inside the vm carry that realm's prototypes, so they are not
  // reference-equal to host objects and compare badly in assertions. Cloning
  // brings them into the host realm. n8n items must be serializable anyway.
  return normalizeItems(structuredClone(raw));
}
