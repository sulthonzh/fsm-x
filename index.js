'use strict';

/**
 * fsm-x — Zero-dependency finite state machine library.
 *
 * Supports: flat & hierarchical (nested) states, guarded transitions,
 * entry/exit/transition actions, internal/external transitions,
 * history states, event payloads, lifecycle hooks,
 * serialization, and Mermaid/DOT visualization export.
 *
 * @module fsm-x
 */

class FSMError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FSMError';
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function cloneWithFunctions(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (typeof obj === 'function') return obj;
  if (Array.isArray(obj)) return obj.map(cloneWithFunctions);
  const copy = {};
  for (const [k, v] of Object.entries(obj)) {
    copy[k] = typeof v === 'function' ? v : cloneWithFunctions(v);
  }
  return copy;
}

function toArray(val) {
  return val == null ? [] : Array.isArray(val) ? val : [val];
}

function parentState(state) {
  const i = state.lastIndexOf('.');
  return i === -1 ? null : state.slice(0, i);
}

function lca(a, b) {
  const ap = a.split('.');
  const bp = b.split('.');
  let i = 0;
  while (i < ap.length && i < bp.length && ap[i] === bp[i]) i++;
  return i === 0 ? null : ap.slice(0, i).join('.');
}

function getStateNode(states, path) {
  const parts = path.split('.');
  let node = states[parts[0]];
  if (!node) return null;
  for (let i = 1; i < parts.length; i++) {
    if (!node.states) return null;
    node = node.states[parts[i]];
    if (!node) return null;
  }
  return node;
}

// ─── Machine Definition ────────────────────────────────────────────────────

function createMachine(config) {
  if (!config || typeof config !== 'object') {
    throw new FSMError('Machine config must be an object');
  }
  if (!config.initial || typeof config.initial !== 'string') {
    throw new FSMError('config.initial (string) is required');
  }
  if (!config.states || typeof config.states !== 'object') {
    throw new FSMError('config.states (object) is required');
  }

  const resolved = resolveInitialState(config.states, config.initial);
  const statesCopy = cloneWithFunctions(config.states);

  return Object.freeze({
    id: config.id || 'machine',
    initial: resolved,
    states: statesCopy,
    context: config.context !== undefined ? config.context : {},
  });
}

function resolveInitialState(states, initial) {
  let current = initial;
  let guard = 20;
  while (guard-- > 0) {
    const node = getStateNode(states, current);
    if (!node) throw new FSMError(`Initial state "${current}" does not exist`);
    if (node.initial) {
      current = current + '.' + node.initial;
    } else {
      break;
    }
  }
  return current;
}

// ─── Machine Instance ──────────────────────────────────────────────────────

