#!/usr/bin/env node
'use strict';

import { createMachine, createInstance, toMermaid, toDOT } from './index.js';
import { readFileSync } from 'fs';

function usage() {
  return `
fsm-x CLI — Finite state machine toolkit

Usage:
  fsmx run <config.json> <event> [payload]   Send an event to a machine
  fsmx events <config.json>                  List available events from initial state
  fsmx info <config.json>                    Show machine structure
  fsmx mermaid <config.json>                 Export Mermaid state diagram
  fsmx dot <config.json>                     Export Graphviz DOT diagram
  fsmx demo                                  Run the traffic light demo

Config format (JSON):
{
  "initial": "green",
  "states": {
    "green": { "on": { "TIMER": "yellow" } },
    "yellow": { "on": { "TIMER": "red" } },
    "red": { "on": { "TIMER": "green" } }
  }
}
`;
}

function loadConfig(path) {
  const raw = readFileSync(path, 'utf-8');
  return JSON.parse(raw);
}

function demo() {
  const config = {
    initial: 'green',
    id: 'traffic-light',
    states: {
      green: {
        on: { TIMER: 'yellow' },
        onEnter: ({ context }) => console.log('  → Green light! Go.'),
      },
      yellow: {
        on: { TIMER: 'red' },
        onEnter: ({ context }) => console.log('  → Yellow light! Slow down.'),
      },
      red: {
        on: { TIMER: 'green' },
        onEnter: ({ context }) => console.log('  → Red light! Stop.'),
      },
    },
  };

  console.log('🚦 Traffic Light Demo\n');
  const machine = createInstance(createMachine(config));

  console.log(`Current: ${machine.state}`);
  for (const event of ['TIMER', 'TIMER', 'TIMER', 'TIMER', 'TIMER']) {
    const ok = machine.send(event);
    console.log(`  ${event} → ${machine.state} (accepted: ${ok})`);
  }
}

function main() {
  const [, , cmd, ...rest] = process.argv;

  if (!cmd || cmd === '--help' || cmd === '-h') {
    console.log(usage());
    process.exit(0);
  }

  if (cmd === 'demo') {
    demo();
    return;
  }

  if (cmd === 'mermaid') {
    const [configPath] = rest;
    if (!configPath) { console.error('Error: config path required'); process.exit(1); }
    const config = loadConfig(configPath);
    const def = createMachine(config);
    console.log(toMermaid(def));
    return;
  }

  if (cmd === 'dot') {
    const [configPath] = rest;
    if (!configPath) { console.error('Error: config path required'); process.exit(1); }
    const config = loadConfig(configPath);
    const def = createMachine(config);
    console.log(toDOT(def));
    return;
  }

  if (cmd === 'events') {
    const [configPath] = rest;
    if (!configPath) { console.error('Error: config path required'); process.exit(1); }
    const config = loadConfig(configPath);
    const def = createMachine(config);
    const machine = createInstance(def);
    console.log(`Available events from "${machine.state}":`);
    for (const e of machine.availableEvents()) console.log(`  • ${e}`);
    return;
  }

  if (cmd === 'info') {
    const [configPath] = rest;
    if (!configPath) { console.error('Error: config path required'); process.exit(1); }
    const config = loadConfig(configPath);

    function showStates(states, prefix = '', depth = 0) {
      for (const [name, node] of Object.entries(states)) {
        const full = prefix ? prefix + '.' + name : name;
        const type = node.type === 'final' ? ' (final)' : node.initial ? ' (compound)' : '';
        const events = node.on ? Object.keys(node.on).join(', ') : '';
        console.log(`${'  '.repeat(depth)}• ${full}${type}${events ? ' → [' + events + ']' : ''}`);
        if (node.states) showStates(node.states, full, depth + 1);
      }
    }

    console.log(`Machine: ${config.id || 'machine'}`);
    console.log(`Initial: ${config.initial}\n`);
    console.log('States:');
    showStates(config.states || {});
    return;
  }

  if (cmd === 'run') {
    const [configPath, event, ...payloadParts] = rest;
    if (!configPath || !event) {
      console.error('Usage: fsmx run <config.json> <event> [jsonPayload]');
      process.exit(1);
    }
    const config = loadConfig(configPath);
    const machine = createInstance(createMachine(config));

    let payload = {};
    if (payloadParts.length > 0) {
      try { payload = JSON.parse(payloadParts.join(' ')); } catch { /* empty payload */ }
    }

    const accepted = machine.send(event, payload);
    console.log(JSON.stringify({
      accepted,
      state: machine.state,
      running: machine.running,
      context: machine.context,
    }, null, 2));
    return;
  }

  console.error(`Unknown command: ${cmd}\n${usage()}`);
  process.exit(1);
}

main();
