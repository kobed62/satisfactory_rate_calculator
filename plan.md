# Satisfactory Visual Factory Planner - Roadmap

## New Goal

Build a visual factory-planning app inspired by the Satisfactory Modeler experience:

> Choose an item and target rate, then see the whole factory as an interactive visual graph with item icons, machines, belts/pipes, recipe choices, and resource totals.

The existing command-line calculator is now the calculation engine. The next big step is to put a visual interface on top of it.

---

## Current Foundation

Already built:

- JSON parser for `items.json`, `recipes.json`, and `buildings.json`
- recursive production solver
- default and custom alternate recipe support
- cycle-safe recipe selection for conversion recipes
- grouped CLI output
- rounded-up displayed building counts
- item icon filtering/flattening helper
- `data/item_icons/` icon directory

The solver should remain usable from the CLI while the visual layer grows around it.

---

# Phase 1 - Visual Data Layer

## Goal

Connect solver items to icon files and prepare graph-friendly output.

## Task 1.1 - Icon Index

Create an icon lookup module:

```python
get_icon_path("Iron Plate")
get_icon_path("Copper Ore")
get_icon_path("Dark Matter Residue")
```

Support aliases where icon filenames do not match item names exactly:

```text
Iron Ore -> IconDesc_iron_new_256.png
Copper Ore -> IconDesc_copper_new_256.png
Limestone -> Stone_256.png
SAM -> IconDesc_SameOre_256.png
Crude Oil -> Oil_256.png
Dark Matter Residue -> IconDesc_DarkEnergy_256.png
```

## Task 1.2 - Missing Icon Report

Add a script or command that reports missing icons for all items used by the solver.

## Task 1.3 - Graph Data Export

Add a solver method:

```python
planner.visual_graph(item="Computer", rate=10)
```

Output should contain:

```python
{
    "nodes": [],
    "edges": [],
    "machines": {},
    "resources": {},
    "selected_recipes": {}
}
```

Each node should include:

```python
id
label
type  # item, machine, resource
rate
icon
building
recipe
machine_count
```

Each edge should include:

```python
source
target
item
rate
transport_type  # belt, pipe, gas/resource
```

## Milestone 1

Running:

```bash
python main.py "Wire" --rate 120 --json
```

returns graph-ready JSON with icon paths.

---

# Phase 2 - First Visual App

## Goal

Create the first usable visual interface.

## Recommended Stack

Use a local web app:

```text
FastAPI or Flask for Python backend
HTML/CSS/JavaScript frontend
Cytoscape.js or React Flow for graph rendering
```

Recommended simplest path:

```text
FastAPI + static HTML + Cytoscape.js
```

This keeps Python as the calculation engine and avoids rewriting the solver in JavaScript.

## Task 2.1 - Backend API

Create:

```text
GET /
GET /api/items
GET /api/recipes?item=Iron%20Ingot
POST /api/calculate
```

Example request:

```json
{
  "item": "Heavy Modular Frame",
  "rate": 10,
  "strategy": "custom",
  "recipe_choices": {
    "Screw": "Cast Screw"
  }
}
```

## Task 2.2 - Basic UI

First screen should be the app, not a landing page.

Controls:

- item search/autocomplete
- target rate input
- calculate button
- recipe strategy selector
- custom recipe selectors

Views:

- visual graph
- machine summary
- raw resource summary
- selected recipes

## Task 2.3 - Icon Rendering

Show item icons in graph nodes.

Machine nodes can initially use text labels:

```text
Constructor
Assembler
Manufacturer
Refinery
```

## Milestone 2

User can run:

```bash
python app.py
```

Open the browser and calculate `Wire = 120/min` as a visual graph.

---

# Phase 3 - Satisfactory-Style Graph Layout

## Goal

Make the graph readable and similar in spirit to Satisfactory Modeler.

## Task 3.1 - Layered Layout

Arrange graph left-to-right:

```text
Raw Resources -> Intermediate Items -> Final Product
```

or bottom-to-top:

```text
Raw Resources
Intermediate Products
Final Product
```

## Task 3.2 - Node Design

Item node:

- item icon
- item name
- rate per minute

Production node:

- building type
- rounded-up building count
- recipe name

Resource node:

- raw resource icon
- required rate

## Task 3.3 - Edge Design

Edges should show:

```text
item/min
```

Use different styling for:

