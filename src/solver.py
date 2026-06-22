from math import ceil, isclose
from pathlib import Path

try:
    from .data_parser import DATA_DIR, Recipe, load_data
    from .icon_index import IconIndex
except ImportError:
    from data_parser import DATA_DIR, Recipe, load_data
    from icon_index import IconIndex


RAW_RESOURCE_NAMES = {
    "Iron Ore",
    "Copper Ore",
    "Caterium Ore",
    "Coal",
    "Limestone",
    "Bauxite",
    "Crude Oil",
    "Nitrogen Gas",
    "Raw Quartz",
    "SAM",
    "Sulfur",
    "Uranium",
    "Water",
}

TRANSPORT_CAPACITIES = {
    "belt": [
        ("Mk.1 belt", 60),
        ("Mk.2 belt", 120),
        ("Mk.3 belt", 270),
        ("Mk.4 belt", 480),
        ("Mk.5 belt", 780),
        ("Mk.6 belt", 1200),
    ],
    "pipe": [
        ("Pipe Mk.1", 300),
        ("Pipe Mk.2", 600),
    ],
    "gas": [
        ("Pipe Mk.1", 300),
        ("Pipe Mk.2", 600),
    ],
}

POWER_CLOCK_EXPONENT = 1.321928


class Planner:
    def __init__(self, data_dir: Path | str = DATA_DIR) -> None:
        self.data_dir = Path(data_dir)
        self.items_by_class, self.recipes_by_product, self.buildings_by_class = load_data(data_dir)
        self.items_by_name = {item.name: item for item in self.items_by_class.values()}
        self.raw_resources = {
            item_name for item_name in self.items_by_name if item_name not in self.recipes_by_product
        } | {item_name for item_name in RAW_RESOURCE_NAMES if item_name in self.items_by_name}
        self.dependency_graph = self._build_dependency_graph()
        self.icon_index = IconIndex(self.data_dir / "item_icons")

    def get_recipe(
        self,
        item_name: str,
        *,
        strategy: str = "default",
        recipe_choices: dict[str, str] | None = None,
    ) -> dict[str, object]:
        details = self.get_recipe_details(
            item_name,
            strategy=strategy,
            recipe_choices=recipe_choices,
        )
        return {
            "duration": details["duration"],
            "inputs": details["inputs"],
            "outputs": details["outputs"],
        }

    def get_recipe_details(
        self,
        item_name: str,
        *,
        strategy: str = "default",
        recipe_choices: dict[str, str] | None = None,
    ) -> dict[str, object]:
        item_name = self._resolve_item_name(item_name)
        recipe_choices = self._normalize_recipe_choices(recipe_choices)
        recipe = self._get_recipe(item_name, strategy=strategy, recipe_choices=recipe_choices)
        return {
            "name": recipe.name,
            "duration": _clean_number(recipe.duration),
            "inputs": {name: _clean_number(amount) for name, amount in recipe.ingredients.items()},
            "outputs": {name: _clean_number(amount) for name, amount in recipe.products.items()},
            "building": recipe.building,
            "alternate": recipe.alternate,
        }

    def list_recipes(self, item_name: str) -> list[dict[str, object]]:
        item_name = self._resolve_item_name(item_name)
        return [
            {
                "name": recipe.name,
                "building": recipe.building,
                "alternate": recipe.alternate,
                "duration": _clean_number(recipe.duration),
                "inputs": {name: _clean_number(amount) for name, amount in recipe.ingredients.items()},
                "outputs": {name: _clean_number(amount) for name, amount in recipe.products.items()},
            }
            for recipe in self.recipes_by_product.get(item_name, [])
        ]

    def expand(
        self,
        item_name: str,
        *,
        strategy: str = "default",
        recipe_choices: dict[str, str] | None = None,
    ) -> dict[str, object]:
        item_name = self._resolve_item_name(item_name)
        recipe_choices = self._normalize_recipe_choices(recipe_choices)
        return self._expand(item_name, path=[], strategy=strategy, recipe_choices=recipe_choices)

    def is_raw_resource(self, item_name: str) -> bool:
        item_name = self._resolve_item_name(item_name)
        return item_name in self.raw_resources

    def format_dependency_tree(
        self,
        item_name: str,
        *,
        strategy: str = "default",
        recipe_choices: dict[str, str] | None = None,
    ) -> str:
        item_name = self._resolve_item_name(item_name)
        recipe_choices = self._normalize_recipe_choices(recipe_choices)
        tree = self.expand(item_name, strategy=strategy, recipe_choices=recipe_choices)
        return "\n".join(_format_tree_lines(tree))

    def recipe_output_rate(
        self,
        item_name: str,
        *,
        strategy: str = "default",
        recipe_choices: dict[str, str] | None = None,
    ) -> dict[str, int | float]:
        item_name = self._resolve_item_name(item_name)
        recipe_choices = self._normalize_recipe_choices(recipe_choices)
        recipe = self._get_recipe(item_name, strategy=strategy, recipe_choices=recipe_choices)
        cycles_per_minute = 60 / recipe.duration
        return {
            product_name: _clean_number(amount * cycles_per_minute)
            for product_name, amount in recipe.products.items()
        }

    def recipe_input_rate(
        self,
        item_name: str,
        *,
        strategy: str = "default",
        recipe_choices: dict[str, str] | None = None,
    ) -> dict[str, int | float]:
        item_name = self._resolve_item_name(item_name)
        recipe_choices = self._normalize_recipe_choices(recipe_choices)
        recipe = self._get_recipe(item_name, strategy=strategy, recipe_choices=recipe_choices)
        cycles_per_minute = 60 / recipe.duration
        return {
            ingredient_name: _clean_number(amount * cycles_per_minute)
            for ingredient_name, amount in recipe.ingredients.items()
        }

    def calculate_direct(
        self,
        item: str,
        rate: float,
        *,
        strategy: str = "default",
        recipe_choices: dict[str, str] | None = None,
    ) -> dict[str, int | float]:
        if rate <= 0:
            raise ValueError("rate must be greater than 0")

        item = self._resolve_item_name(item)
        recipe_choices = self._normalize_recipe_choices(recipe_choices)
        recipe = self._get_recipe(item, strategy=strategy, recipe_choices=recipe_choices)
        output_rate = self._recipe_output_rate_for(recipe, item)
        machine_count = rate / output_rate

        result: dict[str, int | float] = {
            _machine_key(recipe.building): _clean_number(machine_count),
        }

        for ingredient_name, amount_per_cycle in recipe.ingredients.items():
            ingredient_rate = amount_per_cycle * (60 / recipe.duration) * machine_count
            result[_item_rate_key(ingredient_name)] = _clean_number(ingredient_rate)

        return result

    def calculate(
        self,
        item: str,
        rate: float,
        *,
        strategy: str = "default",
        recipe_choices: dict[str, str] | None = None,
    ) -> dict[str, object]:
        if rate <= 0:
            raise ValueError("rate must be greater than 0")
        self._validate_strategy(strategy)

        item = self._resolve_item_name(item)
        recipe_choices = self._normalize_recipe_choices(recipe_choices)
        totals: dict[str, dict[str, float]] = {
            "machines": {},
            "resources": {},
            "items": {},
        }
        selected_recipes: dict[str, str] = {}
        production_tree = self._solve(
            item,
            rate,
            totals,
            selected_recipes,
            path=[],
            strategy=strategy,
            recipe_choices=recipe_choices,
        )

        return {
            "item": item,
            "rate": _clean_number(rate),
            "strategy": strategy,
            "selected_recipes": dict(sorted(selected_recipes.items())),
            "machines": _clean_totals(totals["machines"]),
            "resources": _clean_totals(totals["resources"]),
            "items": _clean_totals(totals["items"]),
            "tree": production_tree,
        }

    def get_icon_path(self, item_name: str) -> str | None:
        item_name = self._resolve_item_name(item_name)
        return self.icon_index.get_icon_path(item_name)

    def missing_icons(self) -> list[str]:
        needed_items = set(self.recipes_by_product)
        for recipes in self.recipes_by_product.values():
            for recipe in recipes:
                needed_items.update(recipe.ingredients)
                needed_items.update(recipe.products)
        return self.icon_index.missing_icons(needed_items)

    def visual_graph(
        self,
        item: str,
        rate: float,
        *,
        strategy: str = "default",
        recipe_choices: dict[str, str] | None = None,
        clock_percent: float = 100,
    ) -> dict[str, object]:
        if clock_percent <= 0:
            raise ValueError("clock_percent must be greater than 0")

        result = self.calculate(
            item,
            rate,
            strategy=strategy,
            recipe_choices=recipe_choices,
        )
        tree = result["tree"]
        if not isinstance(tree, dict):
            raise ValueError("Calculation did not produce a production tree")

        production_steps = _group_production_steps(tree)
        nodes: list[dict[str, object]] = []
        edges_by_key: dict[tuple[str, str, str], dict[str, object]] = {}
        machine_totals: dict[str, float] = {}
        power_by_building: dict[str, float] = {}
        clock_factor = clock_percent / 100

        for step in production_steps:
            item_name = str(step["item"])
            recipe_name = str(step["recipe"])
            building_name = str(step["building"])
            node_id = _node_id("production", item_name, recipe_name, building_name)
            base_machine_count = float(step["machines"])
            machine_count = base_machine_count / clock_factor
            power_usage = self._power_usage_for(building_name, machine_count, clock_factor)
            _add_total(machine_totals, building_name, machine_count)
            if power_usage:
                _add_total(power_by_building, building_name, power_usage)
            nodes.append(
                {
                    "id": node_id,
                    "label": item_name,
                    "type": "machine",
                    "rate": _clean_number(float(step["rate"])),
                    "icon": self.icon_index.get_icon_path(item_name),
                    "building": building_name,
                    "recipe": recipe_name,
                    "base_machine_count": _clean_number(base_machine_count),
                    "machine_count": _clean_number(machine_count),
                    "display_machine_count": _display_machine_count(machine_count),
                    "clock_percent": _clean_number(clock_percent),
                    "power_mw": _clean_number(power_usage),
                }
            )

            ingredients = step.get("ingredients", {})
            if not isinstance(ingredients, dict):
                continue

            for ingredient_name, ingredient_rate in ingredients.items():
                ingredient_name = str(ingredient_name)
                source_id = _node_id("resource", ingredient_name)
                if ingredient_name not in self.raw_resources and ingredient_name in self.recipes_by_product:
                    source_step = _find_step_for_item(production_steps, ingredient_name)
                    if source_step is not None:
                        source_id = _node_id(
                            "production",
                            str(source_step["item"]),
                            str(source_step["recipe"]),
                            str(source_step["building"]),
                        )

                edge_key = (source_id, node_id, ingredient_name)
                if edge_key not in edges_by_key:
                    edges_by_key[edge_key] = {
                        "id": _edge_id(source_id, node_id, ingredient_name),
                        "source": source_id,
                        "target": node_id,
                        "item": ingredient_name,
                        "rate": 0.0,
                        "transport_type": _transport_type_for_item(self.items_by_name.get(ingredient_name)),
                    }
                edges_by_key[edge_key]["rate"] = float(edges_by_key[edge_key]["rate"]) + float(ingredient_rate)

        resources = result.get("resources", {})
        if isinstance(resources, dict):
            for resource_name, resource_rate in resources.items():
                nodes.append(
                    {
                        "id": _node_id("resource", str(resource_name)),
                        "label": resource_name,
                        "type": "resource",
                        "rate": resource_rate,
                        "icon": self.icon_index.get_icon_path(str(resource_name)),
                        "building": None,
                        "recipe": None,
                        "machine_count": None,
                        "display_machine_count": None,
                    }
                )

        return {
            "item": result["item"],
            "rate": result["rate"],
            "strategy": result["strategy"],
            "clock_percent": _clean_number(clock_percent),
            "nodes": nodes,
            "edges": [
                self._edge_with_transport_hint(edge)
                for edge in edges_by_key.values()
            ],
            "machines": _clean_totals(machine_totals),
            "resources": result["resources"],
            "power": {
                "total_mw": _clean_number(sum(power_by_building.values())),
                "by_building": _clean_totals(power_by_building),
            },
            "transport": self._transport_summary(edges_by_key.values()),
            "selected_recipes": result["selected_recipes"],
            "missing_icons": self.icon_index.missing_icons(
                {str(node["label"]) for node in nodes}
                | {str(edge["item"]) for edge in edges_by_key.values()}
            ),
        }

    def _build_dependency_graph(self) -> dict[str, list[str]]:
        graph: dict[str, list[str]] = {}
        for item_name in self.items_by_name:
            if item_name in self.raw_resources:
                graph[item_name] = []
                continue

            recipes = self.recipes_by_product.get(item_name)
            if not recipes:
                graph[item_name] = []
                continue

            recipe = self._choose_default_recipe(recipes)
            graph[item_name] = list(recipe.ingredients)
        return graph

    def _expand(
        self,
        item_name: str,
        path: list[str],
        *,
        strategy: str,
        recipe_choices: dict[str, str] | None,
    ) -> dict[str, object]:
        if item_name in path:
            cycle = " -> ".join([*path, item_name])
            raise ValueError(f"Recipe cycle detected: {cycle}")

        if item_name in self.raw_resources:
            return {
                "item": item_name,
                "is_raw_resource": True,
                "no_recipe_found": True,
                "ingredients": [],
            }

        recipe = self.recipes_by_product.get(item_name)
        if not recipe:
            return {
                "item": item_name,
                "is_raw_resource": True,
                "no_recipe_found": True,
                "ingredients": [],
            }

        selected_recipe = self._choose_recipe(
            item_name,
            recipe,
            strategy=strategy,
            recipe_choices=recipe_choices,
            path=path,
        )
        return {
            "item": item_name,
            "recipe": selected_recipe.name,
            "is_raw_resource": False,
            "ingredients": [
                self._expand(
                    ingredient_name,
                    [*path, item_name],
                    strategy=strategy,
                    recipe_choices=recipe_choices,
                )
                for ingredient_name in selected_recipe.ingredients
            ],
        }

    def _solve(
        self,
        item_name: str,
        rate: float,
        totals: dict[str, dict[str, float]],
        selected_recipes: dict[str, str],
        path: list[str],
        *,
        strategy: str,
        recipe_choices: dict[str, str] | None,
    ) -> dict[str, object]:
        if item_name in path:
            cycle = " -> ".join([*path, item_name])
            raise ValueError(f"Recipe cycle detected: {cycle}")

        if item_name in self.raw_resources or item_name not in self.recipes_by_product:
            _add_total(totals["resources"], item_name, rate)
            return {
                "item": item_name,
                "rate": _clean_number(rate),
                "is_raw_resource": True,
            }

        recipe = self._get_recipe(
            item_name,
            strategy=strategy,
            recipe_choices=recipe_choices,
            path=path,
        )
        selected_recipes[item_name] = recipe.name
        output_rate = self._recipe_output_rate_for(recipe, item_name)
        machine_count = rate / output_rate
        if recipe.building is not None:
            _add_total(totals["machines"], recipe.building, machine_count)
        _add_total(totals["items"], item_name, rate)

        ingredient_nodes = []
        for ingredient_name, amount_per_cycle in recipe.ingredients.items():
            ingredient_rate = amount_per_cycle * (60 / recipe.duration) * machine_count
            ingredient_nodes.append(
                self._solve(
                    ingredient_name,
                    ingredient_rate,
                    totals,
                    selected_recipes,
                    path=[*path, item_name],
                    strategy=strategy,
                    recipe_choices=recipe_choices,
                )
            )

        return {
            "item": item_name,
            "rate": _clean_number(rate),
            "recipe": recipe.name,
            "building": recipe.building,
            "machines": _clean_number(machine_count),
            "ingredients": ingredient_nodes,
        }

    def _get_default_recipe(self, item_name: str) -> Recipe:
        self._require_known_item(item_name)
        recipes = self.recipes_by_product.get(item_name)
        if not recipes:
            raise KeyError(f"No recipe found for {item_name!r}")
        return self._choose_default_recipe(recipes)

    def _get_recipe(
        self,
        item_name: str,
        *,
        strategy: str,
        recipe_choices: dict[str, str] | None,
        path: list[str] | None = None,
    ) -> Recipe:
        self._validate_strategy(strategy)
        item_name = self._resolve_item_name(item_name)
        recipes = self.recipes_by_product.get(item_name)
        if not recipes:
            raise KeyError(f"No recipe found for {item_name!r}")
        return self._choose_recipe(
            item_name,
            recipes,
            strategy=strategy,
            recipe_choices=recipe_choices,
            path=path or [],
        )

    def _recipe_output_rate_for(self, recipe: Recipe, item_name: str) -> float:
        amount = recipe.products.get(item_name)
        if amount is None:
            raise KeyError(f"Recipe {recipe.name!r} does not produce {item_name!r}")
        return amount * (60 / recipe.duration)

    def _choose_default_recipe(self, recipes: list[Recipe]) -> Recipe:
        for recipe in recipes:
            if not recipe.alternate:
                return recipe
        return recipes[0]

    def _choose_recipe(
        self,
        item_name: str,
        recipes: list[Recipe],
        *,
        strategy: str,
        recipe_choices: dict[str, str] | None,
        path: list[str],
    ) -> Recipe:
        if strategy == "default":
            return self._choose_cycle_safe_default_recipe(item_name, recipes, path)

        if strategy == "custom":
            choice = (recipe_choices or {}).get(item_name)
            if choice is None:
                return self._choose_cycle_safe_default_recipe(item_name, recipes, path)
            return _find_recipe_by_name(item_name, recipes, choice)

        raise ValueError(f"Unsupported recipe strategy {strategy!r}")

    def _validate_strategy(self, strategy: str) -> None:
        if strategy not in {"default", "custom"}:
            raise ValueError(f"Unsupported recipe strategy {strategy!r}")

    def _power_usage_for(self, building_name: str, machine_count: float, clock_factor: float) -> float:
        building = self._building_by_name(building_name)
        if building is None or building.power_usage <= 0:
            return 0
        power_per_machine = building.power_usage * (clock_factor ** POWER_CLOCK_EXPONENT)
        return machine_count * power_per_machine

    def _building_by_name(self, building_name: str):
        for building in self.buildings_by_class.values():
            if building.name == building_name:
                return building
        return None

    def _edge_with_transport_hint(self, edge: dict[str, object]) -> dict[str, object]:
        rate = float(edge["rate"])
        transport_type = str(edge["transport_type"])
        return {
            **edge,
            "rate": _clean_number(rate),
            "transport_hint": _transport_hint(transport_type, rate),
        }

    def _transport_summary(self, edges: object) -> dict[str, object]:
        totals: dict[str, float] = {}
        for edge in edges:
            if not isinstance(edge, dict):
                continue
            hint = _transport_hint(str(edge["transport_type"]), float(edge["rate"]))
            standard = str(hint["standard"])
            totals[standard] = totals.get(standard, 0) + int(hint["lines"])
        return {
            "by_standard": {
                standard: int(count)
                for standard, count in sorted(totals.items())
            }
        }

    def _choose_cycle_safe_default_recipe(
        self,
        item_name: str,
        recipes: list[Recipe],
        path: list[str],
    ) -> Recipe:
        ordered_recipes = sorted(
            recipes,
            key=lambda recipe: (
                _normalize_recipe_name(recipe.name) != _normalize_item_name(item_name),
                recipe.alternate,
            ),
        )
        for recipe in ordered_recipes:
            if not self._recipe_reaches_path(recipe, [*path, item_name]):
                return recipe

        raise ValueError(f"No cycle-free recipe found for {item_name!r} in path {' -> '.join(path)}")

    def _recipe_reaches_path(self, recipe: Recipe, path: list[str]) -> bool:
        path_items = set(path)
        return any(ingredient_name in path_items for ingredient_name in recipe.ingredients)

    def _require_known_item(self, item_name: str) -> None:
        if item_name not in self.items_by_name:
            raise KeyError(f"Unknown item {item_name!r}")

    def _resolve_item_name(self, item_name: str) -> str:
        if item_name in self.items_by_name:
            return item_name

        normalized_name = _normalize_item_name(item_name)
        for known_item_name in self.items_by_name:
            if _normalize_item_name(known_item_name) == normalized_name:
                return known_item_name

        raise KeyError(f"Unknown item {item_name!r}")

    def _normalize_recipe_choices(self, recipe_choices: dict[str, str] | None) -> dict[str, str]:
        if not recipe_choices:
            return {}
        return {
            self._resolve_item_name(item_name): recipe_name
            for item_name, recipe_name in recipe_choices.items()
        }


