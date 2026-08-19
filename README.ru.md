<!-- 🇷🇺 Русский | 🇬🇧 [English](README.md) -->

<div align="center">

# ⌨️ KeyMaster Pro

**Переназначение клавиатуры и мыши, макросы, слои и текстовые расширения для Windows**

[![Лицензия: FCL](https://img.shields.io/badge/Лицензия-FCL-blue.svg)](LICENSE)
[![Платформа: Windows](https://img.shields.io/badge/Платформа-Windows%2010%2F11-0078D4.svg)](https://github.com/zsanya322-maker/keymaster-pro)
[![Стабильная версия](https://img.shields.io/badge/stable-v0.4.1-2f855a.svg)](https://github.com/zsanya322-maker/keymaster-pro/releases/latest)
[![Tauri](https://img.shields.io/badge/Tauri-v2-FFC131.svg)](https://v2.tauri.app)

[📥 Скачать](#скачать) · [✅ Что работает](#что-работает-в-v041) · [🗺️ План](ROADMAP.md) · [📝 История изменений](CHANGELOG.md) · [🐛 Issues](https://github.com/zsanya322-maker/keymaster-pro/issues)

</div>

---

## Что такое KeyMaster Pro?

KeyMaster Pro — настольная Windows-утилита для переназначения и автоматизации ввода, построенная вокруг единой модели:

```text
ТРИГГЕР + УСЛОВИЯ -> ДЕЙСТВИЯ
```

Низкоуровневые Windows-хуки, машины состояний ввода, отслеживание контекста и выполнение правил работают в отдельном **Rust-daemon**. GUI на **Tauri + React** отвечает за профили, правила, макросы и настройки. GUI и daemon общаются через Named Pipes / JSON-RPC.

> **Правило документации:** этот README описывает текущий стабильный релиз. Реально выпущенные изменения находятся в [`CHANGELOG.md`](CHANGELOG.md), оставшаяся работа — в [`ROADMAP.md`](ROADMAP.md).

---

## Что работает в v0.4.1

### Клавиатура и мышь

- **Key Down / Key Up** с полноценными сочетаниями модификаторов `Ctrl`, `Alt`, `Shift`, `Win`.
- Переназначение сочетание → сочетание с корректной обработкой модификаторов.
- Расширенный каталог Windows VK и компактный chord-aware выбор клавиш.
- Кнопки мыши Left, Right, Middle, X1 и X2.
- Вертикальное и горизонтальное колесо мыши.
- Двойной клик.
- Движение мыши с порогом расстояния и cooldown.
- Tap-Hold.
- **Leader-последовательности**.
- Обычные **последовательности клавиш**.
- Одновременные **chord-наборы обычных клавиш**.
- **Жесты мыши** по направлениям.

### Условия и контекст

- активный слой;
- совместимый старый process/title `WindowMatch`;
- структурированный `contextMatch` с режимом **ANY / ALL**;
- имя процесса и путь к executable;
- заголовок и класс окна;
- диапазоны размера окна;
- fullscreen;
- monitor и virtual-desktop identifiers, когда они доступны в нормализованном Windows-контексте.

### Действия

- переназначение клавиатурных сочетаний;
- переназначение кнопок мыши;
- ввод текста и шаблонов;
- запуск именованного макроса из библиотеки профиля;
- Toggle/Hold Layer;
- системная громкость;
- media keys;
- snap/minimize/maximize/close окна;
- запуск приложения;
- фокус процесса/окна;
- сон ПК и выключение монитора.

### Библиотека макросов

В v0.4.1 макросы стали самостоятельными объектами профиля вместо независимых списков шагов, встроенных прямо в каждое правило.

- именованная библиотека макросов для каждого профиля;
- создание, редактирование, поиск, копирование и удаление;
- счётчик использования макроса в правилах;
- защита от удаления используемого макроса;
- правила ссылаются на макрос через `macroId`;
- запись клавиатуры и мыши;
- движение мыши, вертикальный/горизонтальный скролл и абсолютные координаты;
- задержки между шагами и перестановка шагов;
- множитель скорости;
- повтор N раз и repeat-while-held;
- тестовый запуск прямо из редактора;
- остановка/отмена воспроизведения и настраиваемая emergency-stop клавиша;
- отдельная очередь макросов: длинная задержка в макросе не блокирует обычные remap-действия;
- миграция schema v7 переносит старые inline-макросы в библиотеку без случайного объединения независимых макросов.

### Text Expansion

- instant и delimiter режимы;
- настраиваемые разделители и чувствительность к регистру;
- шаблоны `{{date}}`, `{{time}}`, `{{clipboard}}`;
- выбор формата даты и времени;
- чтение буфера обмена только если реально сработал шаблон с `{{clipboard}}`;
- `Ctrl+Z` для отмены последнего подходящего расширения;
- ограниченный буфер только в памяти с очисткой по focus/timeout; история нажатий на диск не пишется.

### Профили, привязки и структура правил

- создание, переименование, копирование, изменение порядка, сохранение, удаление, импорт/экспорт и ручная активация профилей;
- структурированные привязки к приложениям/контексту;
- автоматическое переключение профилей;
- глобальный Auto-switch ON/OFF;
- Manual Profile Lock, чтобы ручной выбор пользователя имел приоритет;
- вложенные папки правил со стабильными ID и порядком;
- enable/disable, folder assignment, order и priority для правил;
- слои с Toggle/Hold и условием Layer Active;
- безопасные schema-aware миграции, backup перед разрушительными изменениями, atomic writes и восстановление повреждённых профилей.

### Интерфейс приложения

- компактная Windows-style оболочка;
- упрощённый редактор правил по блокам **КОГДА / ЕСЛИ / СДЕЛАТЬ**;
- компактные поисковые pickers типов триггеров, условий и действий;
- отдельный раздел **Macro Library**;
- русский и английский интерфейс;
- светлая/тёмная тема;
- tray и автозапуск Windows;
- подписанный встроенный updater через GitHub Releases;
- защита несохранённых изменений при переходах, выходе, перезапуске и обновлении;
- single-instance GUI и усиленный lifecycle/IPC daemon-а.

---

## Текущие ограничения

В v0.4.1 специально **не заявляются как полностью готовые**:

- надёжное определение password/secure fields для Text Expansion во всех браузерах и приложениях;
- отдельный публичный portable ZIP;
- пользовательский UI для backup/restore поверх уже существующих внутренних механизмов сохранности;
- отдельная модель приоритета слоёв помимо порядка/приоритета правил;
- scripting/plugin API, browser automation, cloud sync, AI-функции и marketplace.

Оставшаяся работа после завершённого цикла 0.3.x → 0.4.1 находится в [`ROADMAP.md`](ROADMAP.md).

---

## Preview PR #4: Automation Lab (кандидат 0.5.0)

В этой ветке добавлен первый доведённый вертикальный срез **AI Composer**, локального **MCP bridge** и переносимых пакетов **keymaster-pack v1**. PR намеренно остаётся draft до ручной проверки Windows UI на ветке.

### AI Automation Composer

- OpenAI-compatible endpoint, типизированный draft и обязательный preview/install вместо прямого исполнения ответа модели.
- API key живёт только в поле UI и текущем запросе: KeyMaster **не сохраняет** его в профиль, config/store или логи.
- Обычный `http://` разрешён только для localhost-провайдеров; удалённый endpoint обязан использовать `https://`.
- Provider/network ошибки пересекают Rust boundary как стабильные коды и отображаются на выбранном языке UI.
- Правила и макросы повторно десериализуются и валидируются Rust-daemon по runtime-типам профиля непосредственно перед сохранением.
- Перед каждой установкой создаётся backup профиля; доступна кнопка **Undo install**, а устаревший Undo блокируется после более нового изменения профиля.

### MCP bridge

Локальный stdio MCP server запускается тем же установленным exe:

- `KeyMaster-Pro.exe --mcp` — read-only: чтение профилей/status и валидация правила.
- `KeyMaster-Pro.exe --mcp-write` — отдельный явный opt-in для активации профиля, запуска макроса и записи правила.

Пример локальной stdio-конфигурации для Claude Desktop / Claude Code (по умолчанию используйте `--mcp`):

```json
{
  "mcpServers": {
    "keymaster": {
      "command": "C:\\Program Files\\KeyMaster-Pro\\KeyMaster-Pro.exe",
      "args": ["--mcp"]
    }
  }
}
```

Для Claude Code тот же объект можно хранить в проектном `.mcp.json` либо передать через его MCP config options. Менять аргумент на `--mcp-write` следует только когда осознанно нужен write/execute доступ.

**Граница ChatGPT:** этот PR не пытается подключить локальный stdio-процесс как ChatGPT app/connector. MCP-интеграции OpenAI используют доступный **remote MCP server URL/service connector**, поэтому HTTP transport, аутентификация, внешний доступ и отдельный threat review — самостоятельная задача.

### `keymaster-pack` v1

- переносимый JSON envelope: `format: "keymaster-pack"`, `version: 1`;
- лимит импорта **2 MiB**, проверяемый до чтения файла и повторно после чтения/парсинга;
- локальный inspection показывает permissions и опасные действия до установки;
- UUID macro/layer/folder/rule при импорте генерируются заново, внутренние ссылки перепривязываются;
- dangling references, duplicate IDs, folder cycles, пустые actions и повреждённый payload отклоняются;
- финальный допуск выполняет тот же Rust automation validation/write boundary, что используется AI и MCP;
- установка всегда backup-first и поддерживает Undo.

### Что реально проверяет CI

Windows CI PR #4 запускает frontend unit tests, TypeScript/Vite, Rust check/tests и ESLint, затем отдельный real-process MCP smoke. Smoke job собирает `KeyMaster-Pro.exe`, поднимает настоящий daemon с изолированным `%APPDATA%`, подключается официальным `@modelcontextprotocol/client`, проверяет оба MCP-режима, все семь tools write-режима, запись на диск, физический backup, Undo/stale-Undo protection и конкурентные изменения профиля.

**Не входит в этот PR:** второй слой Hub (diff/conflict detector, каталог с подписями), marketplace/discovery и remote MCP hosting для ChatGPT. К ним не переходим, пока этот вертикальный срез не пройдёт ручной Windows UI QA.

---

## Архитектура

```text
┌──────────────────────────────────┐
│ GUI: Tauri + React/TypeScript    │
│ правила, макросы, профили        │
└────────────────┬─────────────────┘
                 │ Named Pipes / JSON-RPC
┌────────────────▼─────────────────┐
│ Rust daemon                     │
│ compiler + engine + input state │
│ context tracker + macro runtime │
└────────────┬───────────┬─────────┘
             │           │
        keyboard       mouse
        LL hook        LL hook
             │           │
        immediate     macro worker
        simulator     / state machines
```

Основные гарантии v0.4.1:

- только один daemon владеет Named Pipe и input engines;
- неподдерживаемые условия не должны незаметно превращаться в глобальные правила;
- в low-level hook нет медленного file/network I/O;
- advanced triggers обрабатываются ограниченными state machines без случайных долгих sleep в hook path;
- задержки макросов не блокируют immediate remaps;
- миграции обратно совместимы и неразрушительны, future schema отклоняется.

---

## Скачать

### Installer

Откройте [**GitHub Releases**](https://github.com/zsanya322-maker/keymaster-pro/releases/latest) и скачайте Windows installer последнего релиза.

Установленная версия умеет обновляться через встроенный подписанный updater.

### MSI

Release workflow также умеет собирать x64 MSI для сценариев, где удобнее MSI-развёртывание.

### WinGet

В репозитории есть workflow публикации WinGet. Используемый package ID:

```powershell
winget install KeyMasterPro.KeyMasterPro
```

### Portable

Отдельный публичный portable ZIP остаётся в плане. Dev/checkpoint standalone binaries не считаются стабильной portable-дистрибуцией.

---

## Сборка из исходников

### Требования

- Windows 10/11 x64;
- Node.js 22;
- pnpm 9+;
- актуальный stable Rust toolchain (MSVC);
- Visual Studio Build Tools с C++ build tools.

### Команды

```powershell
git clone https://github.com/zsanya322-maker/keymaster-pro.git
cd keymaster-pro
pnpm install
pnpm tauri dev
```

Production build:

```powershell
pnpm tauri build
```

Windows bundles:

```text
src-tauri/target/release/bundle/
```

Проверки release candidate:

```powershell
pnpm build
pnpm lint
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

---

## Завершённый цикл разработки

- **0.3.0** — modifier/key combinations, расширенный key model и nested rule-tree foundation;
- **0.3.1** — завершение mouse triggers и macro playback/control;
- **0.3.2** — profiles, auto-switch/manual lock и richer context matching;
- **0.3.3** — Text Expansion templates, delimiter modes и undo;
- **0.4.0** — Leader Keys, Sequences, ordinary-key Chords и Mouse Gestures;
- **0.4.1** — упрощённый rule UX, first-class Macro Library и schema v7.

Дальнейшая работа ведётся по [`ROADMAP.md`](ROADMAP.md), а не по старому уже выполненному плану.

---

## Разработка / баги

- Bugs: [GitHub Issues](https://github.com/zsanya322-maker/keymaster-pro/issues)
- Roadmap: [`ROADMAP.md`](ROADMAP.md)
- История релизов: [`CHANGELOG.md`](CHANGELOG.md)
- Telegram: [@KeyM_Pro](https://t.me/KeyM_Pro)

Если функция меняет правила или профили, считать её готовой можно только когда согласованы **schema + migration + compiler/runtime + UI + tests**.

---

## Лицензия

KeyMaster Pro распространяется по **Fair Core License (FCL)**. Точные условия и дата conversion указаны в [`LICENSE`](LICENSE).