- belts
- pipes/liquids
- gas

## Task 3.4 - Grouped Production

Use the grouped display logic from the CLI:

```text
one Iron Ingot node
one Steel Ingot node
one Copper Ingot node
```

instead of repeated duplicate branches.

## Milestone 3

`Heavy Modular Frame = 10/min` renders as a clean grouped graph with icons, machine counts, and readable connections.

---

# Phase 4 - Recipe Selection UI

## Goal

Let the user choose alternate recipes visually.

## Task 4.1 - Recipe Drawer

Clicking an item opens a panel showing all recipes for that item.

Each recipe card shows:

- recipe name
- building
- duration
- inputs
- outputs
- alternate/default badge

## Task 4.2 - Apply Recipe Choices

When the user selects an alternate recipe:

```python
recipe_choices[item] = recipe_name
```

Then recalculate the graph.

## Task 4.3 - Selected Recipe Summary

Show active recipe choices in a side panel.

## Milestone 4

User can visually choose:

```text
Cast Screws
Pure Iron Ingot
Heavy Encased Frame
```

and the graph updates.

---

# Phase 5 - Better Factory Metrics

## Goal

Make the visual planner useful for actual factory building.

## Task 5.1 - Belt/Pipe Requirements

Estimate transport line requirements:

```text
Mk.1 belt: 60/min
Mk.2 belt: 120/min
Mk.3 belt: 270/min
Mk.4 belt: 480/min
Mk.5 belt: 780/min
Mk.6 belt: 1200/min
Pipe Mk.1: 300/min
Pipe Mk.2: 600/min
```

## Task 5.2 - Power Usage

Use building power data:

```python
machine_count * power_usage
```

Show total MW and per-building breakdown.

## Task 5.3 - Overclocking

Allow:

```text
50%
100%
250%
```

or a custom clock speed.

## Milestone 5

Graph shows:

- machine totals
- resource totals
- power usage
- belt/pipe hints

---

# Phase 6 - Save, Load, and Export

## Goal

Make plans reusable and shareable.

## Task 6.1 - Save Plan JSON

Store:

```python
item
rate
strategy
recipe_choices
clock_settings
```

## Task 6.2 - Load Plan JSON

Reload previous factory plans.

## Task 6.3 - Export Image

Export the graph as:

```text
PNG
SVG
```

## Milestone 6

User can save a Heavy Modular Frame plan, reopen it, and export the visual graph.

---

# Phase 7 - Polish Toward Satisfactory Modeler Feel

## Goal

Make the app feel clean, game-like, and satisfying to use.

## Visual Direction

- dark industrial background
- orange/yellow Satisfactory-style highlights
- item icons as first-class visual elements
- clear machine blocks
- readable edge labels
- compact side panels
- no marketing page

## Task 7.1 - Search Experience

Fast item search with keyboard navigation.

## Task 7.2 - Zoom and Pan

Graph canvas supports:

- zoom
- pan
- fit to screen
- reset layout

## Task 7.3 - Node Details

Click a node to inspect:

- recipe
- inputs
- outputs
- machines
- power
- icon

## Task 7.4 - Error States

Friendly messages for:

- unknown item
- no recipe found
- missing icon
- recipe cycle with no safe alternative

## Milestone 7

The app is pleasant to use for large recipes like:

```text
Singularity Cell
Turbo Motor
Ballistic Warp Drive
```

---

# Recommended Build Order

```text
1. Icon lookup and graph JSON export
2. Minimal web backend
3. First Cytoscape.js or React Flow graph
4. Satisfactory-style node design
5. Recipe selection UI
6. Power and belt/pipe metrics
7. Save/load/export
8. Polish and large-factory usability
```

---

# Definition of Done

The visual planner is successful when this workflow feels good:

```text
1. Open app
2. Search "Singularity Cell"
3. Enter 10/min
4. See a clean visual graph
5. Inspect machines and raw resources
6. Choose alternate recipes
7. Watch graph update
8. Export or save the plan
```

Final target:

```python
planner.visual_graph(
    item="Turbo Motor",
    rate=20,
    strategy="custom",
    recipe_choices={
        "Screw": "Cast Screws",
        "Iron Ingot": "Pure Iron Ingot"
    }
)
```

returns complete graph data that the UI can render with icons, grouped machines, rates, raw resources, recipe choices, and power/belt hints.
