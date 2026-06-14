'use strict';

import { createMachine, createInstance, toMermaid, toDOT, FSMError } from './index.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error('  ✗ ' + msg); }
}
function assertThrows(fn, msg) {
  try { fn(); failed++; console.error('  ✗ Should throw: ' + msg); }
  catch (e) { passed++; }
}

// ─── Basic FSM ─────────────────────────────────────────────────────────────
console.log('Basic FSM');
{
  const m = createInstance(createMachine({
    initial: 'green',
    states: {
      green: { on: { TIMER: 'yellow' } },
      yellow: { on: { TIMER: 'red' } },
      red: { on: { TIMER: 'green' } },
    },
  }));
  assert(m.state === 'green', 'Initial state is green');
  assert(m.running === true, 'Machine is running');
  assert(m.send('TIMER') === true, 'TIMER accepted');
  assert(m.state === 'yellow', 'Transitioned to yellow');
  m.send('TIMER');
  assert(m.state === 'red', 'Transitioned to red');
  m.send('TIMER');
  assert(m.state === 'green', 'Cycled back to green');
}

// ─── Unhandled events ──────────────────────────────────────────────────────
console.log('Unhandled events');
{
  const m = createInstance(createMachine({
    initial: 'a',
    states: { a: { on: { GO: 'b' } }, b: {} },
  }));
  assert(m.send('UNKNOWN') === false, 'Unknown event returns false');
  assert(m.state === 'a', 'State unchanged on unknown event');
  m.send('GO');
  assert(m.send('GO') === false, 'No transition from b on GO');
}

// ─── Guards ────────────────────────────────────────────────────────────────
console.log('Guards');
{
  const m = createInstance(createMachine({
    initial: 'locked',
    context: { code: '1234' },
    states: {
      locked: {
        on: {
          UNLOCK: {
            target: 'unlocked',
            guard: ({ context, event }) => event.payload && event.payload.code === context.code,
          },
        },
      },
      unlocked: {},
    },
  }));

  assert(m.send('UNLOCK', { code: 'wrong' }) === false, 'Guard rejects wrong code');
  assert(m.state === 'locked', 'Still locked');
  assert(m.send('UNLOCK', { code: '1234' }) === true, 'Guard accepts correct code');
  assert(m.state === 'unlocked', 'Unlocked');
}

// ─── Actions ───────────────────────────────────────────────────────────────
console.log('Actions');
{
  const log = [];
  const m = createInstance(createMachine({
    initial: 'start',
    states: {
      start: {
        on: {
          GO: {
            target: 'end',
            actions: [({ event }) => log.push('transit:' + event.type)],
          },
        },
        onExit: [() => log.push('exit:start')],
      },
      end: {
        onEnter: [() => log.push('enter:end')],
      },
    },
  }));

  m.send('GO');
  assert(log.join(',') === 'exit:start,transit:GO,enter:end', 'Actions order: ' + log.join(','));
}

// ─── Context ───────────────────────────────────────────────────────────────
console.log('Context');
{
  const m = createInstance(createMachine({
    initial: 'counting',
    context: { count: 0 },
    states: {
      counting: {
        on: {
          INC: {
            target: 'counting',
            actions: [({ setContext, context }) => setContext({ count: context.count + 1 })],
          },
        },
      },
    },
  }));

  m.send('INC'); m.send('INC'); m.send('INC');
  assert(m.context.count === 3, 'Count is 3, got ' + m.context.count);
}

// ─── Hierarchical States ───────────────────────────────────────────────────
console.log('Hierarchical states');
{
  const m = createInstance(createMachine({
    initial: 'idle',
    states: {
      idle: {
        on: { START: 'active' },
      },
      active: {
        initial: 'running',
        states: {
          running: { on: { PAUSE: 'active.paused' } },
          paused: { on: { RESUME: 'active.running' } },
        },
        on: { STOP: 'idle' },
      },
    },
  }));

  assert(m.state === 'idle', 'Starts idle');
  m.send('START');
  assert(m.state === 'active.running', 'START -> active.running, got ' + m.state);
  m.send('PAUSE');
  assert(m.state === 'active.paused', 'PAUSE -> active.paused, got ' + m.state);
  m.send('RESUME');
  assert(m.state === 'active.running', 'RESUME -> active.running, got ' + m.state);
  m.send('STOP');
  assert(m.state === 'idle', 'STOP from child -> idle, got ' + m.state);
}

