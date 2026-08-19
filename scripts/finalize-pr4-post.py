from pathlib import Path

path = Path('src-tauri/src/gui/ai.rs')
text = path.read_text(encoding='utf-8')
text = text.replace(
    "let detail = detail.as_ref().replace(['\\r', '\\n'], \" \");",
    "let detail = detail.as_ref().replace('\\r', \" \").replace('\\n', \" \");",
)
path.write_text(text, encoding='utf-8')
