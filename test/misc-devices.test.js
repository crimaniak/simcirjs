'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const REPO_ROOT = path.join(__dirname, '..');
const SOURCE_FILES = [
  'simcir.js',
  'simcir-basicset.js',
  'simcir-library.js',
  'misc/simcir-delay.js',
  'misc/simcir-num.js',
  'misc/simcir-transmitter.js',
  'misc/simcir-dso.js',
  'misc/simcir-altfulladder.js',
];

// Logic levels used by simcir: a "hot" wire is 1, a de-asserted wire is null.
const HI = 1;
const LO = null;

const isHot = (v) => v != null;
const nodeValue = (b) => (b ? HI : LO);

// ---------------------------------------------------------------------------
// Deterministic timer harness (same as logic-simulation.test.js).
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

  pump() {
    const pending = Array.from(this._timeouts.values());
    this._timeouts.clear();
    for (const t of pending) {
      t.fn.apply(null, t.args);
    }
  }

  tick() {
    for (const iv of Array.from(this._intervals.values())) {
      iv.fn.apply(null, iv.args);
    }
  }

  settle(n = 8) {
    for (let i = 0; i < n; i += 1) {
      this.pump();
    }
  }
}

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
// Delay
// ---------------------------------------------------------------------------
test('a Delay passes its input through after the configured delay', () => {
  const { harness } = loadSimcir();
  const { devices } = createWorkspace(baseData(
    [
      { type: 'DC', id: 'dc0', x: 0, y: 0 },
      { type: 'Delay', id: 'dl0', x: 40, y: 0 },
      { type: 'Out', id: 'out0', x: 120, y: 0 },
    ],
    [
      { from: 'dc0.out0', to: 'dl0.in0' },
      { from: 'dl0.out0', to: 'out0.in0' },
    ],
  ));
  const outNode = devices.out0.getInputs()[0];

  assert.equal(outNode.getValue(), null, 'output is pending until the delay elapses');

  harness.settle();
  assert.equal(outNode.getValue(), HI, 'output follows once the delay elapses');
});

test('a Delay preserves its direction in its state', () => {
  const { devices } = createWorkspace(baseData([
    { type: 'Delay', id: 'dl0', x: 0, y: 0, state: { direction: 2 } },
  ]));
  assert.equal(devices.dl0.getState().direction, 2);
});

// ---------------------------------------------------------------------------
// Num
// ---------------------------------------------------------------------------
test('a NumSrc toggles its output when its button is pressed', () => {
  const { win, harness } = loadSimcir();
  const { devices } = createWorkspace(baseData(
    [
      { type: 'NumSrc', id: 'src0', x: 0, y: 0 },
      { type: 'Out', id: 'out0', x: 80, y: 0 },
    ],
    [{ from: 'src0.out0', to: 'out0.in0' }],
  ));
  const outNode = devices.out0.getInputs()[0];

  assert.equal(outNode.getValue(), null, 'NumSrc starts de-asserted');
  assert.equal(devices.src0.getState().direction, 0);
  assert.equal(devices.src0.getState().on, false);

  const $button = devices.src0.$ui.find('rect[fill="#cccccc"]');
  $button.trigger('mousedown');
  win.simcir.$(win.document).trigger('mouseup');
  harness.settle();
  assert.equal(outNode.getValue(), HI, 'NumSrc drives hot after the button is pressed');
  assert.equal(devices.src0.getState().direction, 0);
  assert.equal(devices.src0.getState().on, true);
});

test('a NumDsp exposes its input and preserves its direction', () => {
  const { devices } = createWorkspace(baseData([
    { type: 'NumDsp', id: 'dsp0', x: 0, y: 0, state: { direction: 2 } },
  ]));
  assert.equal(devices.dsp0.getInputs().length, 1);
  assert.equal(devices.dsp0.getState().direction, 2);
});

// ---------------------------------------------------------------------------
// Transmitter
// ---------------------------------------------------------------------------
test('a Transmitter relays a signal to same-labeled transmitters', () => {
  const { harness } = loadSimcir();
  const { devices } = createWorkspace(baseData(
    [
      { type: 'DC', id: 'dc0', x: 0, y: 0 },
      { type: 'Transmitter', id: 'tx1', x: 40, y: 0, label: 'ch' },
      { type: 'Transmitter', id: 'tx2', x: 80, y: 0, label: 'ch' },
      { type: 'Out', id: 'out0', x: 120, y: 0 },
    ],
    [
      { from: 'dc0.out0', to: 'tx1.in0' },
      { from: 'tx2.out0', to: 'out0.in0' },
    ],
  ));
  const outNode = devices.out0.getInputs()[0];

  harness.settle();
  assert.equal(outNode.getValue(), HI, 'the receiving transmitter drives its output');
});

// ---------------------------------------------------------------------------
// DSO
// ---------------------------------------------------------------------------
test('a DSO creates with a default number of inputs and exposes its state', () => {
  const { devices } = createWorkspace(baseData([
    { type: 'DSO', id: 'dso0', x: 0, y: 0 },
  ]));
  const dso = devices.dso0;

  // stop the DSO render loop before asserting so a failure cannot hang the suite
  dso.$ui.trigger('deviceRemove');

  assert.equal(dso.getInputs().length, 4);
  assert.equal(dso.getState().playing, true);
  assert.equal(dso.getState().rangeIndex, 0);
});

// ---------------------------------------------------------------------------
// AltFullAdder (custom-layout composite device)
// ---------------------------------------------------------------------------
test('AltFullAdder computes sum and carry for all input combinations', () => {
  const { harness } = loadSimcir();
  const { devices } = createWorkspace(baseData([
    { type: 'AltFullAdder', id: 'fa0', x: 0, y: 0 },
  ]));
  const fa = devices.fa0;
  const [cin, a, b] = fa.getInputs();
  const [cout, sum] = fa.getOutputs();

  for (const cv of [LO, HI]) {
    for (const av of [LO, HI]) {
      for (const bv of [LO, HI]) {
        cin.setValue(cv);
        a.setValue(av);
        b.setValue(bv);
        harness.settle();
        const x = isHot(av) !== isHot(bv);
        const expectedSum = nodeValue(x !== isHot(cv));
        const expectedCout = nodeValue((isHot(cv) && x) || (isHot(av) && isHot(bv)));
        assert.equal(sum.getValue(), expectedSum, `sum(cin=${cv},a=${av},b=${bv})`);
        assert.equal(cout.getValue(), expectedCout, `carry(cin=${cv},a=${av},b=${bv})`);
      }
    }
  }
});