def _clean_number(value: float) -> int | float:
    if isclose(value, round(value), abs_tol=1e-9):
        return int(round(value))
    return round(value, 4)


def _clean_totals(totals: dict[str, float]) -> dict[str, int | float]:
    return {
        name: _clean_number(value)
        for name, value in sorted(totals.items())
        if not isclose(value, 0, abs_tol=1e-9)
    }


def _add_total(totals: dict[str, float], name: str, amount: float) -> None:
    totals[name] = totals.get(name, 0) + amount


def _find_recipe_by_name(item_name: str, recipes: list[Recipe], recipe_name: str) -> Recipe:
    normalized_choice = _normalize_recipe_name(recipe_name)
    for recipe in recipes:
        if _normalize_recipe_name(recipe.name) == normalized_choice:
            return recipe

    available = ", ".join(recipe.name for recipe in recipes)
    raise KeyError(
        f"No recipe named {recipe_name!r} for {item_name!r}. Available recipes: {available}"
    )


def _normalize_recipe_name(name: str) -> str:
    normalized = name.lower().replace("-", " ").replace("_", " ")
    words = [word.rstrip("s") for word in normalized.split()]
    return " ".join(words)


def _normalize_item_name(name: str) -> str:
    normalized = name.lower().replace("-", " ").replace("_", " ")
    words = [word.rstrip("s") for word in normalized.split()]
    return " ".join(words)


