import json
from pathlib import Path

translations = {
    "ru": {
        "common": {
            "name": "Название",
            "create": "Создать",
            "reset": "Сброс",
            "advanced": "Дополнительно",
            "saving": "Сохранение…",
        },
        "keyPicker": {
            "modifiers": "Модификаторы",
            "exact_sides": "Различать левый/правый модификатор",
        },
        "tree": {
            "more": "Действия",
            "add": "Добавить",
            "new_folder": "Новая папка",
            "folders": "Папки",
            "disable": "Отключить",
            "enable": "Включить",
            "duplicate": "Дублировать",
            "new_rule_here": "Новое правило здесь",
            "new_subfolder": "Новая подпапка",
            "rename": "Переименовать",
            "rename_folder": "Переименовать папку",
            "delete_folder": "Удалить папку",
            "delete_folder_hint": "Правила и подпапки не удалятся — они будут перемещены на уровень выше.",
            "folder_name": "Название папки",
            "copy_suffix": "— копия",
        },
    },
    "en": {
        "common": {
            "name": "Name",
            "create": "Create",
            "reset": "Reset",
            "advanced": "Advanced",
            "saving": "Saving…",
        },
        "keyPicker": {
            "modifiers": "Modifiers",
            "exact_sides": "Distinguish left/right modifier",
        },
        "tree": {
            "more": "Actions",
            "add": "Add",
            "new_folder": "New folder",
            "folders": "Folders",
            "disable": "Disable",
            "enable": "Enable",
            "duplicate": "Duplicate",
            "new_rule_here": "New rule here",
            "new_subfolder": "New subfolder",
            "rename": "Rename",
            "rename_folder": "Rename folder",
            "delete_folder": "Delete folder",
            "delete_folder_hint": "Rules and subfolders will not be deleted; they will be moved one level up.",
            "folder_name": "Folder name",
            "copy_suffix": "— copy",
        },
    },
}

for locale, values in translations.items():
    path = Path(f"src/i18n/locales/{locale}.json")
    data = json.loads(path.read_text(encoding="utf-8"))
    data.setdefault("common", {}).update(values["common"])
    data.setdefault("keyPicker", {}).update(values["keyPicker"])
    data.setdefault("rules", {})["tree"] = values["tree"]
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

print("v0.3.0 i18n synced")
