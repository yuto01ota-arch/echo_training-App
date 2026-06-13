#!/usr/bin/env python3
"""Local helper UI for adding echo-training assets."""

from __future__ import annotations

import argparse
import hashlib
import warnings

warnings.filterwarnings("ignore", message="'cgi' is deprecated.*", category=DeprecationWarning)
import cgi
import html
import json
import re
import shutil
import subprocess
import tempfile
import webbrowser
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any


MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 5000
TARGET_FRAME_COUNT = 200


class UserInputError(Exception):
    """Raised when form input cannot be used safely."""


@dataclass(frozen=True)
class AddEchoResult:
    major_dir: Path
    item_file: Path
    category_data_file: Path
    menu_config_file: Path
    all_data_file: Path
    data_dir: Path
    frame_count: int
    extractor: str
    major_created: bool
    item_file_created: bool
    category_data_created: bool
    menu_config_updated: bool
    all_data_updated: bool


class AddEchoHTTPServer(HTTPServer):
    def __init__(self, server_address: tuple[str, int], project_root: Path):
        super().__init__(server_address, AddEchoRequestHandler)
        self.project_root = project_root.resolve()


class AddEchoRequestHandler(BaseHTTPRequestHandler):
    server: AddEchoHTTPServer

    def do_GET(self) -> None:
        if self.path not in {"/", "/add"}:
            self.render_not_found()
            return

        self.render_html(render_page(self.server.project_root))

    def do_POST(self) -> None:
        if self.path != "/add":
            self.render_not_found()
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.render_html(
                render_page(self.server.project_root, error="送信データのサイズを確認できませんでした。"),
                status_code=400,
            )
            return

        if content_length <= 0:
            self.render_html(
                render_page(self.server.project_root, error="フォームの内容が送信されていません。"),
                status_code=400,
            )
            return

        if content_length > MAX_UPLOAD_BYTES:
            self.render_html(
                render_page(self.server.project_root, error="動画ファイルが大きすぎます。4GB以下の .mp4 を選択してください。"),
                status_code=413,
            )
            return

        form = cgi.FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ={
                "REQUEST_METHOD": "POST",
                "CONTENT_TYPE": self.headers.get("Content-Type", ""),
                "CONTENT_LENGTH": str(content_length),
            },
            keep_blank_values=True,
        )

        try:
            result = handle_form_submission(form, self.server.project_root)
            self.render_html(render_page(self.server.project_root, result=result))
        except UserInputError as exc:
            self.render_html(render_page(self.server.project_root, error=str(exc)), status_code=400)
        except Exception as exc:
            self.render_html(
                render_page(self.server.project_root, error=f"処理中にエラーが発生しました: {exc}"),
                status_code=500,
            )

    def render_html(self, body: str, status_code: int = 200) -> None:
        payload = body.encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def render_not_found(self) -> None:
        self.render_html(render_page(self.server.project_root, error="ページが見つかりません。"), status_code=404)

    def log_message(self, format: str, *args: Any) -> None:
        print(f"{self.address_string()} - {format % args}")


def handle_form_submission(form: cgi.FieldStorage, project_root: Path) -> AddEchoResult:
    major_category = validate_path_name(get_text_field(form, "major_category"), "大項目")
    minor_category = validate_path_name(get_text_field(form, "minor_category"), "小項目")
    video_name = validate_path_name(get_text_field(form, "video_name"), "動画の名前")
    video_file = get_file_field(form, "video_file")

    uploaded_filename = Path(video_file.filename or "").name
    if not uploaded_filename.lower().endswith(".mp4"):
        raise UserInputError("動画ファイルは .mp4 のみ選択できます。")

    with tempfile.TemporaryDirectory(prefix="add-echo-upload-") as temp_dir:
        source_video = Path(temp_dir) / "upload.mp4"
        with source_video.open("wb") as output_file:
            shutil.copyfileobj(video_file.file, output_file)

        if source_video.stat().st_size == 0:
            raise UserInputError("動画ファイルが空です。別の .mp4 を選択してください。")

        return add_echo_item(project_root, major_category, minor_category, video_name, source_video)