function createInstance(machineOrConfig, opts = {}) {
  const def = machineOrConfig.states
    ? machineOrConfig
    : createMachine(machineOrConfig);

  const context = { ...(def.context || {}), ...(opts.context || {}) };
  let state = def.initial;
  let running = true;
  const history = {};
  const listeners = { transition: [], state: [], event: [], error: [] };

  function emit(type, payload) {
    for (const fn of listeners[type] || []) {
      try { fn(payload); } catch (e) { /* swallow */ }
    }
  }

  function findTransition(eventType) {
    let checkState = state;
    while (checkState) {
      const node = getStateNode(def.states, checkState);
      if (node && node.on) {
        for (const [pattern, rawTarget] of Object.entries(node.on)) {
          if (pattern === eventType || pattern === '*') {
            if (typeof rawTarget === 'string') {
              return { from: checkState, target: rawTarget, guard: null, actions: [] };
            }
            return {
              from: checkState,
              target: rawTarget.target || null,
              guard: rawTarget.guard || null,
              actions: toArray(rawTarget.actions),
            };
          }
        }
      }
      checkState = parentState(checkState);
    }
    return null;
  }

  function resolveTarget(target) {
    if (!target) return null;
    if (target.endsWith('.H') || target.endsWith('.H*')) {
      const parent = target.replace(/\.H\*?$/, '');
      if (history[parent]) return history[parent].shallow;
      const node = getStateNode(def.states, parent);
      return node && node.initial ? parent + '.' + node.initial : parent;
    }
    return target;
  }

  function computeExitEnter(from, to) {
    const anc = lca(from, to);
    const exits = [];
    const enters = [];

    let s = from;
    while (s && s !== anc) {
      exits.push(s);
      s = parentState(s);
    }

    s = to;
    while (s && s !== anc) {
      enters.unshift(s);
      s = parentState(s);
    }

    return { exits, enters };
  }

  function runActions(actionsList, event, ctx) {
    for (const action of actionsList) {
      if (typeof action === 'function') {
        action({
          state,
          event,
          context: ctx,
          setState: (s) => { state = s; },
          setContext: (updater) => {
            if (typeof updater === 'function') Object.assign(ctx, updater(ctx));
            else if (typeof updater === 'object') Object.assign(ctx, updater);
          },
        });
      }
    }
  }

  // Run initial state entry actions + descend into compound states
  function enterStateRecursive(path, event, ctx) {
    const node = getStateNode(def.states, path);
    if (node && node.onEnter) {
      runActions(toArray(node.onEnter), event, ctx);
    }
    if (node && node.initial) {
      const childPath = path + '.' + node.initial;
      state = childPath;
      enterStateRecursive(childPath, event, ctx);
    } else {
      state = path;
    }
  }

  // Enter initial state chain
  enterStateRecursive(def.initial, { type: '__init__', payload: {} }, context);
  emit('state', { state, previousState: null });

  const instance = {
    get state() { return state; },
    get context() { return context; },
    get running() { return running; },
    def,

    send(eventType, payload = {}) {
      if (!running) {
        emit('error', { error: new FSMError('Machine has stopped'), eventType });
        return false;
      }

      emit('event', { type: eventType, payload });

      const trans = findTransition(eventType);
      if (!trans) return false;

      const target = resolveTarget(trans.target);

      // Internal transition (no target) — run actions only
      if (!target) {
        runActions(trans.actions, { type: eventType, payload }, context);
        return true;
      }

      // Guard check
      if (trans.guard) {
        const guardCtx = {
          context,
          event: { type: eventType, payload },
          from: trans.from,
          to: target,
        };
        if (!trans.guard(guardCtx)) return false;
      }

      const { exits, enters } = computeExitEnter(trans.from, target);

      // Record history for exited compound states
      for (const ex of exits) {
        const p = parentState(ex);
        if (p !== null) {
          history[p] = { shallow: ex };
        }
      }

      // Run exit actions (children first)
      for (const ex of exits) {
        const node = getStateNode(def.states, ex);
        if (node && node.onExit) {
          runActions(toArray(node.onExit), { type: eventType, payload }, context);
        }
      }

      // Run transition actions
      runActions(trans.actions, { type: eventType, payload }, context);

      // Enter states (parents first), descending into initials
      let lastEntered = null;
      for (const en of enters) {
        const node = getStateNode(def.states, en);
        if (node) {
          if (node.onEnter) {
            runActions(toArray(node.onEnter), { type: eventType, payload }, context);
          }
          lastEntered = en;
          // If compound, descend to initial
          if (node.initial) {
            const childPath = en + '.' + node.initial;
            const childNode = getStateNode(def.states, childPath);
            if (childNode) {
              if (childNode.onEnter) {
                runActions(toArray(childNode.onEnter), { type: eventType, payload }, context);
              }
              lastEntered = childPath;
              // Keep descending
              let deeper = childNode;
              let deeperPath = childPath;
              while (deeper && deeper.initial) {
                deeperPath = deeperPath + '.' + deeper.initial;
                deeper = getStateNode(def.states, deeperPath);
                if (deeper) {
                  if (deeper.onEnter) {
                    runActions(toArray(deeper.onEnter), { type: eventType, payload }, context);
                  }
                  lastEntered = deeperPath;
                }
              }
            }
          }
        }
      }

      const previousState = state;
      state = lastEntered || target;

      // Check final
      const finalNode = getStateNode(def.states, state);
      if (finalNode && finalNode.type === 'final') {
        running = false;
      }

      emit('transition', { from: previousState, to: state, event: eventType, payload });
      emit('state', { state, previousState });

      return true;
    },

    can(eventType, payload = {}) {
      const trans = findTransition(eventType);
      if (!trans) return false;
      if (trans.guard) {
        const target = resolveTarget(trans.target);
        if (!trans.guard({ context, event: { type: eventType, payload }, from: trans.from, to: target })) {
          return false;
        }
      }
      return true;
    },

    matches(checkState) {
      if (checkState === state) return true;
      return state.startsWith(checkState + '.') || state === checkState;
    },

    on(type, fn) {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(fn);
      return () => {
        const i = listeners[type].indexOf(fn);
        if (i >= 0) listeners[type].splice(i, 1);
      };
    },

    stop() {
      running = false;
      emit('state', { state: null, previousState: state });
    },

    reset(targetState) {
      state = targetState || def.initial;
      running = true;
      for (const k of Object.keys(history)) delete history[k];
      emit('state', { state, previousState: null });
    },

    availableEvents() {
      const events = new Set();
      let s = state;
      while (s) {
        const node = getStateNode(def.states, s);
        if (node && node.on) {
          for (const k of Object.keys(node.on)) events.add(k);
        }
        s = parentState(s);
      }
      return [...events];
    },

    toJSON() {
      return JSON.stringify({ state, context: { ...context }, running, history });
    },

    fromJSON(json) {
      const data = JSON.parse(json);
      state = data.state;
      Object.assign(context, data.context || {});
      running = data.running !== false;
      for (const k of Object.keys(history)) delete history[k];
      Object.assign(history, data.history || {});
    },

    toMermaid() { return toMermaid(def); },
    toDOT() { return toDOT(def); },
  };

  return instance;
}