def _machine_key(building_name: str | None) -> str:
    if building_name is None:
        return "machines"
    return _rate_key(f"{building_name}s")


def _item_rate_key(item_name: str) -> str:
    words = item_name.split()
    if not words:
        return ""

    last_word = words[-1]
    if not last_word.endswith("s"):
        words[-1] = f"{last_word}s"

    return _rate_key(" ".join(words))


def _rate_key(name: str) -> str:
    return name.lower().replace(" ", "_").replace("-", "_")


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


def _production_nodes(tree: dict[str, object]) -> list[dict[str, object]]:
    nodes: list[dict[str, object]] = []
    for child in tree.get("ingredients", []):
        if isinstance(child, dict):
            nodes.extend(_production_nodes(child))

    if not tree.get("is_raw_resource"):
        nodes.append(tree)

    return nodes


def _find_step_for_item(
    production_steps: list[dict[str, object]],
    item_name: str,
) -> dict[str, object] | None:
    for step in production_steps:
        if step["item"] == item_name:
            return step
    return None


def _display_machine_count(value: float) -> int:
    from math import ceil

    return max(1, ceil(value))


def _transport_type_for_item(item: object) -> str:
    form = getattr(item, "form", None)
    if form == "liquid":
        return "pipe"
    if form == "gas":
        return "gas"
    return "belt"


