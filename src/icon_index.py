from __future__ import annotations

import re
from pathlib import Path


ICON_ALIASES = {
    "AI Expansion Server": "IconDesc_AIExpension_256.png",
    "Alclad Aluminum Sheet": "IconDesc_AluminiumSheet_256.png",
    "Alumina Solution": "LiquidAlumina_Pipe_256.png",
    "Aluminum Casing": "IconDesc_AluminiumCasing_256.png",
    "Aluminum Ingot": "IconDesc_AluminiumIngot_256.png",
    "Aluminum Scrap": "IconDesc_AluminiumScrap_256.png",
    "Assembly Director System": "IconDesc_AssemblyDirectorSystem_256.png",
    "Automated Wiring": "SpelevatorPart_3_256.png",
    "Cable": "IconDesc_Cables_256.png",
    "Coal": "IconDesc_CoalOre_256.png",
    "Copper Ore": "IconDesc_copper_new_256.png",
    "Copper Powder": "IconDesc_CopperDust_256.png",
    "Crude Oil": "Oil_256.png",
    "Dark Matter Crystal": "IconDesc_QuantumCrystal_256.png",
    "Dark Matter Residue": "IconDesc_DarkEnergy_256.png",
    "Diamonds": "IconDesc_Diamonds_256.png",
    "Empty Canister": "IconDesc_EmptyCannister_256.png",
    "Empty Fluid Tank": "IconDesc_PressureTank_256.png",
    "Encased Industrial Beam": "IconDesc_EncasedSteelBeam_256.png",
    "Encased Uranium Cell": "IconDesc_NuclearCell_256.png",
    "Excited Photonic Matter": "IconDesc_ExoticMatter_256.png",
    "Fuel": "IconDesc_LiquidFuel_Pipe_256.png",
    "Heavy Modular Frame": "IconDesc_ModularFrameHeavy_256.png",
    "Heavy Oil Residue": "OilResidue_256.png",
    "Iron Ore": "IconDesc_iron_new_256.png",
    "Iron Plate": "IconDesc_IronPlates_256.png",
    "Iron Rod": "IconDesc_IronRods_256.png",
    "Limestone": "Stone_256.png",
    "Liquid Biofuel": "IconDesc_LiquidBiofuel_Pipe_256.png",
    "Motor": "IconDesc_Engine_256.png",
    "Nitrogen Gas": "IconDesc_NitrogenGas_256.png",
    "Non-Fissile Uranium": "IconDesc_NonFissileUranium_256.png",
    "Packaged Sulfuric Acid": "IconDesc_PckagedSulphuricAcid_256.png",
    "Pressure Conversion Cube": "IconDesc_ConversionCube_256.png",
    "Raw Quartz": "IconDesc_QuartzResource_256.png",
    "Reinforced Iron Plate": "IconDesc_ReinforcedIronPlates_256.png",
    "Rocket Fuel": "IconDesc_RocketFuelPipe_256.png",
    "SAM": "IconDesc_SameOre_256.png",
    "Screws": "IconDesc_IronScrews_256.png",
    "Smart Plating": "IconDesc_SpelevatorPart_1_256.png",
    "Steel Beam": "IconDesc_SteelBeam_256.png",
    "Turbofuel": "IconDesc_LiquidTurboFuel_Pipe_256.png",
    "Versatile Framework": "IconDesc_SpelevatorPart_2_256.png",
    "Water": "LiquidWater_Pipe_256.png",
}


class IconIndex:
    def __init__(self, icon_dir: Path | str) -> None:
        self.icon_dir = Path(icon_dir)
        self.project_root = self.icon_dir.parent.parent
        self._icons_by_normalized_name = self._build_index()

    def get_icon_path(self, item_name: str) -> str | None:
        alias = ICON_ALIASES.get(item_name)
        if alias is not None:
            path = self.icon_dir / alias
            if path.exists():
                return self._portable_path(path)

        normalized_item_name = _normalize_name(item_name)
        path = self._icons_by_normalized_name.get(normalized_item_name)
        if path is None:
            return None
        return self._portable_path(path)

    def missing_icons(self, item_names: set[str]) -> list[str]:
        return sorted(item_name for item_name in item_names if self.get_icon_path(item_name) is None)

    def _build_index(self) -> dict[str, Path]:
        icons_by_name: dict[str, Path] = {}
        if not self.icon_dir.exists():
            return icons_by_name

        for path in self.icon_dir.glob("*.png"):
            for candidate in _icon_name_candidates(path.stem):
                icons_by_name.setdefault(candidate, path)

        return icons_by_name

    def _portable_path(self, path: Path) -> str:
        try:
            return path.relative_to(self.project_root).as_posix()
        except ValueError:
            return path.as_posix()


def _icon_name_candidates(stem: str) -> set[str]:
    cleaned = stem
    for prefix in ("IconDesc_", "Desc_"):
        if cleaned.startswith(prefix):
            cleaned = cleaned[len(prefix) :]
    cleaned = cleaned.removesuffix("_256")

    return {
        _normalize_name(cleaned),
        _normalize_name(_split_camel_case(cleaned)),
    }


def _normalize_name(name: str) -> str:
    normalized = name.lower().replace("aluminium", "aluminum")
    normalized = re.sub(r"[^a-z0-9]", "", normalized)
    return normalized.rstrip("s")


def _split_camel_case(value: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", " ", value.replace("_", " "))

