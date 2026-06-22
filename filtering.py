import argparse
import shutil
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent
DEFAULT_PARTS_DIR = PROJECT_ROOT / "data" / "Parts"
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"}


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Keep 256 icons and move PNG files from subfolders into data/Parts."
    )
    parser.add_argument(
        "--parts-dir",
        type=Path,
        default=DEFAULT_PARTS_DIR,
        help="directory containing part icon images; defaults to data/Parts",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="actually delete non-256 images and move PNG files; without this flag the script only previews changes",
    )
    args = parser.parse_args()

    parts_dir = args.parts_dir.resolve()
    if not parts_dir.exists() or not parts_dir.is_dir():
        raise FileNotFoundError(f"Parts directory not found: {parts_dir}")

    files_to_delete = _find_non_256_images(parts_dir)
    files_to_move = _find_pngs_to_flatten(parts_dir, ignored_files=set(files_to_delete))

    if not files_to_delete and not files_to_move:
        print("No non-256 image files or nested PNG files found.")
        return

    _preview_or_delete(files_to_delete, parts_dir, apply=args.apply)
    _preview_or_move(files_to_move, parts_dir, apply=args.apply)

    if args.apply:
        removed_dirs = _remove_empty_subfolders(parts_dir)
        if removed_dirs:
            print(f"Removed {removed_dirs} empty subfolders.")


def _find_non_256_images(parts_dir: Path) -> list[Path]:
    return [
        path
        for path in parts_dir.rglob("*")
        if path.is_file()
        and path.suffix.lower() in IMAGE_EXTENSIONS
        and "256" not in path.name
    ]


def _find_pngs_to_flatten(parts_dir: Path, ignored_files: set[Path]) -> list[Path]:
    return [
        path
        for path in parts_dir.rglob("*.png")
        if path.is_file()
        and path.parent != parts_dir
        and path not in ignored_files
    ]


def _preview_or_delete(files_to_delete: list[Path], parts_dir: Path, *, apply: bool) -> None:
    if not files_to_delete:
        return

    action = "Deleting" if apply else "Would delete"
    for path in files_to_delete:
        print(f"{action}: {path.relative_to(parts_dir)}")
        if apply:
            path.unlink()

    if apply:
        print(f"Deleted {len(files_to_delete)} files.")
    else:
        print(f"Previewed {len(files_to_delete)} files. Rerun with --apply to delete them.")


def _preview_or_move(files_to_move: list[Path], parts_dir: Path, *, apply: bool) -> None:
    if not files_to_move:
        return

    action = "Moving" if apply else "Would move"
    for source_path in files_to_move:
        target_path = _available_target_path(parts_dir / source_path.name)
        print(f"{action}: {source_path.relative_to(parts_dir)} -> {target_path.name}")
        if apply:
            shutil.move(str(source_path), str(target_path))

    if apply:
        print(f"Moved {len(files_to_move)} PNG files into {parts_dir}.")
    else:
        print(f"Previewed {len(files_to_move)} PNG moves. Rerun with --apply to move them.")


def _available_target_path(target_path: Path) -> Path:
    if not target_path.exists():
        return target_path

    counter = 2
    while True:
        candidate = target_path.with_name(f"{target_path.stem}_{counter}{target_path.suffix}")
        if not candidate.exists():
            return candidate
        counter += 1


def _remove_empty_subfolders(parts_dir: Path) -> int:
    removed_count = 0
    for directory in sorted(
        (path for path in parts_dir.rglob("*") if path.is_dir()),
        key=lambda path: len(path.parts),
        reverse=True,
    ):
        try:
            directory.rmdir()
        except OSError:
            continue
        removed_count += 1

    return removed_count


if __name__ == "__main__":
    main()