// ─── Prefix matching ───────────────────────────────────────────────────────
console.log('Prefix matching');
{
  const m = createInstance(createMachine({
    initial: 'parent.child',
    states: {
      parent: {
        initial: 'child',
        states: {
          child: {},
        },
      },
    },
  }));

  assert(m.matches('parent') === true, 'matches parent');
  assert(m.matches('parent.child') === true, 'matches parent.child');
  assert(m.matches('other') === false, 'does not match other');
}

// ─── can() method ──────────────────────────────────────────────────────────
console.log('can() method');
{
  const m = createInstance(createMachine({
    initial: 'idle',
    context: { ready: true },
    states: {
      idle: {
        on: {
          GO: {
            target: 'done',
            guard: ({ context }) => context.ready,
          },
        },
      },
      done: {},
    },
  }));

  assert(m.can('GO') === true, 'can GO (guard passes)');
  assert(m.can('NOPE') === false, 'cannot NOPE');
}

// ─── Lifecycle hooks ───────────────────────────────────────────────────────
console.log('Lifecycle hooks');
{
  const transitions = [];
  const states = [];
  const events = [];

  const m = createInstance(createMachine({
    initial: 'a',
    states: {
      a: { on: { GO: 'b' } },
      b: {},
    },
  }));

  m.on('transition', (t) => transitions.push(t.from + '->' + t.to));
  m.on('state', (s) => states.push(s.state));
  m.on('event', (e) => events.push(e.type));

  m.send('GO');

  assert(transitions.length === 1 && transitions[0] === 'a->b', 'Transition hook fired');
  assert(states.includes('b'), 'State hook fired with b');
  assert(events.includes('GO'), 'Event hook fired');
}

// ─── Unsubscribe ───────────────────────────────────────────────────────────
console.log('Unsubscribe');
{
  let count = 0;
  const m = createInstance(createMachine({
    initial: 'a',
    states: { a: { on: { GO: 'b' } }, b: { on: { GO: 'a' } } },
  }));

  const unsub = m.on('transition', () => count++);
  m.send('GO');
  assert(count === 1, 'Listener fired once');
  unsub();
  m.send('GO');
  assert(count === 1, 'Listener not fired after unsub');
}

// ─── Final states ──────────────────────────────────────────────────────────
console.log('Final states');
{
  const m = createInstance(createMachine({
    initial: 'start',
    states: {
      start: { on: { DONE: 'end' } },
      end: { type: 'final' },
    },
  }));

  assert(m.running === true, 'Machine running');
  m.send('DONE');
  assert(m.state === 'end', 'In final state');
  assert(m.running === false, 'Machine stopped on final');
  assert(m.send('ANYTHING') === false, 'No events when stopped');
}

// ─── Reset ─────────────────────────────────────────────────────────────────
console.log('Reset');
{
  const m = createInstance(createMachine({
    initial: 'a',
    states: { a: { on: { GO: 'b' } }, b: {} },
  }));

  m.send('GO');
  assert(m.state === 'b', 'In state b');
  m.reset();
  assert(m.state === 'a', 'Reset to initial');
  m.reset('b');
  assert(m.state === 'b', 'Reset to b');
}

// ─── Serialization ─────────────────────────────────────────────────────────
console.log('Serialization');
{
  const m1 = createInstance(createMachine({
    initial: 'a',
    context: { count: 5 },
    states: { a: { on: { GO: 'b' } }, b: {} },
  }));

  m1.send('GO');
  const json = m1.toJSON();

  const m2 = createInstance(createMachine({
    initial: 'a',
    context: { count: 0 },
    states: { a: { on: { GO: 'b' } }, b: {} },
  }));

  m2.fromJSON(json);
  assert(m2.state === 'b', 'Restored state b');
  assert(m2.context.count === 5, 'Restored context count=5, got ' + m2.context.count);
}

