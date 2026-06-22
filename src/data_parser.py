import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "data"

PRODUCTION_BUILDINGS = {
    "Smelter",
    "Foundry",
    "Constructor",
    "Assembler",
    "Manufacturer",
    "Refinery",
    "Blender",
    "Packager",
    "Particle Accelerator",
    "Converter",
    "Quantum Encoder",
}


@dataclass(frozen=True)
class Item:
    class_name: str
    name: str
    form: str
    sink_points: int


@dataclass(frozen=True)
class Building:
    class_name: str
    name: str
    power_usage: float


@dataclass(frozen=True)
class Recipe:
    class_name: str
    name: str
    duration: float
    ingredients: dict[str, float]
    products: dict[str, float]
    building: str | None
    alternate: bool


def load_data(data_dir: Path | str = DATA_DIR) -> tuple[dict[str, Item], dict[str, list[Recipe]], dict[str, Building]]:
    data_path = Path(data_dir)
    items_by_class = parse_items(data_path / "items.json")
    buildings_by_class = parse_buildings(data_path / "buildings.json")
    recipes_by_product = parse_recipes(
        data_path / "recipes.json",
        items_by_class=items_by_class,
        buildings_by_class=buildings_by_class,
    )

    return items_by_class, recipes_by_product, buildings_by_class


def parse_items(path: Path | str) -> dict[str, Item]:
    raw_items = _load_json(path)
    items_by_class: dict[str, Item] = {}

    for entry in _iter_entries(raw_items):
        class_name = entry["className"]
        items_by_class[class_name] = Item(
            class_name=class_name,
            name=entry["name"],
            form=entry.get("form", ""),
            sink_points=int(entry.get("sinkPoints") or 0),
        )

    return items_by_class


def parse_buildings(path: Path | str) -> dict[str, Building]:
    raw_buildings = _load_json(path)
    buildings_by_class: dict[str, Building] = {}

    for entry in _iter_entries(raw_buildings):
        name = entry["name"]
        if name not in PRODUCTION_BUILDINGS:
            continue

        class_name = entry["className"]
        buildings_by_class[class_name] = Building(
            class_name=class_name,
            name=name,
            power_usage=float(entry.get("powerUsage") or 0),
        )

    return buildings_by_class


def parse_recipes(
    path: Path | str,
    *,
    items_by_class: dict[str, Item],
    buildings_by_class: dict[str, Building],
) -> dict[str, list[Recipe]]:
    raw_recipes = _load_json(path)
    recipes_by_product: dict[str, list[Recipe]] = {}

    for entry in _iter_entries(raw_recipes):
        building = _first_production_building(entry.get("producedIn", []), buildings_by_class)
        if building is None:
            continue

        recipe = Recipe(
            class_name=entry["className"],
            name=entry["name"],
            duration=float(entry["duration"]),
            ingredients=_parse_amounts(entry.get("ingredients", []), items_by_class),
            products=_parse_amounts(entry.get("products", []), items_by_class),
            building=building.name,
            alternate=bool(entry.get("alternate", False)),
        )

        for product_name in recipe.products:
            recipes_by_product.setdefault(product_name, []).append(recipe)

    return recipes_by_product


def _load_json(path: Path | str) -> dict[str, list[dict[str, Any]]]:
    with Path(path).open(encoding="utf-8") as data_file:
        return json.load(data_file)


def _iter_entries(raw_data: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for entry_list in raw_data.values():
        entries.extend(entry_list)
    return entries


def _parse_amounts(entries: list[dict[str, Any]], items_by_class: dict[str, Item]) -> dict[str, float]:
    amounts: dict[str, float] = {}
    for entry in entries:
        item = items_by_class.get(entry["item"])
        if item is None:
            continue
        amounts[item.name] = float(entry["amount"])
    return amounts


def _first_production_building(
    building_classes: list[str],
    buildings_by_class: dict[str, Building],
) -> Building | None:
    for class_name in building_classes:
        building = buildings_by_class.get(class_name)
        if building is not None:
            return building
    return None
