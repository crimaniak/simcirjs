'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const REPO_ROOT = path.join(__dirname, '..');
const SOURCE_FILES = ['simcir.js', 'simcir-basicset.js', 'simcir-library.js'];

// Logic levels used by simcir: a "hot" wire is 1, a de-asserted wire is null.
const HI = 1;
const LO = null;

const isHot = (v) => v != null;
const nodeValue = (b) => (b ? HI : LO);

// ---------------------------------------------------------------------------
// Deterministic timer harness.
//
// simcir drives logic propagation through a setTimeout based event queue and
// clock devices (OSC) through setInterval. Tests replace the window timers
// with a manually pumped harness so nothing depends on wall-clock timing.
// ---------------------------------------------------------------------------
class TimerHarness {
  constructor(win) {
    this._id = 0;
    this._timeouts = new Map();
    this._intervals = new Map();
    win.setTimeout = (fn, delay, ...args) => {
      const id = ++this._id;
      this._timeouts.set(id, { fn, args });
      return id;
    };
    win.clearTimeout = (id) => {
      this._timeouts.delete(id);
    };
    win.setInterval = (fn, delay, ...args) => {
      const id = ++this._id;
      this._intervals.set(id, { fn, args });
      return id;
    };
    win.clearInterval = (id) => {
      this._intervals.delete(id);
    };
  }

  // Run every currently scheduled timeout exactly once. Timeouts scheduled
  // by a callback are deferred to the next pump.
  pump() {
    const pending = Array.from(this._timeouts.values());
    this._timeouts.clear();
    for (const t of pending) {
      t.fn.apply(null, t.args);
    }
  }

  // Run every interval callback exactly once (OSC clock tick).
  tick() {
    for (const iv of Array.from(this._intervals.values())) {
      iv.fn.apply(null, iv.args);
    }
  }

  // Pump repeatedly so cascades of propagation events settle.
  settle(n = 8) {
    for (let i = 0; i < n; i += 1) {
      this.pump();
    }
  }
}

// ---------------------------------------------------------------------------
// Load simcir (simcir.js + simcir-basicset.js + simcir-library.js) into a
// fresh jsdom window once, with mocked timers.
// ---------------------------------------------------------------------------
let env = null;

function loadSimcir() {
  if (env != null) {
    return env;
  }
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
    runScripts: 'dangerously',
  });
  const win = dom.window;
  const harness = new TimerHarness(win);
  for (const name of SOURCE_FILES) {
    const code = fs.readFileSync(path.join(REPO_ROOT, name), 'utf8');
    const el = win.document.createElement('script');
    el.textContent = code;
    win.document.body.appendChild(el);
  }
  assert.equal(typeof win.simcir, 'object', 'simcir failed to load');
  env = { win, simcir: win.simcir, harness };
  return env;
}

// Build a workspace from data and return the device controllers keyed by id.
function createWorkspace(data) {
  const { win, simcir } = loadSimcir();
  const $workspace = simcir.createWorkspace(data);
  const devices = {};
  $workspace.find('.simcir-device').each(function() {
    const ctrl = win.simcir.$(this).data('controller');
    devices[ctrl.deviceDef.id] = ctrl;
  });
  return { $workspace, devices };
}

function baseData(devices, connectors) {
  return {
    width: 200,
    height: 100,
    showToolbox: false,
    editable: false,
    canAdd: false,
    canRemove: false,
    canMove: false,
    canRewire: false,
    canEdit: false,
    toolbox: [],
    devices,
    connectors: connectors || [],
  };
}

// ---------------------------------------------------------------------------
// Wiring / propagation
// ---------------------------------------------------------------------------
test('an In port drives a connected Out port', () => {
  const { devices } = createWorkspace(baseData(
    [
      { type: 'In', id: 'in0', x: 0, y: 0 },
      { type: 'Out', id: 'out0', x: 80, y: 0 },
    ],
    [{ from: 'in0.out0', to: 'out0.in0' }],
  ));
  const { harness } = loadSimcir();
  const outNode = devices.out0.getInputs()[0];

  assert.equal(outNode.getValue(), null);

  devices.in0.getInputs()[0].setValue(HI);
  harness.settle();
  assert.equal(outNode.getValue(), HI);

  devices.in0.getInputs()[0].setValue(LO);
  harness.settle();
  assert.equal(outNode.getValue(), LO);
});