def _transport_hint(transport_type: str, rate: float) -> dict[str, int | float | str]:
    capacities = TRANSPORT_CAPACITIES.get(transport_type) or TRANSPORT_CAPACITIES["belt"]
    for standard, capacity in capacities:
        if rate <= capacity:
            return {
                "standard": standard,
                "capacity": capacity,
                "lines": 1,
                "rate_per_line": _clean_number(rate),
            }

    standard, capacity = capacities[-1]
    lines = max(1, ceil(rate / capacity))
    return {
        "standard": standard,
        "capacity": capacity,
        "lines": lines,
        "rate_per_line": _clean_number(rate / lines),
    }


def _node_id(*parts: str) -> str:
    return "__".join(_id_part(part) for part in parts)


def _edge_id(source_id: str, target_id: str, item_name: str) -> str:
    return _node_id("edge", source_id, target_id, item_name)


def _id_part(value: str) -> str:
    normalized = value.lower().replace(" ", "_").replace("-", "_")
    return "".join(character for character in normalized if character.isalnum() or character == "_")


def _format_tree_lines(tree: dict[str, object], prefix: str = "") -> list[str]:
    item_name = str(tree["item"])
    ingredients = tree.get("ingredients", [])
    lines = [f"{prefix}{item_name}"]

    if not isinstance(ingredients, list):
        return lines

    for index, ingredient in enumerate(ingredients):
        if not isinstance(ingredient, dict):
            continue

        is_last = index == len(ingredients) - 1
        connector = "`-- " if is_last else "|-- "
        child_prefix = "    " if is_last else "|   "
        child_lines = _format_tree_lines(ingredient, prefix + child_prefix)
        child_lines[0] = f"{prefix}{connector}{ingredient['item']}"
        lines.extend(child_lines)

    return lines


planner = Planner()