def add_echo_item(
    project_root: Path,
    major_category: str,
    minor_category: str,
    video_name: str,
    source_video: Path,
) -> AddEchoResult:
    frontend_root = project_root / "src" / "frontend"
    data_root = project_root / "data"
    major_dir = frontend_root / major_category
    item_file = major_dir / f"{minor_category}.js"
    category_data_file = frontend_root / f"{major_category}Data.js"
    menu_config_file = frontend_root / "menuConfig.js"
    all_data_file = frontend_root / "allData.js"
    target_data_dir = data_root / video_name

    ensure_directory_slot(major_dir, "大項目")
    ensure_file_slot(item_file, "小項目JS")
    ensure_file_slot(category_data_file, "大項目Data.js")
    ensure_file_slot(menu_config_file, "menuConfig.js")
    ensure_file_slot(all_data_file, "allData.js")
    ensure_data_directory_available(target_data_dir, video_name)

    data_root.mkdir(parents=True, exist_ok=True)
    staging_dir = Path(tempfile.mkdtemp(prefix=".add-echo-", dir=data_root))

    try:
        frame_count, extractor = extract_frames(source_video, staging_dir)
        major_created = not major_dir.exists()
        item_file_created = not item_file.exists()
        category_data_created = not category_data_file.exists()

        frontend_root.mkdir(parents=True, exist_ok=True)
        major_dir.mkdir(parents=True, exist_ok=True)
        ensure_item_module(item_file, minor_category)
        category_export_name = ensure_category_data_file(
            category_data_file=category_data_file,
            major_category=major_category,
            minor_category=minor_category,
            item_file=item_file,
        )
        all_data_updated = ensure_all_data_file(
            all_data_file=all_data_file,
            category_data_file=category_data_file,
            category_export_name=category_export_name,
        )
        menu_config_updated = ensure_menu_config_file(
            menu_config_file=menu_config_file,
            major_category=major_category,
            minor_category=minor_category,
            video_name=video_name,
            frame_count=frame_count,
        )

        if target_data_dir.exists():
            target_data_dir.rmdir()

        staging_dir.rename(target_data_dir)
        return AddEchoResult(
            major_dir=major_dir,
            item_file=item_file,
            category_data_file=category_data_file,
            menu_config_file=menu_config_file,
            all_data_file=all_data_file,
            data_dir=target_data_dir,
            frame_count=frame_count,
            extractor=extractor,
            major_created=major_created,
            item_file_created=item_file_created,
            category_data_created=category_data_created,
            menu_config_updated=menu_config_updated,
            all_data_updated=all_data_updated,
        )
    except Exception:
        shutil.rmtree(staging_dir, ignore_errors=True)
        raise


def extract_frames(source_video: Path, output_dir: Path) -> tuple[int, str]:
    if shutil.which("ffmpeg"):
        return extract_frames_with_ffmpeg(source_video, output_dir)

    return extract_frames_with_opencv(source_video, output_dir)


def extract_frames_with_ffmpeg(source_video: Path, output_dir: Path) -> tuple[int, str]:
    with tempfile.TemporaryDirectory(prefix="add-echo-frames-") as temp_dir:
        temp_output_dir = Path(temp_dir)
        frame_pattern = temp_output_dir / "source_%06d.jpg"
        command = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(source_video),
            "-q:v",
            "2",
            str(frame_pattern),
        ]
        completed = subprocess.run(command, capture_output=True, text=True, check=False)
        if completed.returncode != 0:
            message = completed.stderr.strip() or "ffmpeg で動画を読み込めませんでした。"
            raise UserInputError(message)

        source_frames = sorted(temp_output_dir.glob("source_*.jpg"))
        if not source_frames:
            raise UserInputError("動画からフレームを抽出できませんでした。別の .mp4 を選択してください。")

        write_sampled_frames(source_frames, output_dir)

    return TARGET_FRAME_COUNT, f"ffmpeg / sampled {TARGET_FRAME_COUNT}"