test('disconnecting stops propagation and reconnecting resumes it', () => {
  const { devices } = createWorkspace(baseData(
    [
      { type: 'DC', id: 'dc0', x: 0, y: 0 },
      { type: 'Out', id: 'out0', x: 80, y: 0 },
    ],
    [{ from: 'dc0.out0', to: 'out0.in0' }],
  ));
  const { harness } = loadSimcir();
  const outNode = devices.out0.getInputs()[0];
  const src = outNode.getOutput();

  assert.equal(outNode.getValue(), HI);

  src.disconnectFrom(outNode);
  assert.equal(outNode.getValue(), null);

  src.setValue(HI);
  harness.settle();
  assert.equal(outNode.getValue(), null, 'disconnected node no longer follows');

  src.connectTo(outNode);
  harness.settle();
  assert.equal(outNode.getValue(), HI, 'reconnected node follows again');
});

test('a Joint passes values through and exposes its direction state', () => {
  const { devices } = createWorkspace(baseData(
    [
      { type: 'Joint', id: 'j0', x: 0, y: 0 },
      { type: 'In', id: 'in0', x: 0, y: 40 },
      { type: 'Out', id: 'out0', x: 80, y: 40 },
    ],
    [
      { from: 'in0.out0', to: 'j0.in0' },
      { from: 'j0.out0', to: 'out0.in0' },
    ],
  ));
  const { harness } = loadSimcir();
  const joint = devices.j0;

  assert.equal(joint.getState().direction, 0);
  assert.equal(joint.getSize().width, 16);
  assert.equal(joint.getSize().height, 16);

  devices.in0.getInputs()[0].setValue(HI);
  harness.settle();
  assert.equal(devices.out0.getInputs()[0].getValue(), HI);

  devices.in0.getInputs()[0].setValue(LO);
  harness.settle();
  assert.equal(devices.out0.getInputs()[0].getValue(), LO);
});

// ---------------------------------------------------------------------------
// Switches
// ---------------------------------------------------------------------------
test('a Toggle switch passes its input through only when on', () => {
  const { devices } = createWorkspace(baseData(
    [
      { type: 'Toggle', id: 'tgOn', x: 0, y: 0, state: { on: true } },
      { type: 'Toggle', id: 'tgOff', x: 0, y: 40 },
      { type: 'PushOff', id: 'po0', x: 0, y: 80 },
      { type: 'PushOn', id: 'pn0', x: 0, y: 120 },
      { type: 'In', id: 'in0', x: 0, y: 160 },
    ],
    [
      { from: 'in0.out0', to: 'tgOn.in0' },
      { from: 'in0.out0', to: 'tgOff.in0' },
    ],
  ));
  const { harness } = loadSimcir();
  devices.in0.getInputs()[0].setValue(HI);
  harness.settle();
  assert.equal(devices.tgOn.getOutputs()[0].getValue(), HI);
  assert.equal(devices.tgOff.getOutputs()[0].getValue(), null);

  // default and persisted states
  assert.equal(devices.tgOff.getState().on, false);
  assert.equal(devices.tgOn.getState().on, true);
  assert.equal(devices.po0.getState().on, true);
  assert.equal(devices.pn0.getState().on, false);
});

// ---------------------------------------------------------------------------
// LED displays
// ---------------------------------------------------------------------------
test('a 4bit7seg sets the hot input pattern (8 inputs, one per segment + dot)', () => {
  const { devices } = createWorkspace(baseData([
    { type: '4bit7seg', id: 'seg0', x: 0, y: 0 },
    { type: '7seg', id: 'seg1', x: 0, y: 80 },
  ]));
  assert.equal(devices.seg1.getInputs().length, 8, '7seg has 8 inputs');
  assert.equal(devices.seg0.getInputs().length, 4, '4bit7seg has 4 inputs');
  assert.equal(devices.seg0.getSize().width, 64, 'LED width is 4 units');
});

