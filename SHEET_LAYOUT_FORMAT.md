# Custom storyboard sheet formats

Open Settings → Storyboard → Storyboard sheet layouts. The two built-in formats remain available. Add a `.json` or `.sslayout` definition to install another format; its preview shows the cutting rectangles and reading order. The setting is shared across this app's projects. Removing a definition does not change drawings already imported.

Normal image import automatically detects installed formats. There is no format chooser during image import, and print layouts are unchanged. Detection requires the page proportions and consistent visible frame borders; unrelated drawings remain single images. As with built-in sheets, empty panels are skipped.

When you provide a new sheet, its definition can be made from these measurements:

```json
{
  "format": "storyboard-studio-sheet-layout",
  "schemaVersion": 1,
  "id": "custom-my-two-panels",
  "name": "My two-panel sheet",
  "page": { "width": 1000, "height": 1000 },
  "cards": [
    { "x": 50, "y": 50, "width": 900, "height": 400 },
    { "x": 50, "y": 550, "width": 900, "height": 400 }
  ],
  "cropInset": 5
}
```

Coordinates use pixels in the reference page, measured from its top-left corner. Images at proportional sizes also work. `cards` is in the desired reading order, independent of geometric ordering. `cropInset` removes the frame border on each side. IDs must start with `custom-`, be unique, and contain only letters, digits, underscores or hyphens. Files may contain 1–100 non-overlapping, in-bounds rectangles and must be smaller than 256 KB. Revised definitions use the same ID after the previous definition is removed.
