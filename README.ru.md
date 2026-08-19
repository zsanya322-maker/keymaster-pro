<!-- 🇷🇺 Русский | 🇬🇧 [English](README.md) -->

<div align="center">

# ⌨️ KeyMaster Pro

**Переназначение клавиатуры и мыши, макросы, слои, Text Expansion и AI-автоматизация для Windows**

[![Лицензия: FCL](https://img.shields.io/badge/Лицензия-FCL-blue.svg)](LICENSE)
[![Платформа: Windows](https://img.shields.io/badge/Платформа-Windows%2010%2F11-0078D4.svg)](https://github.com/zsanya322-maker/keymaster-pro)
[![Стабильная версия](https://img.shields.io/badge/stable-v0.5.1-2f855a.svg)](https://github.com/zsanya322-maker/keymaster-pro/releases/latest)
[![Tauri](https://img.shields.io/badge/Tauri-v2-FFC131.svg)](https://v2.tauri.app)

[📥 Скачать](#скачать) · [✅ Что работает](#что-работает-в-v051) · [🤖 Automation Lab](#automation-lab) · [🗺️ План](ROADMAP.md) · [📝 История изменений](CHANGELOG.md) · [🐛 Issues](https://github.com/zsanya322-maker/keymaster-pro/issues)

</div>

---

## Что такое KeyMaster Pro?

KeyMaster Pro — настольная Windows-утилита для переназначения и автоматизации ввода, построенная вокруг единой модели:

```text
ТРИГГЕР + УСЛОВИЯ -> ДЕЙСТВИЯ
```

Низкоуровневые Windows-хуки, машины состояний ввода, отслеживание контекста, выполнение макросов и безопасная запись профилей работают в **Rust-daemon**. GUI построен на **Tauri + React/TypeScript**. GUI и daemon общаются через Named Pipes / JSON-RPC.

> **Правило документации:** этот README описывает текущий стабильный релиз. Реально выпущенные изменения находятся в [`CHANGELOG.md`](CHANGELOG.md), оставшаяся работа — в [`ROADMAP.md`](ROADMAP.md).

---

## Что работает в v0.5.1

### Клавиатура и мышь

- Key Down / Key Up с сочетаниями `Ctrl`, `Alt`, `Shift`, `Win`.
- Переназначение сочетание → сочетание.
- Расширенный каталог Windows VK и chord-aware picker.
- Left / Right / Middle / X1 / X2 кнопки мыши.
- Вертикальное и горизонтальное колесо.
- Двойной клик и движение мыши.
- Tap-Hold.
- Leader Sequence.
- Обычные последовательности клавиш.
- Одновременные chord-наборы обычных клавиш.
- Направленные жесты мыши.

### Условия и контекст

- активный слой;
- process/title matching;
- структурированный `contextMatch` с ANY / ALL;
- имя процесса и путь к executable;
- заголовок и класс окна;
- диапазоны размеров окна;
- fullscreen;
- monitor и virtual-desktop identifiers, когда они доступны в нормализованном Windows-контексте.

### Действия

- переназначение клавиатурных сочетаний и поддерживаемых кнопок мыши;
- ввод текста и шаблонов;
- запуск именованных макросов;
- Toggle/Hold Layer;
- системная громкость и media keys;
- snap/minimize/maximize/close окна;
- запуск приложений;
- фокус процесса/окна;
- сон ПК и выключение монитора.

### Macro Library

Макросы являются самостоятельными объектами профиля, а правила ссылаются на них через `macroId`.

- создание, редактирование, копирование, поиск и удаление;
- счётчик использования и защита от удаления используемого макроса;
- запись клавиатуры и мыши;
- движение мыши, вертикальный/горизонтальный скролл и абсолютные координаты;
- редактируемые задержки и перестановка шагов;
- скорость, repeat count и repeat-while-held;
- preview/test playback;
- stop/cancel и настраиваемая emergency-stop клавиша;
- отдельная очередь макросов, чтобы задержки внутри макросов не блокировали обычные remap-действия.

### Text Expansion

- instant и delimiter режимы;
- настраиваемые разделители и чувствительность к регистру;
- шаблоны `{{date}}`, `{{time}}`, `{{clipboard}}`;
- выбор формата даты и времени;
- чтение clipboard только если реально сработал шаблон с `{{clipboard}}`;
- `Ctrl+Z` для отмены последнего подходящего расширения;
- ограниченный буфер только в памяти с очисткой по focus/timeout; история нажатий на диск не пишется.

### Профили, правила и слои

- создание, переименование, копирование, изменение порядка, сохранение, удаление, импорт/экспорт и активация профилей;
- структурированные привязки к приложениям/контексту;
- автоматическое переключение профилей;
- глобальный Auto-switch ON/OFF и Manual Profile Lock;
- вложенные папки правил со стабильными ID и порядком;
- enable/disable, folder assignment, order и priority для правил;
- слои с Toggle/Hold и условием Layer Active;
- schema-aware миграции, backup, atomic writes и восстановление повреждённых профилей.

### Интерфейс приложения

- компактная Windows-style оболочка;
- редактор правил по блокам **КОГДА / ЕСЛИ / СДЕЛАТЬ**;
- компактные поисковые pickers типов триггеров, условий и действий;
- отдельный раздел Macro Library;
- русский и английский интерфейс;
- светлая/тёмная тема;
- tray и автозапуск Windows;
- подписанный встроенный updater через GitHub Releases;
- защита несохранённых изменений при переходах, выходе, перезапуске и обновлении;
- single-instance GUI и усиленный lifecycle/IPC daemon-а.

---

## Automation Lab

v0.5.0 добавил первый рабочий вертикальный срез Automation Lab. В v0.5.1 исправлен реальный Windows UX после ручной проверки.

### AI Automation Composer

KeyMaster умеет создавать через OpenAI-compatible провайдера **черновик** правил/макросов. Ответ модели сам по себе ничего не устанавливает: запись в профиль происходит только после явного подтверждения.

- AI-провайдер настраивается один раз в **Настройки → AI-провайдеры**.
- В профиле сохраняются название, endpoint и model.
- API key хранится отдельно в **Windows Credential Manager**, а не открытым текстом в profile/config JSON.
- При редактировании провайдера пустое поле ключа означает «оставить уже сохранённый ключ».
- Composer использует выбранный сохранённый AI-профиль; вставлять ключ заново при каждом запросе или после перезапуска не нужно.
- Обычный `http://` разрешён только для localhost-провайдеров; удалённый endpoint обязан использовать `https://`.
- Provider/network ошибки передаются через Rust boundary как стабильные коды и локализуются в EN/RU.
- Сгенерированный результат явно помечен как **черновик / ещё не установлен**.
- Prompt и generated draft сохраняются при переходе из Automation Lab в другой раздел и обратно в пределах текущего запуска приложения.
- Правила и макросы повторно десериализуются и валидируются Rust-daemon непосредственно перед записью.
- Перед установкой создаётся backup и receipt для Undo.
- После успешной установки AI-черновика KeyMaster перезагружает профиль и сразу открывает **Правила**, чтобы новые правила были видны.

Пример профиля для Groq-compatible API:

```text
Название: Groq
Endpoint: https://api.groq.com/openai/v1
Model:    <ID нужной OpenAI-compatible модели Groq>
API key:  один раз сохраняется в Windows Credential Manager
```

### MCP bridge

Локальный stdio MCP server запускается тем же установленным exe:

- `KeyMaster-Pro.exe --mcp` — read-only: чтение профилей/status и валидация правила.
- `KeyMaster-Pro.exe --mcp-write` — отдельный явный opt-in для активации профиля, запуска макроса и записи правила.

Пример локальной stdio-конфигурации для Claude Desktop / Claude Code:

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

Использовать `--mcp-write` следует только когда действительно нужен write/execute доступ.

Сейчас локальный bridge предоставляет семь tools: список/чтение профилей, runtime status, валидацию правила, активацию профиля, запуск макроса и установку правила. Записи проходят через тот же canonical Rust automation boundary, что и GUI.

**Граница ChatGPT:** выпущенный bridge — локальный stdio. Remote MCP hosting/authentication для ChatGPT остаётся отдельной будущей задачей.

### `keymaster-pack` v1

Переносимые пакеты Automation Lab используют envelope:

```json
{
  "format": "keymaster-pack",
  "version": 1
}
```

Правила безопасности:

- лимит импорта **2 MiB**, проверяемый до и после чтения/парсинга;
- inspection показывает permissions и опасные действия до установки;
- UUID macro/layer/folder/rule генерируются заново, внутренние ссылки перепривязываются;
- duplicate IDs, dangling references, folder cycles, пустые actions и повреждённый payload отклоняются;
- финальный допуск выполняет тот же Rust validation/write boundary, что используется AI и MCP;
- установка всегда backup-first и поддерживает Undo.

---

## Проверка релиза

Windows CI для v0.5.1 прогоняет:

```text
Vitest frontend tests
TypeScript + Vite build
cargo check --all-targets --locked
cargo test --locked
ESLint
real-process MCP stdio smoke
```

MCP smoke собирает реальный KeyMaster executable, запускает daemon в изолированном `%APPDATA%`, подключается официальным MCP client и проверяет read-only/write режимы, все семь tools, запись на диск, backup/Undo safety и конкурентные изменения профиля.

---

## Текущие ограничения

В v0.5.1 специально **не заявляются как полностью готовые**:

- надёжное определение password/secure fields для Text Expansion во всех браузерах и приложениях;
- отдельный публичный portable ZIP;
- полноценный пользовательский backup-browser/restore center поверх текущих backup + Automation Lab Undo safeguards;
- отдельная модель приоритета слоёв помимо порядка/приоритета правил;
- general scripting/plugin API и browser automation;
- cloud sync/account infrastructure;
- remote MCP hosting для ChatGPT;
- второй слой Automation Hub: diff/conflict detector, signed catalog/marketplace и discovery.

Оставшаяся работа находится в [`ROADMAP.md`](ROADMAP.md).

---

## Архитектура

```text
┌──────────────────────────────────┐
│ GUI: Tauri + React/TypeScript    │
│ rules, macros, profiles, AI Lab │
└────────────────┬─────────────────┘
                 │ Named Pipes / JSON-RPC
┌────────────────▼─────────────────┐
│ Rust daemon                     │
│ compiler + engine + input state │
│ context + macro + safe writes   │
└────────────┬───────────┬─────────┘
             │           │
        keyboard       mouse
        LL hook        LL hook
             │           │
        immediate     macro worker
        simulator     / state machines
```

Основные гарантии:

- только один daemon владеет Named Pipe и input engines;
- неподдерживаемые условия не должны fail-open;
- в low-level hook нет медленного file/network I/O;
- advanced input state machines имеют явные границы;
- macro delays не блокируют immediate remaps;
- изменения профиля сериализуются и валидируются перед записью;
- миграции остаются backward-compatible и неразрушительными.

---

## Скачать

### Installer — рекомендуется

Откройте [**GitHub Releases**](https://github.com/zsanya322-maker/keymaster-pro/releases/latest) и скачайте Windows installer последнего релиза.

Установленное приложение умеет обновляться через встроенный подписанный updater.

### MSI

Release workflow также умеет собирать x64 MSI.

### WinGet

```powershell
winget install KeyMasterPro.KeyMasterPro
```

### Portable build

Отдельный публичный portable ZIP пока запланирован. Dev/checkpoint standalone binaries не считаются стабильной portable-дистрибуцией.

---

## Сборка из исходников

### Требования

- Windows 10/11 x64;
- Node.js 22 рекомендуется;
- pnpm 9+;
- актуальный stable Rust toolchain (MSVC target);
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

Windows bundles создаются в:

```text
src-tauri/target/release/bundle/
```

---

## Приватность и обработка ввода

KeyMaster Pro использует low-level keyboard/mouse hooks для переназначения ввода. Такие API могут использоваться и кейлоггерами, поэтому security software иногда относится к этому классу программ осторожно.

KeyMaster обрабатывает события ввода в памяти для matching/remapping и намеренно не пишет историю нажатий на диск. Text Expansion хранит только ограниченный in-memory buffer. Профили и настройки остаются локальными. API keys AI-провайдеров хранятся отдельно через Windows Credential Manager. Встроенный updater обращается к GitHub Releases при проверке/загрузке обновлений.

---

## История разработки / roadmap

Завершённая основная последовательность:

- **0.3.0** — modifier/key combinations, расширенная key model и nested rule-tree foundation;
- **0.3.1** — mouse triggers и macro playback/control;
- **0.3.2** — profiles, auto-switch/manual lock и rich context matching;
- **0.3.3** — Text Expansion templates, delimiter modes и undo;
- **0.4.0** — Leader Keys, Sequences, ordinary-key Chords и Mouse Gestures;
- **0.4.1** — упрощённый rule UX, first-class Macro Library и schema v7;
- **0.5.0** — Automation Lab, AI Composer, local MCP bridge и `keymaster-pack` v1;
- **0.5.1** — сохранение AI provider profiles/API keys и исправления Composer navigation/install UX.

Будущая работа находится в [`ROADMAP.md`](ROADMAP.md).

---

## Участие / баги

- Баги: [GitHub Issues](https://github.com/zsanya322-maker/keymaster-pro/issues)
- План: [`ROADMAP.md`](ROADMAP.md)
- Выпущенные изменения: [`CHANGELOG.md`](CHANGELOG.md)
- Telegram: [@KeyM_Pro](https://t.me/KeyM_Pro)

Если функция меняет правила или профили, считать её завершённой можно только когда согласованы **schema + migration + compiler/runtime + UI + tests**. Один UI-control сам по себе не делает функцию готовой.

---

## Лицензия

KeyMaster Pro распространяется по **Fair Core License (FCL)**. Точные условия и conversion date находятся в [`LICENSE`](LICENSE).
