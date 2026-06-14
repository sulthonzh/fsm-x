# fsm-x

Zero-dependency finite state machine library for JavaScript/TypeScript. Hierarchical states, guards, actions, history, and visualization export — all in ~600 lines with zero deps.

## Why?

Most FSM libraries are either too simple (no nesting, no guards) or too heavy (xstate pulls in dozens of deps). `fsm-x` gives you the important features in a tiny, dependency-free package.

## Install

```bash
npm install fsm-x
```

## Quick Start

```js
import { createMachine, createInstance } from 'fsm-x';

const machine = createInstance(createMachine({
  initial: 'green',
  states: {
    green:  { on: { TIMER: 'yellow' } },
    yellow: { on: { TIMER: 'red' } },
    red:    { on: { TIMER: 'green' }, onEnter: ({ setContext }) => setContext({ cycles: 1 }) },
  },
  context: { cycles: 0 },
}));

machine.send('TIMER'); // → yellow
machine.send('TIMER'); // → red, context.cycles = 1
machine.send('TIMER'); // → green
machine.state;         // 'green'
```

## Hierarchical States

```js
const machine = createInstance(createMachine({
  initial: 'idle',
  states: {
    idle: {
      on: { START: 'active' },
    },
    active: {
      initial: 'running',
      states: {
        running: { on: { PAUSE: 'paused' } },
        paused:  { on: { RESUME: 'running' } },
      },
      on: { STOP: 'idle' }, // applies to all child states
    },
  },
}));

// 'START' transitions to 'active.running' (auto-enters initial child)
machine.send('START');  // → active.running
machine.send('PAUSE');  // → active.paused
machine.send('STOP');   // → idle (matched on parent 'active')
```

## Guards & Actions

```js
const machine = createInstance(createMachine({
  initial: 'doorClosed',
  context: { locked: false },
  states: {
    doorClosed: {
      on: {
        OPEN: {
          target: 'doorOpen',
          guard: ({ context }) => !context.locked, // can't open a locked door
          actions: [({ setContext }) => setContext({ openCount: 1 })],
        },
      },
    },
    doorOpen: {
      on: { CLOSE: 'doorClosed' },
      onEnter: [({ context }) => console.log('Door opened!')],
    },
  },
}));

machine.send('OPEN'); // ✓ transitions + runs action
```

## History States

```js
const machine = createInstance(createMachine({
  initial: 'playing',
  states: {
    playing: {
      initial: 'menu',
      states: {
        menu:   { on: { SELECT: 'level' } },
        level:  { on: { BACK: 'menu', PAUSE: 'paused' } },
        paused: { on: { RESUME: 'level.H' } }, // → back to wherever we were in playing
      },
    },
  },
}));

machine.send('SELECT'); // → playing.level
machine.send('PAUSE');  // → playing.paused
machine.send('RESUME'); // → playing.level (restored from history)
```

## Lifecycle Hooks

```js
const machine = createInstance(def);

machine.on('transition', ({ from, to, event }) => {
  console.log(`${from} → ${to} (${event})`);
});

machine.on('state', ({ state }) => {
  console.log(`Now in: ${state}`);
});

machine.on('error', ({ error }) => {
  console.error('FSM error:', error.message);
});
```

## Visualization

```js
// Export as Mermaid diagram
console.log(machine.toMermaid());

// Export as Graphviz DOT
console.log(machine.toDOT());
```

Or via CLI:

```bash
fsmx mermaid config.json    # Mermaid state diagram
fsmx dot config.json        # Graphviz DOT
fsmx info config.json       # State tree overview
fsmx run config.json TIMER  # Send an event
fsmx demo                   # Traffic light demo
```

## API

### `createMachine(config)` → MachineDef

- `config.initial` — Initial state (string)
- `config.states` — State tree (see below)
- `config.context` — Initial extended state (object)
- `config.id` — Optional machine ID

### `createInstance(machineDef, opts?)` → MachineInstance

- `opts.context` — Override initial context
- `opts.shallowHistory` — Enable shallow history
- `opts.deepHistory` — Enable deep history

### MachineInstance

| Method | Description |
|--------|-------------|
| `send(event, payload?)` | Send an event. Returns `true` if transition occurred. |
| `can(event, payload?)` | Check if event would trigger a transition. |
| `matches(statePath)` | Check if machine is in a state (supports prefix matching). |
| `availableEvents()` | List events available from current state. |
| `on(type, fn)` | Subscribe to `transition`, `state`, `event`, or `error`. Returns unsubscribe. |
| `stop()` | Stop the machine. |
| `reset(state?)` | Reset to initial or specified state. |
| `toJSON()` / `fromJSON(str)` | Serialize/restore machine state. |
| `toMermaid()` / `toDOT()` | Export visualization. |

### State Definition

```js
stateName: {
  initial: 'childState',       // For compound states
  type: 'final',               // Mark as final state
  on: {
    EVENT_NAME: 'targetState', // Simple transition
    // or
    EVENT_NAME: {
      target: 'targetState',
      guard: ({ context, event }) => boolean,
      actions: [({ context, event, setContext }) => void],
    },
  },
  onEnter: [fn] | fn,          // Runs when entering this state
  onExit: [fn] | fn,           // Runs when exiting this state
  states: { ... },             // Nested child states
}
```

## License

MIT
