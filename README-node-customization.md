# Node Customization for SimcirJS

This document explains how to customize node appearance in SimcirJS using the new portRadius, rectanglePadding and portPadding options.

## Overview

SimcirJS now supports customizable nodes with configurable port circle radius, rectangle padding and port offset. This allows you to create nodes with different visual styles to match your circuit design needs.

## Customizing Node Radius and Padding

### Basic Customization

Add `portRadius`, `rectanglePadding` and/or `portPadding` properties to your device definitions:

```javascript
{
  "type": "NAND",
  "label": "Custom Device",
  "portRadius": 6,        // Circle radius for port connections (default: 4)
  "rectanglePadding": 2,  // Space between ports and the device drawing (default: 0)
  "portPadding": 3        // Move ports inward from the device edges (default: 0)
}
```

### Configuration Options

- **portRadius**: Size of the circular port indicator (px). Range typically 2-10
- **rectanglePadding**: Extra space between the ports and the device drawing (px). Range typically 0-5
- **portPadding**: Distance to move the input/output ports inward from the device edges (px). Range typically 0-5

### How the parameters interact

- Ports are centered on the device edges by default.
- `portRadius` changes the port circle size. When only `portRadius` is set, the device is widened so the space between the port circle and the device drawing stays the same as the default (i.e. an implicit `rectanglePadding` of `portRadius - 4` is used).
- `rectanglePadding` widens the device by `2 * rectanglePadding`, adding space between the ports and the device drawing.
- `portPadding` moves the input ports right and the output ports left by the given distance.
- When both `rectanglePadding` and `portRadius` are set, `rectanglePadding` is used as-is.

### Schema-Level Defaults

All three options can also be set on the schema itself. Every device that does
not specify a value for an option inherits the schema-level value:

```javascript
{
  "width": 400,
  "height": 200,
  "portRadius": 6,        // schema default for all devices
  "rectanglePadding": 2,  // schema default for all devices
  "portPadding": 1,       // schema default for all devices
  "devices": [
    {"type":"NAND","id":"dev0","x":64,"y":96,"label":"Inherited"},
    {"type":"AND","id":"dev1","x":160,"y":96,"label":"Overridden",
     "portRadius":4,"rectanglePadding":0,"portPadding":0}
  ]
}
```

- Device-level values always take precedence over schema-level defaults.
- The built-in defaults are `portRadius: 4`, `rectanglePadding: 0`, `portPadding: 0`.
- When a device sets only `portRadius`, the derived `rectanglePadding` is
  computed relative to the schema defaults (`portRadius - defaultPortRadius + defaultRectanglePadding`),
  so the space between the port circle and the device drawing stays at the
  schema's default gap.
- Toolbox previews and drag previews inherit the schema defaults too, so they
  match the device once dropped.


### Live Demo

To test customized nodes, modify your circuit JSON:

```javascript
{
  "devices": [
    {"type":"NAND","id":"dev0","x":80,"y":128,"label":"Big Port","portRadius":8},
    {"type":"AND","id":"dev1","x":192,"y":88,"label":"Label Padding","rectanglePadding":4},
    {"type":"XOR","id":"dev2","x":304,"y":128,"label":"Inset Ports","portPadding":3},
    {"type":"LED","id":"dev3","x":80,"y":216,"label":"Both Custom","portRadius":5,"rectanglePadding":3}
  ]
}
```

## How It Works

The customization is applied in the node rendering:

1. **Port Circle**: The circular indicator on input/output nodes uses `portRadius` for its radius
2. **Port Placement**: Input/output ports are centered on the device edges, optionally shifted inward by `portPadding`
3. **Device Size**: The device body is widened by `2 * rectanglePadding`, keeping the space between the ports and the device drawing configurable
4. **Label Positioning**: Labels are offset from the ports using `rectanglePadding`
5. **Backward Compatibility**: Default values match original behavior (portRadius: 4, rectanglePadding: 0, portPadding: 0)

## Backend Support

These properties are passed through in the device definition:
- Port nodes automatically receive the customization
- All device types that use nodes (input, output, logic gates, etc.) support these properties
- Properties are inherited across nested devices and library references

## CSS Considerations

While the core rendering is handled by JavaScript, you can also enhance styling with CSS:

```css
/* Larger port circles */
.simcir-node circle {
  r: 6px;
}

/* Custom label spacing */
.simcir-node-label {
  margin-left: 2px;
  margin-right: 2px;
}
```

## Advanced Customization

You can create device-specific factories in the basicset to apply consistent styling:

```javascript
var createCustomLogicGateFactory = function(op, out, draw) {
  return function(device) {
    // Custom device creation
    // Apply portRadius and rectanglePadding defaults
    // based on device type or configuration
  };
};
```

## Testing

To verify your customizations:
1. Modify device definitions with new values
2. Test both large and small radius values
3. Ensure label visibility with different padding
4. Check connections work with varying port sizes

## Changelog

v2.x.x: Added node customization options (portRadius, rectanglePadding)