// ---------------------------------------------------------------------------
// Buses and sources
// ---------------------------------------------------------------------------
test('a DC source drives its output hot once added', () => {
  const { devices } = createWorkspace(baseData(
    [
      { type: 'DC', id: 'dc0', x: 0, y: 0 },
      { type: 'Out', id: 'out0', x: 80, y: 0 },
    ],
    [{ from: 'dc0.out0', to: 'out0.in0' }],
  ));
  const { harness } = loadSimcir();
  harness.settle();
  assert.equal(devices.out0.getInputs()[0].getValue(), HI);
});

test('a BusOut packs hot inputs into a bus that BusIn unpacks', () => {
  const { devices } = createWorkspace(baseData(
    [
      { type: 'BusOut', id: 'bo0', x: 0, y: 0, numInputs: 4 },
      { type: 'BusIn', id: 'bi0', x: 80, y: 0, numOutputs: 4 },
    ],
    [{ from: 'bo0.out0', to: 'bi0.in0' }],
  ));
  const { harness } = loadSimcir();

  devices.bo0.getInputs()[0].setValue(HI);
  devices.bo0.getInputs()[2].setValue(HI);
  harness.settle();

  assert.equal(devices.bi0.getOutputs()[0].getValue(), HI);
  assert.equal(devices.bi0.getOutputs()[1].getValue(), null);
  assert.equal(devices.bi0.getOutputs()[2].getValue(), HI);
  assert.equal(devices.bi0.getOutputs()[3].getValue(), null);
});

// ---------------------------------------------------------------------------
// Logic gates
// ---------------------------------------------------------------------------
const GATES = {
  BUF:  { inputs: 1, fn: (a) => a },
  NOT:  { inputs: 1, fn: (a) => !a },
  AND:  { inputs: 2, fn: (a, b) => a && b },
  OR:   { inputs: 2, fn: (a, b) => a || b },
  NAND: { inputs: 2, fn: (a, b) => !(a && b) },
  NOR:  { inputs: 2, fn: (a, b) => !(a || b) },
  XOR:  { inputs: 2, fn: (a, b) => a !== b },
  XNOR: { inputs: 2, fn: (a, b) => a === b },
};

for (const [type, spec] of Object.entries(GATES)) {
  test(`${type} truth table`, () => {
    const { devices } = createWorkspace(baseData([
      { type, id: 'g0', x: 0, y: 0, numInputs: spec.inputs },
    ]));
    const { harness } = loadSimcir();
    const gate = devices.g0;
    const inputs = gate.getInputs();
    const output = gate.getOutputs()[0];
    const values = [LO, HI];

    for (const a of values) {
      inputs[0].setValue(a, true);
      if (spec.inputs === 1) {
        harness.settle();
        const expected = nodeValue(spec.fn(isHot(a)));
        assert.equal(output.getValue(), expected, `${type}(${a})`);
      } else {
        for (const b of values) {
          inputs[1].setValue(b, true);
          harness.settle();
          const expected = nodeValue(spec.fn(isHot(a), isHot(b)));
          assert.equal(output.getValue(), expected, `${type}(${a},${b})`);
        }
      }
    }
  });
}

test('a 3-input AND requires every input hot', () => {
  const { devices } = createWorkspace(baseData([
    { type: 'AND', id: 'g0', x: 0, y: 0, numInputs: 3 },
  ]));
  const { harness } = loadSimcir();
  const gate = devices.g0;
  const inputs = gate.getInputs();
  const output = gate.getOutputs()[0];

  inputs[0].setValue(HI);
  inputs[1].setValue(HI);
  inputs[2].setValue(HI);
  harness.settle();
  assert.equal(output.getValue(), HI);

  inputs[1].setValue(LO);
  harness.settle();
  assert.equal(output.getValue(), null);
});