def extract_frames_with_opencv(source_video: Path, output_dir: Path) -> tuple[int, str]:
    try:
        import cv2  # type: ignore
    except ImportError as exc:
        raise UserInputError("ffmpeg または opencv-python が必要です。先にどちらかをインストールしてください。") from exc

    capture = cv2.VideoCapture(str(source_video))
    if not capture.isOpened():
        raise UserInputError("動画を読み込めませんでした。別の .mp4 を選択してください。")

    frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    if frame_count <= 0:
        capture.release()
        with tempfile.TemporaryDirectory(prefix="add-echo-opencv-frames-") as temp_dir:
            temp_output_dir = Path(temp_dir)
            return extract_all_frames_with_opencv(source_video, temp_output_dir, output_dir, cv2)

    frame_indices = sample_frame_indices(frame_count, TARGET_FRAME_COUNT)
    written_count = 0
    try:
        for source_index, target_index in enumerate(frame_indices, start=1):
            capture.set(cv2.CAP_PROP_POS_FRAMES, target_index)
            success, frame = capture.read()
            if not success:
                raise UserInputError(f"動画の {target_index + 1} フレーム目を読み込めませんでした。")

            written_count = source_index
            frame_path = output_dir / f"frame_{source_index:03d}.jpg"
            if not cv2.imwrite(str(frame_path), frame):
                raise UserInputError(f"{frame_path.name} を保存できませんでした。")
    finally:
        capture.release()

    if written_count == 0:
        raise UserInputError("動画からフレームを抽出できませんでした。別の .mp4 を選択してください。")

    return written_count, f"opencv-python / sampled {TARGET_FRAME_COUNT}"


def extract_all_frames_with_opencv(source_video: Path, temp_output_dir: Path, output_dir: Path, cv2: Any) -> tuple[int, str]:
    capture = cv2.VideoCapture(str(source_video))
    if not capture.isOpened():
        raise UserInputError("動画を読み込めませんでした。別の .mp4 を選択してください。")

    source_frames: list[Path] = []
    try:
        while True:
            success, frame = capture.read()
            if not success:
                break

            frame_path = temp_output_dir / f"source_{len(source_frames) + 1:06d}.jpg"
            if not cv2.imwrite(str(frame_path), frame):
                raise UserInputError(f"{frame_path.name} を保存できませんでした。")
            source_frames.append(frame_path)
    finally:
        capture.release()

    if not source_frames:
        raise UserInputError("動画からフレームを抽出できませんでした。別の .mp4 を選択してください。")

    write_sampled_frames(source_frames, output_dir)
    return TARGET_FRAME_COUNT, f"opencv-python / sampled {TARGET_FRAME_COUNT}"


def write_sampled_frames(source_frames: list[Path], output_dir: Path) -> None:
    frame_indices = sample_frame_indices(len(source_frames), TARGET_FRAME_COUNT)
    for output_index, source_index in enumerate(frame_indices, start=1):
        shutil.copyfile(source_frames[source_index], output_dir / f"frame_{output_index:03d}.jpg")


def sample_frame_indices(total_frames: int, target_count: int) -> list[int]:
    if total_frames <= 0:
        raise UserInputError("動画からフレームを抽出できませんでした。別の .mp4 を選択してください。")

    if target_count <= 1:
        return [0]

    last_index = total_frames - 1
    return [round(last_index * index / (target_count - 1)) for index in range(target_count)]


def count_output_frames(output_dir: Path) -> int:
    return sum(1 for path in output_dir.glob("frame_*.jpg") if path.is_file())


def get_text_field(form: cgi.FieldStorage, field_name: str) -> str:
    value = form.getfirst(field_name, "")
    if isinstance(value, bytes):
        value = value.decode("utf-8", errors="replace")
    return str(value)


def get_file_field(form: cgi.FieldStorage, field_name: str) -> cgi.FieldStorage:
    if field_name not in form:
        raise UserInputError("動画ファイルを選択してください。")

    value = form[field_name]
    if isinstance(value, list):
        value = value[0]

    if not isinstance(value, cgi.FieldStorage) or not value.filename:
        raise UserInputError("動画ファイルを選択してください。")

    return value


