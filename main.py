import argparse
import json
from math import ceil
from pprint import pprint

from src.solver import planner


RESET = "\033[0m"
CYAN = "\033[96m"
MAGENTA = "\033[95m"
RED = "\033[91m"
GREEN = "\033[92m"
WHITE = "\033[97m"
SEPARATOR = "=" * 72


def main() -> None:
    parser = argparse.ArgumentParser(description="Satisfactory production planner")
    parser.add_argument("item", nargs="?", default="Computer", help="item name to expand")
    parser.add_argument("--recipe", action="store_true", help="print the default recipe for the item")
    parser.add_argument("--list-recipes", action="store_true", help="list available recipes for the item")
    parser.add_argument("--missing-icons", action="store_true", help="print planner items missing icon files")
    parser.add_argument("--rate", type=float, help="calculate recursive production needs for an item/minute rate")
    parser.add_argument("--json", action="store_true", help="with --rate, print graph-ready JSON")
    parser.add_argument("--direct", action="store_true", help="with --rate, only calculate the direct recipe")
    parser.add_argument(
        "--strategy",
        choices=["default", "custom"],
        default="default",
        help="recipe selection strategy",
    )
    parser.add_argument(
        "--use",
        action="append",
        default=[],
        metavar="ITEM=RECIPE",
        help="custom recipe choice; can be used multiple times",
    )
    args = parser.parse_args()
    recipe_choices = _parse_recipe_choices(args.use)

    if recipe_choices and args.strategy == "default":
        args.strategy = "custom"

    if args.list_recipes:
        pprint(planner.list_recipes(args.item))
        return

    if args.missing_icons:
        for item_name in planner.missing_icons():
            print(item_name)
        return

    if args.rate is not None:
        if args.direct:
            pprint(
                planner.calculate_direct(
                    item=args.item,
                    rate=args.rate,
                    strategy=args.strategy,
                    recipe_choices=recipe_choices,
                )
            )
            return

        if args.json:
            print(
                json.dumps(
                    planner.visual_graph(
                        item=args.item,
                        rate=args.rate,
                        strategy=args.strategy,
                        recipe_choices=recipe_choices,
                    ),
                    indent=2,
                )
            )
            return

        _print_factory_plan(
            planner.calculate(
                item=args.item,
                rate=args.rate,
                strategy=args.strategy,
                recipe_choices=recipe_choices,
            )
        )
        return

    if args.recipe:
        pprint(
            planner.get_recipe_details(
                args.item,
                strategy=args.strategy,
                recipe_choices=recipe_choices,
            )
        )
        return

    print(
        planner.format_dependency_tree(
            args.item,
            strategy=args.strategy,
            recipe_choices=recipe_choices,
        )
    )


def _print_factory_plan(result: dict[str, object]) -> None:
    tree = result.get("tree")
    if not isinstance(tree, dict):
        _print_section("Machines", result["machines"])
        return

    production_steps = _group_production_steps(tree)
    _print_building_summary(production_steps)

    for step in production_steps:
        _print_machine_block(step)

    resources = result.get("resources")
    if isinstance(resources, dict) and resources:
        for resource_name, rate in resources.items():
            print(_color(SEPARATOR, WHITE))
            print(
                f"{_item_label(resource_name)}: "
                f"{_color(_rate_label(rate), MAGENTA)} -> "
                f"{_color('raw_resource', RED)}"
            )

    selected_recipes = result.get("selected_recipes")
    if result.get("strategy") == "custom" and isinstance(selected_recipes, dict) and selected_recipes:
        print(_color(SEPARATOR, WHITE))
        print(_color("Selected_Recipes", CYAN))
        for item_name, recipe_name in selected_recipes.items():
            print(f"> {_item_label(item_name)}: {_color(recipe_name.replace(' ', '_'), GREEN)}")


def _print_building_summary(production_steps: list[dict[str, object]]) -> None:
    if not production_steps:
        return

    rounded_counts: dict[str, int] = {}
    for step in production_steps:
        building_name = str(step.get("building") or "Machine")
        machine_count = _display_machine_count(step["machines"])
        rounded_counts[building_name] = rounded_counts.get(building_name, 0) + machine_count

    total_count = sum(rounded_counts.values())

    print(_color(SEPARATOR, WHITE))
    print(f"{_color('Total_Buildings', CYAN)}: {_color(str(total_count), RED)}")
    for building_name, count in rounded_counts.items():
        print(f"> {_color(str(count), RED)} {_building_label(building_name, count)}")


