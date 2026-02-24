# Maidenhead Grid Overlay Plugin

A plugin for OpenHamClock that displays IARU Maidenhead Grid Locator overlay on the map.

## Features

- **Multiple Precision Levels**: Display Fields (2 char), Squares (4 char), Sub-squares (6 char), or Extended (8 char)
- **Adaptive Zoom Scaling**: Grid detail automatically adjusts based on zoom level
- **Canvas Rendering**: High-performance drawing that redraws smoothly on pan/zoom
- **Opacity Control**: Built-in integration with OpenHamClock's layer opacity slider
- **Custom Control Panel**: Interactive UI for precision and label settings
- **Persistent Settings**: User preferences saved to localStorage

## Installation

The plugin is automatically registered when added to the OpenHamClock layer registry.

### Manual Registration

If not using the layer registry, you can import and use the plugin directly:

```javascript
import MaidenheadGrid, { 
  latLonToMaidenhead, 
  maidenheadToBounds,
  GRID_PRECISIONS 
} from './plugins/layers/useMaidenheadGrid.js';
```

## Usage

### Enabling the Layer

1. Open the OpenHamClock Settings panel
2. Navigate to Map Layers or Overlays section
3. Find "Maidenhead Grid" and toggle it on
4. Use the opacity slider to adjust transparency

### Control Panel

When enabled, a control panel appears in the top-right corner of the map:

- **Grid Precision Dropdown**: Select desired grid precision
  - Fields (AB): 20° × 10° grid
  - Squares (AB12): 2° × 1° grid
  - Sub-sq (AB12cd): 5' × 2.5' grid
  - Extended (AB12cd34): 30" × 15" grid
- **Show Labels Checkbox**: Toggle grid identifier labels on/off

The control panel is draggable and its position persists in localStorage.

## API Reference

### Functions

#### `latLonToMaidenhead(lat, lon, precision)`

Converts latitude/longitude to Maidenhead grid square.

**Parameters:**
- `lat` (number): Latitude in degrees (-90 to 90)
- `lon` (number): Longitude in degrees (-180 to 180)
- `precision` (number): Character precision (2, 4, 6, or 8)

**Returns:** string - Maidenhead grid square

**Example:**
```javascript
const grid = latLonToMaidenhead(40.7128, -74.006, 4);
// Returns: "FN31"
```

#### `maidenheadToBounds(grid)`

Calculates the bounding box for a Maidenhead grid square.

**Parameters:**
- `grid` (string): Maidenhead grid square (2-8 characters)

**Returns:** object - `{minLat, maxLat, minLon, maxLon}` or `null` if invalid

**Example:**
```javascript
const bounds = maidenheadToBounds('FN31');
// Returns: { minLat: 41, maxLat: 42, minLon: -74, maxLon: -72 }
```

#### `getGridLevelsForZoom(zoom)`

Determines which grid levels to display based on map zoom.

**Parameters:**
- `zoom` (number): Leaflet zoom level (0-18)

**Returns:** object - `{fields, squares, subSquares, extended, labels}`

**Example:**
```javascript
const levels = getGridLevelsForZoom(5);
// Returns: { fields: true, squares: true, subSquares: false, extended: false, labels: true }
```

#### `calculateGridForBounds(bounds, precision)`

Calculates grid lines and labels for the visible map area.

**Parameters:**
- `bounds` (object): `{south, north, west, east}`
- `precision` (number): Grid precision level

**Returns:** object - `{lines: [], labels: []}`

### Constants

```javascript
import { GRID_PRECISIONS } from './useMaidenheadGrid.js';

GRID_PRECISIONS.FIELDS      // 2
GRID_PRECISIONS.SQUARES     // 4
GRID_PRECISIONS.SUB_SQUARES // 6
GRID_PRECISIONS.EXTENDED    // 8
```

## Example: Programmatic Control

### Initializing with Custom Settings

```javascript
import { useMaidenheadGrid } from './plugins/layers/useMaidenheadGrid.js';

// Set default precision before layer loads
localStorage.setItem('maidenhead-grid-precision', '6');
localStorage.setItem('maidenhead-grid-labels', 'true');
```

### Accessing Grid Info for Your Location

```javascript
import { latLonToMaidenhead } from './plugins/layers/useMaidenheadGrid.js';

// Get grid square for a location
const myGrid = latLonToMaidenhead(40.7128, -74.006, 6);
console.log(`My grid: ${myGrid}`); // "FN31pv"
```

## Security Considerations

This plugin follows OpenHamClock security guidelines:

1. **No External Data**: All grid calculations are performed locally
2. **Input Validation**: Coordinates are validated and clamped to valid ranges
3. **Canvas Rendering**: Uses HTML5 Canvas API, preventing DOM-based injection
4. **No User Content**: Grid labels are computed, not user-provided
5. **Sanitized Display**: Grid identifiers are validated before rendering

## Grid System Reference

The IARU Maidenhead Grid Locator system divides the world into:

| Level | Characters | Size | Example |
|-------|------------|------|---------|
| Field | 2 | 20° × 10° | FN |
| Square | 4 | 2° × 1° | FN31 |
| Sub-square | 6 | 5' × 2.5' | FN31pv |
| Extended | 8 | 30" × 15" | FN31pv44 |

Reference: https://www.tvcomm.co.uk/g7izu/the-iaru-maidenhead-grid-locator-system/

## Performance Notes

- The canvas layer only draws what's visible in the viewport
- Grid detail automatically reduces at low zoom levels to maintain performance
- Labels are filtered to avoid overcrowding
- Uses `requestAnimationFrame` for smooth rendering

## Troubleshooting

### Layer not appearing?
- Ensure the layer is enabled in Settings
- Check browser console for errors
- Verify map is initialized before layer loads

### Performance issues?
- Reduce grid precision at low zoom levels
- Disable labels for large viewports
- Use the opacity slider to check for rendering issues

### Grid lines don't align with other maps?
- The plugin uses standard IARU Maidenhead calculations
- Some maps may use slightly different reference points

## Version History

- **1.0.0**: Initial release
  - Canvas-based rendering
  - Support for all precision levels
  - Adaptive zoom scaling
  - Custom control panel
