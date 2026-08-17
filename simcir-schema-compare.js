//
// SimcirJS - Schema Compare
//
// Copyright (c) 2026
//
// Licensed under the MIT license:
//  http://www.opensource.org/licenses/mit-license.php
//

!function($s) {

  'use strict';

  var deepEqual = function(a, b) {
    if (a === b) {
      return true;
    }
    if (a == null || b == null) {
      return false;
    }
    if (typeof a != 'object' || typeof b != 'object') {
      return false;
    }
    if (Array.isArray(a) != Array.isArray(b) ) {
      return false;
    }
    var keys1 = Object.keys(a);
    var keys2 = Object.keys(b);
    if (keys1.length != keys2.length) {
      return false;
    }
    for (var i = 0; i < keys1.length; i += 1) {
      var key = keys1[i];
      if (!Object.prototype.hasOwnProperty.call(b, key) ||
          !deepEqual(a[key], b[key]) ) {
        return false;
      }
    }
    return true;
  };

  // Build equivalency groups from device metadata registered via registerDevice.
  var buildDeviceEquivalencyGroups = function() {
    var groups = {};
    var types = $s.getDeviceTypes();
    for (var i = 0; i < types.length; i += 1) {
      var meta = $s.getDeviceMetadata(types[i]);
      if (meta != null && meta.equivalencyGroups != null) {
        groups[types[i]] = meta.equivalencyGroups;
      }
    }
    return groups;
  };

  var mergeEquivalencyGroups = function(base, overrides) {
    var merged = {};
    Object.keys(base).forEach(function(type) {
      merged[type] = base[type];
    });
    Object.keys(overrides || {}).forEach(function(type) {
      merged[type] = overrides[type];
    });
    return merged;
  };

  var portRe = /^(\w+)\.(in|out)([0-9]+)$/;

  var parsePort = function(path) {
    var m = portRe.exec(path);
    if (m == null) {
      throw 'unknown port path:' + path;
    }
    return { devId : m[1], kind : m[2], index : +m[3] };
  };

  // maps a port to an equivalence class key.
  // ports in the same group produce the same key.
  var portClass = function(options, devMap, port) {
    var devDef = devMap[port.devId];
    var groups = null;
    if (!options.ignoreEquivalencyGroups && devDef != null) {
      var byType = options.equivalencyGroups[devDef.type];
      if (byType != null) {
        groups = (port.kind == 'in')? byType.inputs : byType.outputs;
      }
    }
    if (groups != null) {
      var portId = port.kind + port.index;
      for (var i = 0; i < groups.length; i += 1) {
        var group = groups[i];
        for (var j = 0; j < group.length; j += 1) {
          var gid = group[j];
          if (gid == portId || gid == port.kind + '*') {
            return port.kind + ':' + i;
          }
        }
      }
    }
    return port.kind + port.index;
  };

  var connectionKey = function(options, devMap, conn) {
    var a = parsePort(conn.from);
    var b = parsePort(conn.to);
    var src;
    var tgt;
    if (a.kind == 'out' && b.kind == 'in') {
      src = a;
      tgt = b;
    } else if (a.kind == 'in' && b.kind == 'out') {
      src = b;
      tgt = a;
    } else {
      throw 'not a connection:' + conn.from + ' -> ' + conn.to;
    }
    return src.devId + ':' + portClass(options, devMap, src) +
        '>' + tgt.devId + ':' + portClass(options, devMap, tgt);
  };

  class SchemaComparatorOptions {
    constructor(options) {
      options = options || {};
      this.omitAttributes = options.omitAttributes != null?
          options.omitAttributes : ['x', 'y'];
      this.ignoreEquivalencyGroups = options.ignoreEquivalencyGroups || false;
      this.equivalencyGroups = mergeEquivalencyGroups(
          buildDeviceEquivalencyGroups(), options.equivalencyGroups);
    }
  }

  class SchemaComparator {
    constructor(options) {
      this.options = options instanceof SchemaComparatorOptions?
          options : new SchemaComparatorOptions(options);
    }

    compare(schema1, schema2) {
      var options = this.options;
      var devMap1 = {};
      var devMap2 = {};
      (schema1.devices || []).forEach(function(dev) {
        devMap1[dev.id] = dev;
      });
      (schema2.devices || []).forEach(function(dev) {
        devMap2[dev.id] = dev;
      });

      var ids1 = Object.keys(devMap1).sort();
      var ids2 = Object.keys(devMap2).sort();

      var missing = [];
      var extra = [];
      ids1.forEach(function(id) {
        if (devMap2[id] == null) {
          missing.push(id);
        }
      });
      ids2.forEach(function(id) {
        if (devMap1[id] == null) {
          extra.push(id);
        }
      });

      var mismatches = [];
      ids1.forEach(function(id) {
        var d1 = devMap1[id];
        var d2 = devMap2[id];
        if (d2 == null) {
          return;
        }
        if (d1.type != d2.type) {
          mismatches.push({ id : id, type : 'type',
            value1 : d1.type, value2 : d2.type });
        }
        var attrs = {};
        Object.keys(d1).forEach(function(k) { attrs[k] = true; });
        Object.keys(d2).forEach(function(k) { attrs[k] = true; });
        Object.keys(attrs).forEach(function(k) {
          if (k == 'id' || options.omitAttributes.indexOf(k) >= 0) {
            return;
          }
          if (!deepEqual(d1[k], d2[k]) ) {
            mismatches.push({ id : id, type : 'attribute',
              attribute : k, value1 : d1[k], value2 : d2[k] });
          }
        });
      });

      var buildConnectionCounts = function(devMap, schema) {
        var counts = {};
        (schema.connectors || []).forEach(function(conn) {
          var key = connectionKey(options, devMap, conn);
          counts[key] = (counts[key] || 0) + 1;
        });
        return counts;
      };

      var counts1 = buildConnectionCounts(devMap1, schema1);
      var counts2 = buildConnectionCounts(devMap2, schema2);

      var allKeys = {};
      Object.keys(counts1).forEach(function(k) { allKeys[k] = true; });
      Object.keys(counts2).forEach(function(k) { allKeys[k] = true; });

      var connMissing = [];
      var connExtra = [];
      Object.keys(allKeys).sort().forEach(function(key) {
        var c1 = counts1[key] || 0;
        var c2 = counts2[key] || 0;
        if (c1 != c2) {
          (c1 > c2? connMissing : connExtra).push(
              { connection : key, count1 : c1, count2 : c2 });
        }
      });

      var equal = missing.length == 0 && extra.length == 0 &&
          mismatches.length == 0 && connMissing.length == 0 &&
          connExtra.length == 0;

      return {
        equal : equal,
        devices : {
          missing : missing,
          extra : extra,
          mismatches : mismatches
        },
        connections : {
          missing : connMissing,
          extra : connExtra
        }
      };
    }
  }

  $s.SchemaComparatorOptions = SchemaComparatorOptions;
  $s.SchemaComparator = SchemaComparator;

}(simcir);
