<div align="center">

# 🔗 opencode-hashline

**Контентно-адресуемое хеширование строк для точного редактирования кода с помощью AI**

[![CI](https://github.com/izzzzzi/opencode-hashline/actions/workflows/ci.yml/badge.svg)](https://github.com/izzzzzi/opencode-hashline/actions/workflows/ci.yml)
[![Release](https://github.com/izzzzzi/opencode-hashline/actions/workflows/release.yml/badge.svg)](https://github.com/izzzzzi/opencode-hashline/actions/workflows/release.yml)
[![npm version](https://img.shields.io/npm/v/opencode-hashline.svg?style=flat&colorA=18181B&colorB=28CF8D)](https://www.npmjs.com/package/opencode-hashline)
[![npm downloads](https://img.shields.io/npm/dm/opencode-hashline.svg?style=flat&colorA=18181B&colorB=28CF8D)](https://www.npmjs.com/package/opencode-hashline)
[![GitHub release](https://img.shields.io/github/v/release/izzzzzi/opencode-hashline?style=flat&colorA=18181B&colorB=28CF8D)](https://github.com/izzzzzi/opencode-hashline/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat&colorA=18181B&colorB=28CF8D)](LICENSE)
[![semantic-release](https://img.shields.io/badge/semantic--release-auto-e10079?style=flat&colorA=18181B)](https://github.com/semantic-release/semantic-release)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?style=flat&colorA=18181B&colorB=3178C6)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-ESM-green?style=flat&colorA=18181B&colorB=339933)](https://nodejs.org/)

**🇷🇺 Русский** | [🇬🇧 English](README.en.md)

<br />

*Hashline-плагин для [OpenCode](https://github.com/anomalyco/opencode) — аннотирует каждую строку файла детерминированным хеш-тегом, чтобы AI мог ссылаться на код и редактировать его с хирургической точностью.*

</div>

---

## 📖 Что такое Hashline?

Hashline аннотирует каждую строку файла коротким детерминированным hex-хешем. Когда AI читает файл, он видит:

```
#HL 1:a3f|function hello() {
#HL 2:f1c|  return "world";
#HL 3:0e7|}
```

> **Примечание:** Длина хеша адаптивная — она зависит от размера файла (2 символа для ≤256 строк, 3 символа для ≤4096 строк, 4 символа для >4096 строк). В примерах ниже используются 3-символьные хеши. Префикс `#HL ` защищает от ложных срабатываний при удалении хешей и является настраиваемым.

AI-модель может ссылаться на строки по их хеш-тегам для точного редактирования:

- **«Заменить строку `2:f1c`»** — указать конкретную строку однозначно
- **«Заменить блок от `1:a3f` до `3:0e7`»** — указать диапазон строк
- **«Вставить после `3:0e7`»** — вставить в точное место

### 🤔 Почему это помогает?

Hashline решает фундаментальные проблемы двух существующих подходов к редактированию файлов AI:

- **`str_replace`** требует абсолютно точного совпадения `old_string`. Любой лишний пробел, неверный отступ или дублирующиеся строки в файле — и редактирование завершается ошибкой «String to replace not found». Это настолько распространённая проблема, что у неё есть [мегатред на 27+ тикетов на GitHub](https://github.com/anthropics/claude-code/issues).
- **`apply_patch`** (unified diff) работает только на моделях, специально обученных этому формату. На других моделях результаты катастрофические: Grok 4 проваливает **50.7%** патчей, GLM-4.7 — **46.2%** ([источник](https://habr.com/ru/companies/bothub/news/995986/)).

Hashline адресует каждую строку уникальным хешем `lineNumber:hash`. Никакого строкового совпадения, никакой зависимости от специального обучения модели — только точная, верифицируемая адресация.

---

## ✨ Возможности

### 📏 Адаптивная длина хеша

Длина хеша автоматически адаптируется к размеру файла для минимизации коллизий:

| Размер файла | Длина хеша | Возможных значений |
|-------------|:----------:|:------------------:|
| ≤ 256 строк | 2 hex-символа | 256 |
| ≤ 4 096 строк | 3 hex-символа | 4 096 |
| > 4 096 строк | 4 hex-символа | 65 536 |

### 🏷️ Магический префикс (`#HL `)

Строки аннотируются настраиваемым префиксом (по умолчанию: `#HL `), чтобы предотвратить ложные срабатывания при удалении хешей. Это гарантирует, что строки данных вроде `1:ab|some data` не будут случайно обрезаны.

```
#HL 1:a3|function hello() {
#HL 2:f1|  return "world";
#HL 3:0e|}
```

Префикс можно настроить или отключить для обратной совместимости:

```typescript
// Кастомный префикс
const hl = createHashline({ prefix: ">> " });

// Отключить префикс (legacy-формат: "1:a3|code")
const hl = createHashline({ prefix: false });
```

### 💾 LRU-кеширование

Встроенный LRU-кеш (`filePath → annotatedContent`) с настраиваемым размером (по умолчанию 100 файлов). При повторном чтении того же файла с неизменённым содержимым возвращается кешированный результат. Кеш автоматически инвалидируется при изменении содержимого файла.

### ✅ Верификация хешей

Проверка того, что строка не изменилась с момента чтения — защита от race conditions:

```typescript
import { verifyHash } from "opencode-hashline";

const result = verifyHash(2, "f1c", currentContent);
if (!result.valid) {
  console.error(result.message); // "Hash mismatch at line 2: ..."
}
```

Верификация хешей использует длину предоставленной хеш-ссылки (а не текущий размер файла), поэтому ссылка вроде `2:f1` остаётся валидной даже если файл вырос.

### 🔒 Ревизия файла (`fileRev`)

Помимо построчных хешей, hashline вычисляет хеш всего файла (FNV-1a, 8 hex-символов). Он добавляется первой строкой аннотации:

```
#HL REV:72c4946c
#HL 1:a3f|function hello() {
#HL 2:f1c|  return "world";
```

При редактировании передайте `fileRev` в `hashline_edit` — если файл изменился с момента чтения, правка будет отклонена с ошибкой `FILE_REV_MISMATCH`.

### 🔄 Safe Reapply

Если строка переместилась (например, из-за вставки строк выше), `safeReapply` находит её по хешу контента:

- **1 кандидат** — правка применяется к новой позиции
- **>1 кандидатов** — ошибка `AMBIGUOUS_REAPPLY` (неоднозначность)
- **0 кандидатов** — ошибка `HASH_MISMATCH`

```typescript
const result = applyHashEdit(
  { operation: "replace", startRef: "1:a3f", replacement: "new" },
  content,
  undefined,
  true, // safeReapply
);
```

### 🏷️ Structured Errors

Все ошибки hashline — экземпляры `HashlineError` с кодом, диагностикой и подсказками:

| Код | Описание |
|-----|----------|
| `HASH_MISMATCH` | Содержимое строки изменилось |
| `FILE_REV_MISMATCH` | Файл модифицирован с момента чтения |
| `AMBIGUOUS_REAPPLY` | Несколько кандидатов при safe reapply |
| `TARGET_OUT_OF_RANGE` | Номер строки за пределами файла |
| `INVALID_REF` | Некорректная хеш-ссылка |
| `INVALID_RANGE` | Начало диапазона после конца |
| `MISSING_REPLACEMENT` | Операция replace/insert без содержимого |

### 🔍 Чувствительность к отступам

Вычисление хеша использует `trimEnd()` (а не `trim()`), поэтому изменения ведущих пробелов (отступов) обнаруживаются как изменения содержимого, а завершающие пробелы игнорируются.

### 📐 Range-операции

Резолвинг и замена диапазонов строк по хеш-ссылкам:

```typescript
import { resolveRange, replaceRange } from "opencode-hashline";

// Получить строки между двумя хеш-ссылками
const range = resolveRange("1:a3f", "3:0e7", content);
console.log(range.lines); // ["function hello() {", '  return "world";', "}"]

// Заменить диапазон новым содержимым
const newContent = replaceRange(
  "1:a3f", "3:0e7", content,
  "function goodbye() {\n  return 'farewell';\n}"
);
```

### ⚙️ Конфигурируемость

Создание кастомных экземпляров Hashline с определёнными настройками:

```typescript
import { createHashline } from "opencode-hashline";

const hl = createHashline({
  exclude: ["**/node_modules/**", "**/*.min.js"],
  maxFileSize: 512_000,  // 512 КБ
  hashLength: 3,         // принудительно 3-символьные хеши
  cacheSize: 200,        // кешировать до 200 файлов
  prefix: "#HL ",        // магический префикс (по умолчанию)
});

// Использование настроенного экземпляра
const annotated = hl.formatFileWithHashes(content, "src/app.ts");
const isExcluded = hl.shouldExclude("node_modules/foo.js"); // true
```

#### Параметры конфигурации

| Параметр | Тип | По умолчанию | Описание |
|----------|-----|:------------:|----------|
| `exclude` | `string[]` | См. ниже | Glob-паттерны для исключения файлов |
| `maxFileSize` | `number` | `1_000_000` | Макс. размер файла в байтах |
| `hashLength` | `number \| undefined` | `undefined` (адаптивно) | Принудительная длина хеша |
| `cacheSize` | `number` | `100` | Макс. файлов в LRU-кеше |
| `prefix` | `string \| false` | `"#HL "` | Префикс строки (`false` для отключения) |
| `fileRev` | `boolean` | `true` | Включать ревизию файла (`#HL REV:...`) в аннотации |
| `safeReapply` | `boolean` | `false` | Автоматический поиск перемещённых строк по хешу |

Паттерны исключения по умолчанию: lock-файлы, `node_modules`, минифицированные файлы, бинарные файлы (изображения, шрифты, архивы и т.д.).

---

## 📦 Установка

```bash
npm install opencode-hashline
```

---

## 🔧 Конфигурация

Добавьте плагин в ваш `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-hashline"]
}
```

### Файлы конфигурации

Плагин загружает конфигурацию из следующих мест (в порядке приоритета, более поздние перезаписывают ранние):

| Приоритет | Расположение | Область |
|:---------:|-------------|---------|
| 1 | `~/.config/opencode/opencode-hashline.json` | Глобальная (все проекты) |
| 2 | `<project>/opencode-hashline.json` | Локальная (проект) |
| 3 | Программная конфигурация через `createHashlinePlugin()` | Аргумент фабрики |

Пример `opencode-hashline.json`:

```json
{
  "exclude": ["**/node_modules/**", "**/*.min.js"],
  "maxFileSize": 1048576,
  "hashLength": 0,
  "cacheSize": 100,
  "prefix": "#HL "
}
```

Вот и всё! Плагин автоматически:

| # | Действие | Описание |
|:-:|----------|----------|
| 1 | 📝 **Аннотирует чтение файлов** | При чтении файла AI каждая строка получает `#HL` хеш-префикс |
| 2 | 📎 **Аннотирует `@file` упоминания** | Файлы, прикреплённые через `@filename` в промпте, тоже аннотируются хешлайнами |
| 3 | ✂️ **Убирает хеш-префиксы при редактировании** | При записи/редактировании файла хеш-префиксы удаляются перед применением изменений |
| 4 | 🧠 **Внедряет инструкции в системный промпт** | AI получает инструкции по интерпретации и использованию hashline-ссылок |
| 5 | 💾 **Кеширует результаты** | Повторные чтения того же файла возвращают кешированные аннотации |
| 6 | 🔍 **Фильтрует по инструменту** | Только инструменты чтения файлов (например `read_file`, `cat`, `view`) получают аннотации; остальные не затрагиваются |
| 7 | ⚙️ **Учитывает конфигурацию** | Исключённые файлы и файлы, превышающие `maxFileSize`, пропускаются |
| 8 | 🧩 **Регистрирует `hashline_edit` tool** | Применяет replace/delete/insert по hash-ссылкам без точного `old_string`-матчинга |

---

## 🛠️ Как это работает

### Вычисление хеша

Хеш каждой строки вычисляется из:
- **0-based индекса** строки
- **Содержимого строки** с обрезанными завершающими пробелами (trimEnd) — ведущие пробелы (отступы) ЗНАЧИМЫ

Это подаётся в хеш-функцию **FNV-1a**, сводится к соответствующему модулю в зависимости от размера файла и отображается как hex-строка.

### Хуки и tool плагина

Плагин регистрирует четыре хука OpenCode и один кастомный tool:

| Хук | Назначение |
|-----|-----------|
| `tool.hashline_edit` | Hash-aware правки по ссылкам вроде `5:a3f` или `#HL 5:a3f|...` |
| `tool.execute.after` | Добавляет hashline-аннотации в вывод инструментов чтения файлов |
| `tool.execute.before` | Убирает hashline-префиксы из аргументов инструментов редактирования |
| `chat.message` | Аннотирует `@file` упоминания в сообщениях пользователя (записывает аннотированный контент во временный файл и подменяет URL) |
| `experimental.chat.system.transform` | Добавляет инструкции по использованию hashline в системный промпт |

---

## 🔌 Программный API

Основные утилиты экспортируются из субпути `opencode-hashline/utils` (чтобы избежать конфликтов с загрузчиком плагинов OpenCode, который вызывает каждый экспорт как функцию Plugin):

```typescript
import {
  computeLineHash,
  formatFileWithHashes,
  stripHashes,
  parseHashRef,
  normalizeHashRef,
  buildHashMap,
  getAdaptiveHashLength,
  verifyHash,
  resolveRange,
  replaceRange,
  applyHashEdit,
  HashlineCache,
  createHashline,
  shouldExclude,
  matchesGlob,
  resolveConfig,
  DEFAULT_PREFIX,
} from "opencode-hashline/utils";
```

### Основные функции

```typescript
// Вычислить хеш для одной строки
const hash = computeLineHash(0, "function hello() {"); // например "a3f"

// Вычислить хеш с определённой длиной
const hash4 = computeLineHash(0, "function hello() {", 4); // например "a3f2"

// Аннотировать содержимое файла (адаптивная длина хеша, с префиксом #HL)
const annotated = formatFileWithHashes(fileContent);
// "#HL 1:a3|function hello() {\n#HL 2:f1|  return \"world\";\n#HL 3:0e|}"

// Аннотировать с определённой длиной хеша
const annotated3 = formatFileWithHashes(fileContent, 3);

// Аннотировать без префикса (legacy-формат)
const annotatedLegacy = formatFileWithHashes(fileContent, undefined, false);

// Убрать аннотации, получить оригинальное содержимое
const original = stripHashes(annotated);
```

### Хеш-ссылки и верификация

```typescript
// Разобрать хеш-ссылку
const { line, hash } = parseHashRef("2:f1c"); // { line: 2, hash: "f1c" }

// Нормализовать ссылку из аннотированной строки
const ref = normalizeHashRef("#HL 2:f1c|const x = 1;"); // "2:f1c"

// Построить карту соответствий
const map = buildHashMap(fileContent); // Map<"2:f1c", 2>

// Верифицировать хеш-ссылку (использует hash.length, а не размер файла)
const result = verifyHash(2, "f1c", fileContent);
```

### Range-операции

```typescript
// Резолвить диапазон
const range = resolveRange("1:a3f", "3:0e7", fileContent);

// Заменить диапазон
const newContent = replaceRange("1:a3f", "3:0e7", fileContent, "новое содержимое");

// Hash-aware операция редактирования (replace/delete/insert_before/insert_after)
const edited = applyHashEdit(
  { operation: "replace", startRef: "1:a3f", endRef: "3:0e7", replacement: "новое содержимое" },
  fileContent
).content;
```

### Утилиты

```typescript
// Проверить, нужно ли исключить файл
const excluded = shouldExclude("node_modules/foo.js", ["**/node_modules/**"]);

// Создать настроенный экземпляр
const hl = createHashline({ cacheSize: 50, hashLength: 3 });
```

---

## 📊 Бенчмарк

### Корректность: hashline vs str_replace vs apply_patch

Все три подхода протестированы на **60 фикстурах из [react-edit-benchmark](https://github.com/can1357/oh-my-pi/tree/main/packages/react-edit-benchmark)** — мутированных файлах React с известными багами (инвертированные булевы, перепутанные операторы, удалённые guard-клаузы и т.д.):

| | hashline | str_replace | apply_patch |
|---|:---:|:---:|:---:|
| **Прошло** | **60/60 (100%)** | 58/60 (96.7%) | **60/60 (100%)** |
| **Провалено** | 0 | 2 | 0 |
| **Неоднозначные правки** | 0 | 4 | 0 |

`apply_patch` с контекстными строками работает так же надёжно, как hashline — **при условии, что модель правильно генерирует патч**. Слабое место `apply_patch` — зависимость от обучения конкретной модели: не обученные под этот формат модели производят некорректные diff-ы (пропускают контекст, путают отступы), что приводит к провалу применения патча.

`str_replace` ломается, когда `old_string` встречается в файле несколько раз (повторяющиеся guard-клаузы, похожие блоки кода). Hashline адресует каждую строку уникально через `lineNumber:hash` — неоднозначность исключена, модельный формат не нужен.

```bash
# Запустите сами:
npx tsx benchmark/run.ts               # режим hashline
npx tsx benchmark/run.ts --no-hash     # режим str_replace
npx tsx benchmark/run.ts --apply-patch # режим apply_patch
```

<details>
<summary>Ошибки str_replace (категория structural)</summary>

- `structural-remove-early-return-001` — `old_string` совпал в нескольких местах, замена применена не к тому
- `structural-remove-early-return-002` — аналогичная проблема
- `structural-delete-statement-002` — неоднозначное совпадение (первое совпадение оказалось верным)
- `structural-delete-statement-003` — неоднозначное совпадение (первое совпадение оказалось верным)

</details>

### Расход токенов

Аннотации hashline добавляют префикс `#HL <line>:<hash>|` (~12 символов / ~3 токена) на строку:

| | Без хешей | С хешами | Оверхед |
|---|---:|---:|:---:|
| **Символы** | 404K | 564K | +40% |
| **Токены (~)** | ~101K | ~141K | +40% |

Оверхед стабильно ~40% независимо от размера файла. Для типичного файла на 200 строк (~800 токенов) hashline добавляет ~600 токенов — пренебрежимо мало при контекстном окне в 200K.

### Производительность

| Размер файла | Аннотация | Правка | Удаление хешей |
|-------------:|:---------:|:------:|:--------------:|
| **10** строк | 0.05 мс | 0.01 мс | 0.03 мс |
| **100** строк | 0.12 мс | 0.02 мс | 0.08 мс |
| **1 000** строк | 0.95 мс | 0.04 мс | 0.60 мс |
| **5 000** строк | 4.50 мс | 0.08 мс | 2.80 мс |
| **10 000** строк | 9.20 мс | 0.10 мс | 5.50 мс |

> Типичный файл из 1 000 строк аннотируется за **< 1 мс** — незаметно для пользователя.

---

## 🧑‍💻 Разработка

```bash
# Установить зависимости
npm install

# Запустить тесты
npm test

# Собрать
npm run build

# Проверка типов
npm run typecheck
```

---

## 💡 Вдохновение и теоретическая база

Идея hashline вдохновлена концепциями из **oh-my-pi** от [can1357](https://github.com/can1357/oh-my-pi) — AI-тулкита для разработки (coding agent CLI, unified LLM API, TUI-библиотеки) — и статьи «The Harness Problem» (проблема обвязки).

**Суть проблемы:** современные AI-модели обладают огромными возможностями, но инструменты (harness), которые передают модели контекст и применяют её правки к файлам, теряют информацию и порождают ошибки. Модель видит содержимое файла, но при редактировании вынуждена «угадывать» контекст окружающих строк. Search-and-replace ломается на дубликатах строк, а diff-формат тоже ненадёжен на практике.

Hashline решает эту проблему, присваивая каждой строке короткий детерминированный хеш-тег (например, `2:f1c`), что делает адресацию строк **точной и однозначной**. Модель может ссылаться на любую строку или диапазон без ошибок смещения и путаницы с дубликатами.

Продвинутые фичи — **ревизия файла** (`fileRev`), **safe reapply** и **structured errors** — вдохновлены реализацией hash-based editing в проекте **AssistAgents** от [OzeroHAX](https://github.com/OzeroHAX/AssistAgents), который независимо применил аналогичный подход для OpenCode с дополнительными механизмами проверки целостности и диагностики ошибок.

**Ссылки:**
- [oh-my-pi от can1357](https://github.com/can1357/oh-my-pi) — AI-тулкит для разработки: coding agent CLI, unified LLM API, TUI-библиотеки
- [The Harness Problem](https://blog.can.ac/2026/02/12/the-harness-problem/) — блог-пост с подробным описанием проблемы
- [AssistAgents от OzeroHAX](https://github.com/OzeroHAX/AssistAgents) — hash-based editing для OpenCode с file revision, safe reapply и structured conflicts
- [Статья на Хабре](https://habr.com/ru/companies/bothub/news/995986/) — описание подхода на русском языке

---

## 📄 Лицензия

[MIT](LICENSE) © opencode-hashline contributors