// ---------------------------------------------------------------------------
// Composite devices
// ---------------------------------------------------------------------------
test('HalfAdder computes sum and carry for all input pairs', () => {
  const { devices } = createWorkspace(baseData([
    { type: 'HalfAdder', id: 'ha0', x: 0, y: 0 },
  ]));
  const { harness } = loadSimcir();
  const ha = devices.ha0;

  assert.equal(ha.getInputs()[0].label, 'A');
  assert.equal(ha.getInputs()[1].label, 'B');
  assert.equal(ha.getOutputs()[0].label, 'S');
  assert.equal(ha.getOutputs()[1].label, 'C');

  const [a, b] = ha.getInputs();
  const [s, c] = ha.getOutputs();

  for (const av of [LO, HI]) {
    for (const bv of [LO, HI]) {
      a.setValue(av);
      b.setValue(bv);
      harness.settle();
      assert.equal(s.getValue(), nodeValue(isHot(av) !== isHot(bv)), `sum(${av},${bv})`);
      assert.equal(c.getValue(), nodeValue(isHot(av) && isHot(bv)), `carry(${av},${bv})`);
    }
  }
});

test('RS-FF sets, resets and holds its state', () => {
  const { devices } = createWorkspace(baseData([
    { type: 'RS-FF', id: 'ff0', x: 0, y: 0 },
  ]));
  const { harness } = loadSimcir();
  const ff = devices.ff0;

  assert.equal(ff.getInputs()[0].label, '~S');
  assert.equal(ff.getInputs()[1].label, '~R');
  assert.equal(ff.getOutputs()[0].label, 'Q');
  assert.equal(ff.getOutputs()[1].label, '~Q');

  const [sbar, rbar] = ff.getInputs();
  const [q, qbar] = ff.getOutputs();

  // set: ~S low, ~R high
  sbar.setValue(LO);
  rbar.setValue(HI);
  harness.settle();
  assert.equal(q.getValue(), HI);
  assert.equal(qbar.getValue(), LO);

  // reset: ~S high, ~R low
  sbar.setValue(HI);
  rbar.setValue(LO);
  harness.settle();
  assert.equal(q.getValue(), LO);
  assert.equal(qbar.getValue(), HI);

  // hold: both high keeps the last state
  sbar.setValue(HI);
  rbar.setValue(HI);
  harness.settle();
  assert.equal(q.getValue(), LO);
  assert.equal(qbar.getValue(), HI);
});

// ---------------------------------------------------------------------------
// Clock devices
// ---------------------------------------------------------------------------
test('OSC toggles its output on each interval tick', () => {
  const { devices } = createWorkspace(baseData([
    { type: 'OSC', id: 'osc0', x: 0, y: 0, freq: 1000 },
  ]));
  const { harness } = loadSimcir();
  const out = devices.osc0.getOutputs()[0];

  assert.equal(out.getValue(), null);

  // first tick still drives offValue (null), so nothing changes yet
  harness.tick();
  harness.settle();
  assert.equal(out.getValue(), null);

  harness.tick();
  harness.settle();
  assert.equal(out.getValue(), HI);

  harness.tick();
  harness.settle();
  assert.equal(out.getValue(), null);

  harness.tick();
  harness.settle();
  assert.equal(out.getValue(), HI);
});

test('an OSC drives a connected Out port', () => {
  const { devices } = createWorkspace(baseData(
    [
      { type: 'OSC', id: 'osc0', x: 0, y: 0, freq: 1000 },
      { type: 'Out', id: 'out0', x: 80, y: 0 },
    ],
    [{ from: 'osc0.out0', to: 'out0.in0' }],
  ));
  const { harness } = loadSimcir();
  const outNode = devices.out0.getInputs()[0];

  harness.tick();
  harness.tick();
  harness.settle();
  assert.equal(outNode.getValue(), HI);
});