def _production_nodes(tree: dict[str, object]) -> list[dict[str, object]]:
    nodes: list[dict[str, object]] = []
    for child in tree.get("ingredients", []):
        if isinstance(child, dict):
            nodes.extend(_production_nodes(child))

    if not tree.get("is_raw_resource"):
        nodes.append(tree)

    return nodes


def _group_production_steps(tree: dict[str, object]) -> list[dict[str, object]]:
    grouped_steps: dict[tuple[str, str, str], dict[str, object]] = {}
    order: list[tuple[str, str, str]] = []

    for node in _production_nodes(tree):
        item_name = str(node["item"])
        recipe_name = str(node.get("recipe") or item_name)
        building_name = str(node.get("building") or "Machine")
        key = (item_name, recipe_name, building_name)

        if key not in grouped_steps:
            grouped_steps[key] = {
                "item": item_name,
                "recipe": recipe_name,
                "building": building_name,
                "rate": 0.0,
                "machines": 0.0,
                "ingredients": {},
            }
            order.append(key)

        step = grouped_steps[key]
        step["rate"] = float(step["rate"]) + float(node["rate"])
        step["machines"] = float(step["machines"]) + float(node["machines"])

        ingredients = node.get("ingredients", [])
        if not isinstance(ingredients, list):
            continue

        ingredient_totals = step["ingredients"]
        if not isinstance(ingredient_totals, dict):
            continue

        for ingredient in ingredients:
            if not isinstance(ingredient, dict):
                continue
            ingredient_name = str(ingredient["item"])
            ingredient_totals[ingredient_name] = ingredient_totals.get(ingredient_name, 0.0) + float(
                ingredient["rate"]
            )

    return [grouped_steps[key] for key in order]


def _print_machine_block(step: dict[str, object]) -> None:
    item_name = str(step["item"])
    rate = step["rate"]
    machine_count = _display_machine_count(step["machines"])
    building_name = str(step.get("building") or "Machine")
    building_label = _building_label(building_name, machine_count)

    print(_color(SEPARATOR, WHITE))
    print(
        f"{_item_label(item_name)}: {_color(_rate_label(rate), MAGENTA)} -> "
        f"{_color(str(machine_count), RED)} {building_label}"
    )

    ingredients = step.get("ingredients", {})
    if not isinstance(ingredients, dict):
        return

    for ingredient_name, ingredient_rate in ingredients.items():
        per_machine = _number_label(float(ingredient_rate) / machine_count)
        print(
            f"> {_item_label(str(ingredient_name))}: "
            f"{_color(_rate_label(ingredient_rate), CYAN)} => "
            f"{_color(per_machine, GREEN)}/min/{building_name.replace(' ', '_')}"
        )


def _print_section(title: str, values: object, suffix: str = "") -> None:
    print(title)
    print("-" * len(title))
    if not isinstance(values, dict) or not values:
        print("None")
        return

    for name, value in values.items():
        print(f"{name}: {value}{suffix}")


def _display_machine_count(value: object) -> int:
    return max(1, ceil(float(value)))


def _building_label(building_name: str, count: int) -> str:
    label = building_name.replace(" ", "_")
    if count == 1:
        return label
    if label.endswith("y"):
        return f"{label[:-1]}ies"
    if label.endswith("s"):
        return label
    return f"{label}s"


def _item_label(name: str) -> str:
    return _color(name.replace(" ", "_"), WHITE)


def _rate_label(value: object) -> str:
    return f"{_number_label(value)}/min"


def _number_label(value: object) -> str:
    number = float(value)
    if number.is_integer():
        return str(int(number))
    return f"{number:.1f}"


def _color(text: object, color: str) -> str:
    return f"{color}{text}{RESET}"


def _parse_recipe_choices(values: list[str]) -> dict[str, str]:
    choices: dict[str, str] = {}
    for value in values:
        if "=" not in value:
            raise ValueError(f"Invalid --use value {value!r}; expected ITEM=RECIPE")

        item_name, recipe_name = value.split("=", 1)
        item_name = item_name.strip()
        recipe_name = recipe_name.strip()
        if not item_name or not recipe_name:
            raise ValueError(f"Invalid --use value {value!r}; expected ITEM=RECIPE")

        choices[item_name] = recipe_name
    return choices


if __name__ == "__main__":
    main()