def validate_path_name(value: str, label: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise UserInputError(f"{label}を入力してください。")

    if cleaned in {".", ".."} or ".." in cleaned:
        raise UserInputError(f"{label}に '..' は使えません。")

    forbidden_characters = {"/", "\\", "\0", ":"}
    if any(character in cleaned for character in forbidden_characters):
        raise UserInputError(f"{label}に /, \\, : は使えません。")

    if any(ord(character) < 32 for character in cleaned):
        raise UserInputError(f"{label}に制御文字は使えません。")

    if len(cleaned.encode("utf-8")) > 180:
        raise UserInputError(f"{label}が長すぎます。もう少し短い名前にしてください。")

    return cleaned


def ensure_directory_slot(path: Path, label: str) -> None:
    if path.exists() and not path.is_dir():
        raise UserInputError(f"{label}の作成先に同名のファイルがあります: {path}")


def ensure_file_slot(path: Path, label: str) -> None:
    if path.exists() and not path.is_file():
        raise UserInputError(f"{label}の作成先に同名のディレクトリがあります: {path}")


def ensure_data_directory_available(target_data_dir: Path, video_name: str) -> None:
    if target_data_dir.exists() and not target_data_dir.is_dir():
        raise UserInputError(f"data/{video_name} と同名のファイルがあります。別の動画の名前を使ってください。")

    if target_data_dir.exists() and any(target_data_dir.iterdir()):
        raise UserInputError(f"data/{video_name} は既に存在し、中身があります。別の動画の名前を使ってください。")


def ensure_item_module(item_file: Path, minor_category: str) -> None:
    if item_file.exists():
        return

    item_file.write_text(
        "export default {\n"
        f"    {js_string(minor_category)}: {{\n"
        "    }\n"
        "};\n",
        encoding="utf-8",
    )


def ensure_category_data_file(
    category_data_file: Path,
    major_category: str,
    minor_category: str,
    item_file: Path,
) -> str:
    export_name = infer_category_export_name(category_data_file, major_category)
    item_var = make_item_data_identifier(major_category, minor_category)
    import_path = relative_js_import_path(category_data_file.parent, item_file)

    if not category_data_file.exists():
        category_data_file.write_text(
            f"import {item_var} from {js_string(import_path)};\n\n"
            f"export const {export_name} = {{\n"
            f"    ...{item_var}\n"
            "};\n",
            encoding="utf-8",
        )
        return export_name

    text = category_data_file.read_text(encoding="utf-8")
    export_name = infer_category_export_name_from_text(text) or export_name
    imported_var = find_default_import_var(text, import_path) or item_var

    if not find_default_import_var(text, import_path):
        text = insert_import_line(text, f"import {imported_var} from {js_string(import_path)};\n")

    if f"...{imported_var}" not in text:
        text = insert_spread_into_export_object(text, export_name, imported_var, category_data_file)

    category_data_file.write_text(text, encoding="utf-8")
    return export_name


def ensure_all_data_file(all_data_file: Path, category_data_file: Path, category_export_name: str) -> bool:
    import_path = relative_js_import_path(all_data_file.parent, category_data_file)
    import_line = f"import {{ {category_export_name} }} from {js_string(import_path)};\n"

    if not all_data_file.exists():
        all_data_file.write_text(
            import_line
            + "\n"
            + "export const allData = {\n"
            + f"    ...{category_export_name}\n"
            + "};\n",
            encoding="utf-8",
        )
        return True

    text = all_data_file.read_text(encoding="utf-8")
    original = text

    if import_path not in text:
        text = insert_import_line(text, import_line)

    if f"...{category_export_name}" not in text:
        text = insert_spread_into_export_object(text, "allData", category_export_name, all_data_file)

    if text != original:
        all_data_file.write_text(text, encoding="utf-8")

    return text != original


def ensure_menu_config_file(
    menu_config_file: Path,
    major_category: str,
    minor_category: str,
    video_name: str,
    frame_count: int,
) -> bool:
    category_label = category_label_from_directory(major_category)
    item_entry = build_menu_item_entry(major_category, minor_category, video_name, frame_count)

    if not menu_config_file.exists():
        menu_config_file.write_text(
            "export const menuConfig = [\n"
            "    {\n"
            f"        category: {js_string(category_label)},\n"
            f"        directory: {js_string(major_category)},\n"
            "        items: [\n"
            f"            {item_entry}\n"
            "        ]\n"
            "    }\n"
            "];\n",
            encoding="utf-8",
        )
        return True

    text = menu_config_file.read_text(encoding="utf-8")
    original = text
    items_range = find_menu_category_items_range(text, category_label, major_category)

    if items_range:
        items_open, items_close = items_range
        items_block = text[items_open:items_close]
        if menu_item_exists(items_block, minor_category, video_name):
            return False
        text = insert_into_js_array(text, items_open, items_close, item_entry, "            ")
    else:
        category_entry = (
            "{\n"
            f"        category: {js_string(category_label)},\n"
            f"        directory: {js_string(major_category)},\n"
            "        items: [\n"
            f"            {item_entry}\n"
            "        ]\n"
            "    }"
        )
        array_open = find_menu_config_array_open(text, menu_config_file)
        array_close = find_matching_bracket(text, array_open)
        text = insert_into_js_array(text, array_open, array_close, category_entry, "    ")

    if text != original:
        menu_config_file.write_text(text, encoding="utf-8")

    return text != original


def build_menu_item_entry(major_category: str, minor_category: str, video_name: str, frame_count: int) -> str:
    data_path = f"./src/frontend/{major_category}/{minor_category}.js"
    category_label = category_label_from_directory(major_category)
    return (
        "{ "
        f"title: {js_string(minor_category)}, "
        f"category: {js_string(category_label)}, "
        f"categoryDir: {js_string(major_category)}, "
        f"folder: {js_string(video_name)}, "
        f"dataPath: {js_string(data_path)}, "
        "structures: [], "
        f"frameCount: {frame_count}, "
        "start: { x: 40, y: 50 }, "
        "end: { x: 60, y: 50 }, "
        "rotate: 0, "
        "lineRotate: 0 "
        "}"
    )


def category_label_from_directory(major_category: str) -> str:
    spaced = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", major_category)
    spaced = spaced.replace("_", " ").replace("-", " ")
    if re.fullmatch(r"[A-Za-z0-9 ]+", spaced):
        return " ".join(spaced.upper().split())
    return major_category


def normalize_lookup_value(value: str) -> str:
    return re.sub(r"[^0-9a-z]+", "", value.lower())


def menu_item_exists(items_block: str, minor_category: str, video_name: str) -> bool:
    return (
        js_string(minor_category) in items_block
        or js_string(video_name) in items_block
        or f"folder: '{video_name}'" in items_block
        or f'title: "{minor_category}"' in items_block
    )


def js_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def make_item_data_identifier(major_category: str, minor_category: str) -> str:
    return make_js_identifier(f"{major_category}_{minor_category}Data", "itemData")


def infer_category_export_name(category_data_file: Path, major_category: str) -> str:
    if category_data_file.exists():
        existing = infer_category_export_name_from_text(category_data_file.read_text(encoding="utf-8"))
        if existing:
            return existing

    return make_js_identifier(f"{major_category}Data", "categoryData")


def infer_category_export_name_from_text(text: str) -> str | None:
    match = re.search(r"export\s+const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=", text)
    return match.group(1) if match else None


def make_js_identifier(value: str, fallback_prefix: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_$]+", "_", value).strip("_")
    if not cleaned or not re.match(r"[A-Za-z_$]", cleaned):
        digest = hashlib.sha1(value.encode("utf-8")).hexdigest()[:8]
        cleaned = f"{fallback_prefix}_{digest}"
    return cleaned


def relative_js_import_path(from_dir: Path, target_file: Path) -> str:
    relative = target_file.relative_to(from_dir).as_posix() if target_file.is_relative_to(from_dir) else None
    if relative is None:
        relative = target_file.relative_to(from_dir.parent).as_posix()
    if not relative.startswith("."):
        relative = f"./{relative}"
    return relative


def find_default_import_var(text: str, import_path: str) -> str | None:
    pattern = rf'import\s+([A-Za-z_$][A-Za-z0-9_$]*)\s+from\s+["\']{re.escape(import_path)}["\']'
    match = re.search(pattern, text)
    return match.group(1) if match else None


def insert_import_line(text: str, import_line: str) -> str:
    matches = list(re.finditer(r"^import .+;\n", text, flags=re.MULTILINE))
    insert_at = matches[-1].end() if matches else 0
    separator = "" if insert_at == 0 or text[insert_at:insert_at + 1] == "\n" else "\n"
    return text[:insert_at] + import_line + separator + text[insert_at:]


def insert_spread_into_export_object(text: str, export_name: str, spread_name: str, file_path: Path) -> str:
    pattern = rf"export\s+const\s+{re.escape(export_name)}\s*=\s*{{"
    match = re.search(pattern, text)
    if not match:
        raise UserInputError(f"{file_path} の export const {export_name} を自動更新できません。")

    object_open = text.find("{", match.start())
    return text[: object_open + 1] + f"\n    ...{spread_name}," + text[object_open + 1 :]


def find_menu_config_array_open(text: str, file_path: Path) -> int:
    match = re.search(r"export\s+const\s+menuConfig\s*=\s*\[", text)
    if not match:
        raise UserInputError(f"{file_path} の menuConfig 配列を自動更新できません。")
    return text.find("[", match.start())


def find_menu_category_items_range(text: str, category_label: str, major_category: str) -> tuple[int, int] | None:
    expected = {normalize_lookup_value(category_label), normalize_lookup_value(major_category)}
    for match in re.finditer(r'category\s*:\s*("(?:\\.|[^"])*")', text):
        try:
            value = json.loads(match.group(1))
        except json.JSONDecodeError:
            continue

        if normalize_lookup_value(value) not in expected:
            continue

        object_open = text.rfind("{", 0, match.start())
        if object_open < 0:
            continue

        object_close = find_matching_bracket(text, object_open)
        items_match = re.search(r"items\s*:", text[match.end() : object_close])
        if not items_match:
            continue

        items_label_start = match.end() + items_match.start()
        items_open = text.find("[", items_label_start, object_close)
        if items_open < 0:
            continue

        return items_open, find_matching_bracket(text, items_open)

    return None


def find_matching_bracket(text: str, open_index: int) -> int:
    open_char = text[open_index]
    close_char = {"{": "}", "[": "]"}.get(open_char)
    if close_char is None:
        raise ValueError("open_index must point to { or [")

    depth = 0
    quote: str | None = None
    escaped = False
    line_comment = False
    block_comment = False

    index = open_index
    while index < len(text):
        char = text[index]
        next_char = text[index + 1] if index + 1 < len(text) else ""

        if line_comment:
            if char == "\n":
                line_comment = False
            index += 1
            continue

        if block_comment:
            if char == "*" and next_char == "/":
                block_comment = False
                index += 2
            else:
                index += 1
            continue

        if quote:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
            index += 1
            continue

        if char in {"'", '"', "`"}:
            quote = char
            index += 1
            continue

        if char == "/" and next_char == "/":
            line_comment = True
            index += 2
            continue

        if char == "/" and next_char == "*":
            block_comment = True
            index += 2
            continue

        if char == open_char:
            depth += 1
        elif char == close_char:
            depth -= 1
            if depth == 0:
                return index

        index += 1

    raise ValueError("matching bracket was not found")


def insert_into_js_array(text: str, array_open: int, array_close: int, entry: str, indent: str) -> str:
    insert_at = array_close
    while insert_at > array_open + 1 and text[insert_at - 1].isspace():
        insert_at -= 1

    existing_content = text[array_open + 1 : insert_at].strip()
    needs_comma = bool(existing_content) and text[insert_at - 1] != ","
    insertion = ("," if needs_comma else "") + "\n" + indent + entry
    trailing_whitespace = text[insert_at:array_close]
    return text[:insert_at] + insertion + trailing_whitespace + text[array_close:]


def render_page(project_root: Path, result: AddEchoResult | None = None, error: str | None = None) -> str:
    escaped_root = html.escape(str(project_root))
    notice = ""
    if result:
        notice = render_result(project_root, result)
    elif error:
        notice = f"""
        <section class="notice notice-error" aria-live="polite">
            <h2>処理できませんでした</h2>
            <p>{html.escape(error)}</p>
        </section>
        """

    return f"""<!doctype html>
<html lang="ja">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Echo Training 項目追加</title>
    <style>
        :root {{
            color-scheme: light;
            --bg: #f7f8fa;
            --panel: #ffffff;
            --text: #1f2933;
            --muted: #5f6b7a;
            --border: #d7dde5;
            --primary: #1769e0;
            --primary-dark: #0f55b8;
            --success-bg: #edf9f2;
            --success-border: #8ccfa4;
            --error-bg: #fff1f1;
            --error-border: #e28b8b;
            --code-bg: #eef2f6;
        }}

        * {{
            box-sizing: border-box;
        }}

        body {{
            margin: 0;
            min-height: 100vh;
            background: var(--bg);
            color: var(--text);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            line-height: 1.6;
        }}

        main {{
            width: min(920px, calc(100% - 32px));
            margin: 0 auto;
            padding: 40px 0;
        }}

        .tool-panel {{
            background: var(--panel);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 28px;
            box-shadow: 0 10px 28px rgba(31, 41, 51, 0.08);
        }}

        h1 {{
            margin: 0 0 8px;
            font-size: clamp(26px, 4vw, 36px);
            line-height: 1.25;
            letter-spacing: 0;
        }}

        .lead {{
            margin: 0 0 28px;
            color: var(--muted);
        }}

        form {{
            display: grid;
            gap: 20px;
        }}

        .field-grid {{
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 18px;
        }}

        label {{
            display: grid;
            gap: 8px;
            font-weight: 700;
        }}

        input[type="text"],
        input[type="file"] {{
            width: 100%;
            min-height: 44px;
            border: 1px solid var(--border);
            border-radius: 6px;
            background: #ffffff;
            color: var(--text);
            font: inherit;
        }}

        input[type="text"] {{
            padding: 10px 12px;
        }}

        input[type="file"] {{
            padding: 8px;
        }}

        input:focus {{
            border-color: var(--primary);
            outline: 3px solid rgba(23, 105, 224, 0.18);
        }}

        .hint {{
            margin: 0;
            color: var(--muted);
            font-size: 14px;
            font-weight: 400;
        }}

        button {{
            justify-self: start;
            min-height: 44px;
            border: 0;
            border-radius: 6px;
            padding: 10px 18px;
            background: var(--primary);
            color: #ffffff;
            font: inherit;
            font-weight: 700;
            cursor: pointer;
        }}

        button:hover {{
            background: var(--primary-dark);
        }}

        .notice {{
            margin: 24px 0 0;
            border: 1px solid;
            border-radius: 8px;
            padding: 18px;
        }}

        .notice h2 {{
            margin: 0 0 10px;
            font-size: 20px;
            line-height: 1.3;
            letter-spacing: 0;
        }}

        .notice p {{
            margin: 0;
        }}

        .notice-success {{
            background: var(--success-bg);
            border-color: var(--success-border);
        }}

        .notice-error {{
            background: var(--error-bg);
            border-color: var(--error-border);
        }}

        .result-list {{
            display: grid;
            gap: 10px;
            margin: 12px 0 0;
            padding: 0;
            list-style: none;
        }}

        .result-list li {{
            display: grid;
            gap: 4px;
        }}

        .result-list span {{
            color: var(--muted);
            font-size: 14px;
        }}

        code {{
            display: inline-block;
            max-width: 100%;
            overflow-wrap: anywhere;
            border-radius: 4px;
            padding: 2px 6px;
            background: var(--code-bg);
            color: var(--text);
        }}

        .root-path {{
            margin-top: 22px;
            color: var(--muted);
            font-size: 13px;
        }}

        @media (max-width: 720px) {{
            main {{
                width: min(100% - 24px, 920px);
                padding: 24px 0;
            }}

            .tool-panel {{
                padding: 20px;
            }}

            .field-grid {{
                grid-template-columns: 1fr;
            }}

            button {{
                width: 100%;
            }}
        }}
    </style>
</head>
<body>
    <main>
        <section class="tool-panel">
            <h1>Echo Training 項目追加</h1>
            <p class="lead">大項目、小項目、動画名、mp4動画を入力してください。動画は等間隔に200枚のjpgへ変換します。</p>
            <form action="/add" method="post" enctype="multipart/form-data">
                <div class="field-grid">
                    <label>
                        大項目
                        <input name="major_category" type="text" required autocomplete="off" placeholder="例: abdomen">
                        <p class="hint">src/frontend/大項目/ と src/frontend/大項目Data.js に使います。</p>
                    </label>
                    <label>
                        小項目
                        <input name="minor_category" type="text" required autocomplete="off" placeholder="例: abs_long">
                        <p class="hint">src/frontend/大項目/小項目.js とメニュー表示名に使います。</p>
                    </label>
                    <label>
                        動画の名前
                        <input name="video_name" type="text" required autocomplete="off" placeholder="例: abs_long">
                        <p class="hint">data/動画の名前/frame_001.jpg の保存先に使います。</p>
                    </label>
                    <label>
                        動画ファイル
                        <input name="video_file" type="file" accept=".mp4,video/mp4" required>
                        <p class="hint">.mp4 のみ選択できます。出力は frame_001.jpg から frame_200.jpg です。</p>
                    </label>
                </div>
                <button type="submit">作成してフレーム分割</button>
            </form>
            {notice}
            <p class="root-path">Project root: <code>{escaped_root}</code></p>
        </section>
    </main>
</body>
</html>
"""


def render_result(project_root: Path, result: AddEchoResult) -> str:
    major_status = "作成しました" if result.major_created else "既にあるため作成を省略しました"
    item_file_status = "作成しました" if result.item_file_created else "既にあるため作成を省略しました"
    category_data_status = "作成しました" if result.category_data_created else "更新しました"
    menu_status = "更新しました" if result.menu_config_updated else "既に登録済みです"
    all_data_status = "更新しました" if result.all_data_updated else "既に登録済みです"
    return f"""
    <section class="notice notice-success" aria-live="polite">
        <h2>追加処理が完了しました</h2>
        <ul class="result-list">
            <li>
                <span>大項目ディレクトリ: {html.escape(major_status)}</span>
                <code>{html.escape(relative_path(project_root, result.major_dir))}</code>
            </li>
            <li>
                <span>小項目JS: {html.escape(item_file_status)}</span>
                <code>{html.escape(relative_path(project_root, result.item_file))}</code>
            </li>
            <li>
                <span>大項目Data.js: {html.escape(category_data_status)}</span>
                <code>{html.escape(relative_path(project_root, result.category_data_file))}</code>
            </li>
            <li>
                <span>menuConfig.js: {html.escape(menu_status)}</span>
                <code>{html.escape(relative_path(project_root, result.menu_config_file))}</code>
            </li>
            <li>
                <span>allData.js: {html.escape(all_data_status)}</span>
                <code>{html.escape(relative_path(project_root, result.all_data_file))}</code>
            </li>
            <li>
                <span>フレーム保存先</span>
                <code>{html.escape(relative_path(project_root, result.data_dir))}</code>
            </li>
            <li>
                <span>抽出結果</span>
                <code>{result.frame_count} frames / {html.escape(result.extractor)}</code>
            </li>
        </ul>
    </section>
    """


def relative_path(project_root: Path, path: Path) -> str:
    try:
        return path.resolve().relative_to(project_root.resolve()).as_posix()
    except ValueError:
        return str(path)


def default_project_root() -> Path:
    return Path(__file__).resolve().parents[2]


def build_server(host: str, port: int, project_root: Path) -> AddEchoHTTPServer:
    last_error: OSError | None = None
    for candidate_port in range(port, port + 20):
        try:
            return AddEchoHTTPServer((host, candidate_port), project_root)
        except OSError as exc:
            last_error = exc

    raise RuntimeError(f"localhost のポート {port} から {port + 19} を使用できませんでした。") from last_error


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Start the local Echo Training item-addition UI.")
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--project-root", type=Path, default=default_project_root())
    parser.add_argument("--no-browser", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    server = build_server(args.host, args.port, args.project_root)
    host, port = server.server_address
    url = f"http://{host}:{port}"

    print(f"Echo Training 項目追加 UI: {url}", flush=True)
    print("終了するには Ctrl+C を押してください。", flush=True)

    if not args.no_browser:
        try:
            webbrowser.open(url)
        except Exception:
            pass

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nサーバーを終了しました。", flush=True)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