// ─── Available events ──────────────────────────────────────────────────────
console.log('Available events');
{
  const m = createInstance(createMachine({
    initial: 'idle',
    states: {
      idle: { on: { START: 'active', RESET: 'idle' } },
      active: {
        initial: 'running',
        states: {
          running: { on: { PAUSE: 'active.paused' } },
          paused: { on: { RESUME: 'active.running' } },
        },
        on: { STOP: 'idle' },
      },
    },
  }));

  const events = m.availableEvents();
  assert(events.includes('START'), 'START available from idle');
  assert(events.includes('RESET'), 'RESET available from idle');
  assert(!events.includes('PAUSE'), 'PAUSE not available from idle');

  m.send('START');
  const activeEvents = m.availableEvents();
  assert(activeEvents.includes('PAUSE'), 'PAUSE available from active.running');
  assert(activeEvents.includes('STOP'), 'STOP available (from parent active)');
}

// ─── Mermaid export ────────────────────────────────────────────────────────
console.log('Mermaid export');
{
  const def = createMachine({
    initial: 'green',
    states: {
      green: { on: { TIMER: 'yellow' } },
      yellow: { on: { TIMER: 'red' } },
      red: { on: { TIMER: 'green' } },
    },
  });

  const mermaid = toMermaid(def);
  assert(mermaid.includes('stateDiagram-v2'), 'Has stateDiagram-v2 header');
  assert(mermaid.includes('[*] --> green'), 'Has initial transition');
  assert(mermaid.includes('green --> yellow: TIMER'), 'Has green to yellow transition');
}

// ─── DOT export ────────────────────────────────────────────────────────────
console.log('DOT export');
{
  const def = createMachine({
    initial: 'green',
    states: {
      green: { on: { TIMER: 'yellow' } },
      yellow: { on: { TIMER: 'red' } },
      red: { on: { TIMER: 'green' } },
    },
  });

  const dot = toDOT(def);
  assert(dot.includes('digraph'), 'Has digraph');
  assert(dot.includes('"green" -> "yellow"'), 'Has green to yellow edge');
}

// ─── Validation ────────────────────────────────────────────────────────────
console.log('Validation');
assertThrows(() => createMachine(null), 'null config throws');
assertThrows(() => createMachine({}), 'empty config throws');
assertThrows(() => createMachine({ initial: 'x' }), 'no states throws');
assertThrows(() => createMachine({ initial: 'nonexistent', states: {} }), 'invalid initial throws');

// ─── Internal transitions ──────────────────────────────────────────────────
console.log('Internal transitions');
{
  let actionRan = false;
  const m = createInstance(createMachine({
    initial: 'a',
    states: {
      a: {
        on: {
          SELF: {
            actions: [() => { actionRan = true; }],
          },
        },
      },
    },
  }));

  m.send('SELF');
  assert(m.state === 'a', 'Still in a (internal)');
  assert(actionRan === true, 'Action ran on internal transition');
}

// ─── Stop & lifecycle ──────────────────────────────────────────────────────
console.log('Stop & lifecycle');
{
  const m = createInstance(createMachine({
    initial: 'a',
    states: { a: { on: { GO: 'b' } }, b: {} },
  }));

  m.stop();
  assert(m.running === false, 'Machine stopped');
  assert(m.send('GO') === false, 'No events when stopped');
}

// ─── Payload passing ───────────────────────────────────────────────────────
console.log('Payload passing');
{
  let receivedPayload = null;
  const m = createInstance(createMachine({
    initial: 'a',
    states: {
      a: {
        on: {
          GO: {
            target: 'b',
            actions: [({ event }) => { receivedPayload = event.payload; }],
          },
        },
      },
      b: {},
    },
  }));

  m.send('GO', { value: 42, name: 'test' });
  assert(receivedPayload && receivedPayload.value === 42, 'Payload received in action');
}

// ─── Wildcard event ────────────────────────────────────────────────────────
console.log('Wildcard event');
{
  const m = createInstance(createMachine({
    initial: 'a',
    states: {
      a: { on: { '*': 'b' } },
      b: {},
    },
  }));

  assert(m.send('ANYTHING') === true, 'Wildcard catches any event');
  assert(m.state === 'b', 'Transitioned via wildcard');
}

// ─── Summary ───────────────────────────────────────────────────────────────
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
