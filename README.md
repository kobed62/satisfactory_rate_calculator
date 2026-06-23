# Satisfactory Rate Calculator

A Python command line planner for Satisfactory production chains.

Give it an item and a target rate in items per minute, and it calculates the recipes, buildings, intermediate item rates, and raw resources needed to make it. The output is styled like a terminal factory breakdown, with rounded-up displayed building counts so you know how many Smelters, Constructors, Assemblers, Manufacturers, and so on to build.

## Disclaimer

This is an unofficial fan-made Satisfactory factory planning tool.

Satisfactory and all related game assets, trademarks, names, icons, and
artwork are the property of Coffee Stain Studios.

This project is not affiliated with or endorsed by Coffee Stain Studios.

## Current Features

- Parses Satisfactory item, recipe, and building JSON data from `data/`.
- Expands dependency trees for craftable items.
- Detects raw resources such as Iron Ore, Copper Ore, Coal, Limestone, Crude Oil, Water, and similar base inputs.
- Calculates recursive factory requirements for a target item/minute rate.
- Supports default recipes and custom alternate recipe choices.
- Avoids cyclic default recipe paths when the data contains conversion recipes that can feed back into each other.
- Shows terminal-colored output with:
  - magenta target rates
  - red rounded-up building counts
  - cyan ingredient rates
  - green per-building input rates

## Requirements

- Python 3.10 or newer
- No third-party packages are currently required.

## How To Run

Open a terminal in the project root:

```bash
cd "path_to_project"
```

Run the program with:

```bash
python main.py
```

With no arguments, it prints the dependency tree for `Computer`.

## Visual App

Run the local visual planner with:

```bash
python app.py
```

Then open:

```text
http://127.0.0.1:8000
```

The visual app includes:

- item search/autocomplete
- target rate input
- default/custom recipe strategy
- custom recipe choice controls
- resizable left and right panels
- draggable graph nodes
- recipe drawer opened by clicking production nodes
- recipe cards with inputs, outputs, building, duration, and default/alternate badges
- machine summary
- raw resource summary
- selected recipe summary
- icon-based graph view

The app uses Python's built-in HTTP server, so no extra package install is needed.

Visual API endpoints:

```text
GET  /
GET  /api/items
GET  /api/recipes?item=Iron%20Ingot
POST /api/calculate
```

Example API body:

```json
{
  "item": "Wire",
  "rate": 120,
  "strategy": "default",
  "recipe_choices": {}
}
```

## Main Usage

Calculate a full recursive factory plan:

```bash
python main.py "Wire" --rate 120
```

Example output shape:

```text
========================================================================
Total_Buildings: 6
> 4 Constructors
> 2 Smelters
========================================================================
Copper_Ingot: 60/min -> 2 Smelters
> Copper_Ore: 60/min => 30/min/Smelter
========================================================================
Wire: 120/min -> 4 Constructors
> Copper_Ingot: 60/min => 15/min/Constructor
========================================================================
Copper_Ore: 60/min -> raw_resource
```

Displayed building counts are rounded up. For example, if the exact calculation needs `8.3333` Assemblers, the CLI displays `9 Assemblers`.

The solver still keeps exact fractional values internally for calculations.

The summary at the top shows the rounded total number of buildings to place, grouped by building type.

## Arguments

### `item`

The item to inspect or calculate.

```bash
python main.py "Heavy Modular Frame"
```

If no item is provided, the default is `Computer`.

Item names are case-insensitive and forgiving about singular/plural in many cases, so `screw`, `Screw`, or `SCREW` can resolve to the data item `Screws`.

### `--rate RATE`

Calculate the full recursive factory for the requested item/minute rate.

```bash
python main.py "Heavy Modular Frame" --rate 10
```

This prints every production step, rounded-up building counts, ingredient rates, and raw resources.

Repeated production steps are grouped together. For example, if several branches need Iron Ingots, the output shows one combined `Iron_Ingot` block instead of separate Iron Ingot blocks for each branch.

### `--json`

Use with `--rate` to print graph-ready JSON for the future visual UI.

```bash
python main.py "Wire" --rate 120 --json
```

The JSON contains:

- `nodes`
- `edges`
- icon paths
- machine totals
- raw resource totals
- selected recipes
- missing icons for the displayed graph

### `--direct`

Use with `--rate` to calculate only the direct recipe for the target item, without recursively expanding ingredients.

```bash
python main.py "Iron Plate" --rate 100 --direct
```

This is useful for quick recipe-level checks.

### `--recipe`

Print recipe details for the selected item.

```bash
python main.py "Iron Plate" --recipe
```

With custom recipe choices:

```bash
python main.py "Screw" --recipe --use "Screw=Cast Screw"
```

### `--list-recipes`

List all known recipes for an item, including alternate recipes.

```bash
python main.py "Iron Ingot" --list-recipes
```

This is the easiest way to find the exact recipe names available in the data.

### `--missing-icons`

Print planner items that do not currently have a matching icon in `data/item_icons`.

```bash
python main.py --missing-icons
```

### `--strategy default`

Use the default non-alternate recipe for every item.

```bash
python main.py "Computer" --rate 10 --strategy default
```

This is the default behavior, so you usually do not need to type it.

### `--strategy custom`

Use custom recipe choices where provided and default recipes everywhere else.

```bash
python main.py "Heavy Modular Frame" --rate 10 --strategy custom --use "Screw=Cast Screw"
```

If you pass `--use`, the program automatically switches to custom strategy even if `--strategy custom` is omitted.

### `--use "ITEM=RECIPE"`

Choose a specific recipe for an item. This argument can be repeated.

```bash
python main.py "Heavy Modular Frame" --rate 10 --use "Heavy Modular Frame=Heavy Encased Frame" --use "Screw=Cast Screw"
```

More examples:

```bash
python main.py "Iron Ingot" --recipe --use "Iron Ingot=Pure Iron Ingot"
python main.py "Heavy Modular Frame" --rate 10 --use "Screw=Cast Screw"
```

Recipe names are also forgiving about singular/plural, so `Cast Screw` can match the data recipe `Cast Screws`.

## Common Examples

Dependency tree only:

```bash
python main.py "Computer"
```

Full factory plan:

```bash
python main.py "Computer" --rate 20
```

List alternate recipes:

```bash
python main.py "Screws" --list-recipes
```

Use an alternate recipe:

```bash
python main.py "Screws" --rate 120 --use "Screw=Cast Screw"
```

Use several alternate recipes:

```bash
python main.py "Heavy Modular Frame" --rate 10 --use "Heavy Modular Frame=Heavy Encased Frame" --use "Screw=Cast Screw"
```

## Project Layout

```text
data/
  buildings.json
  items.json
  recipes.json

src/
  data_parser.py
  solver.py

main.py
plan.md
README.md
```

## Notes

- Raw resources are displayed as `raw_resource` because they are mined, pumped, or extracted rather than produced in a crafting building.
- The terminal output uses ANSI colors. Most modern terminals support this automatically.
- The roadmap in `plan.md` describes future work such as optimization, power calculation, and a UI.