// ─── Visualization ─────────────────────────────────────────────────────────

function collectTransitions(states, prefix = '') {
  const result = [];
  for (const [name, node] of Object.entries(states)) {
    const fullState = prefix ? prefix + '.' + name : name;
    if (node.on) {
      for (const [event, target] of Object.entries(node.on)) {
        const tgt = typeof target === 'string' ? target : target.target;
        result.push({ from: fullState, event, to: tgt || '(internal)' });
      }
    }
    if (node.states) {
      result.push(...collectTransitions(node.states, fullState));
    }
  }
  return result;
}

function collectStateNames(states, prefix = '') {
  const names = [];
  for (const [name, node] of Object.entries(states)) {
    const fullState = prefix ? prefix + '.' + name : name;
    names.push({ name: fullState, node });
    if (node.states) {
      names.push(...collectStateNames(node.states, fullState));
    }
  }
  return names;
}

function dotSafe(name) {
  return name.replace(/\./g, '_');
}

function toMermaid(def) {
  const lines = ['stateDiagram-v2'];
  lines.push(`  [*] --> ${dotSafe(def.initial)}`);

  const transitions = collectTransitions(def.states);
  const seen = new Set();
  for (const t of transitions) {
    if (t.to === '(internal)') continue;
    const key = `${t.from}->${t.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`  ${dotSafe(t.from)} --> ${dotSafe(t.to)}: ${t.event}`);
  }

  const stateNames = collectStateNames(def.states);
  for (const { name, node } of stateNames) {
    if (node.type === 'final') {
      lines.push(`  ${dotSafe(name)} --> [*]`);
    }
  }

  return lines.join('\n');
}

function toDOT(def) {
  const lines = [`digraph "${def.id || 'machine'}" {`, '  rankdir=LR;', '  node [shape=circle];'];
  lines.push('  "__init" [shape=point];');

  lines.push(`  "__init" -> "${def.initial}";`);

  const transitions = collectTransitions(def.states);
  const seen = new Set();
  for (const t of transitions) {
    if (t.to === '(internal)') continue;
    const key = `${t.from}->${t.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`  "${t.from}" -> "${t.to}" [label="${t.event}"];`);
  }

  const stateNames = collectStateNames(def.states);
  for (const { name, node } of stateNames) {
    if (node.type === 'final') {
      lines.push(`  "${name}" [shape=doublecircle];`);
    }
  }

  lines.push('}');
  return lines.join('\n');
}

// ─── Exports ───────────────────────────────────────────────────────────────

export { createMachine, createInstance, toMermaid, toDOT, FSMError };
export default { createMachine, createInstance, toMermaid, toDOT, FSMError };
