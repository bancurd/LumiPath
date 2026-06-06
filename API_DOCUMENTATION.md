# LumiPath API 接口文档

> 文档日期：2026-06-06  
> 后端框架：FastAPI  
> 数据存储：SQLite  
> 默认 API 地址：`http://127.0.0.1:8938`  
> 前端开发地址：`http://127.0.0.1:5317`

## 1. 接口说明

LumiPath 后端提供用户认证、每日打卡、已学单词、SRS 选词、复习结果和错题本等接口。

开发环境中，前端通过 Vite 代理访问接口：

```text
/api/* -> http://127.0.0.1:8938/api/*
```

因此前端代码可以直接请求 `/api/auth/login`、`/api/checkins` 等相对路径。

## 2. 启动方式

### 同时启动前后端

```bash
npm run dev
```

### 单独启动后端

```bash
npm run dev:api
```

### 单独启动前端

```bash
npm run dev:web
```

## 3. 认证方式

除健康检查、注册、登录接口外，其余接口都需要登录态。

登录或注册成功后，接口会返回 `token`。后续请求需要在 Header 中携带：

```http
Authorization: Bearer <token>
```

示例：

```http
GET /api/checkins HTTP/1.1
Host: 127.0.0.1:8938
Authorization: Bearer your-session-token
```

## 4. 通用响应与错误

### 成功响应

成功响应统一使用 JSON，具体字段由接口决定。

### 常见错误

| 状态码 | 场景 |
| --- | --- |
| `401` | 缺少 token、token 无效或 token 已过期 |
| `409` | 注册时账户已存在 |
| `422` | 请求参数格式错误或字段校验失败 |
| `500` | 服务端异常 |

FastAPI 默认错误格式示例：

```json
{
  "detail": "Missing session token."
}
```

## 5. 数据结构

### User

```json
{
  "id": 1,
  "username": "leo",
  "displayName": "Leo",
  "token": "session-token"
}
```

字段说明：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | number | 用户 ID |
| `username` | string | 归一化后的用户名，用于唯一判断 |
| `displayName` | string | 用户展示昵称 |
| `token` | string | 登录 session token，仅登录/注册接口返回 |

### Checkin

```json
{
  "date": "2026-06-06",
  "learnedWords": 10,
  "source": "daily-vocabulary"
}
```

字段说明：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `date` | string | 打卡日期，格式为 `YYYY-MM-DD` |
| `learnedWords` | number | 当天学习单词数量 |
| `source` | string | 来源，目前为 `daily-vocabulary` |

### LearnedWord

```json
{
  "wordId": 12,
  "firstLearnedAt": "2026-06-06 08:30:00",
  "lastSeenAt": "2026-06-06 08:35:00",
  "exposures": 2,
  "masteredCount": 2,
  "source": "daily-vocabulary"
}
```

字段说明：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `wordId` | number | 单词 ID，对应 `src/data/vocabulary.json` |
| `firstLearnedAt` | string | 首次学习时间 |
| `lastSeenAt` | string | 最近学习时间 |
| `exposures` | number | 曝光次数 |
| `masteredCount` | number | 掌握次数 |
| `source` | string | 学习来源 |

### WrongAnswer

```json
{
  "wordId": 18,
  "mistakes": 3,
  "resolvedStreak": 1,
  "lastWrongAt": "2026-06-06T08:40:00.000000+00:00",
  "modes": ["看中文选英文", "挑战模式 难度2"],
  "lastSelected": "错误选项"
}
```

字段说明：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `wordId` | number | 错题单词 ID |
| `mistakes` | number | 累计答错次数 |
| `resolvedStreak` | number | 连续练对次数，达到 3 次后自动移出错题本 |
| `lastWrongAt` | string | 最近答错时间，ISO 字符串 |
| `modes` | string[] | 出错模式列表 |
| `lastSelected` | string/null | 上次误选内容 |

## 6. 接口详情

## 6.1 健康检查

### `GET /api/health`

用于检查后端服务是否正常运行。

认证：不需要

请求示例：

```bash
curl http://127.0.0.1:8938/api/health
```

响应示例：

```json
{
  "ok": true,
  "service": "lumipath-api",
  "storage": "sqlite",
  "framework": "fastapi",
  "dbPath": "C:\\Users\\25461\\Documents\\LumiPath\\data\\lumipath.sqlite"
}
```

## 6.2 注册账户

### `POST /api/auth/register`

创建新用户，并返回登录 token。

认证：不需要

请求体：

```json
{
  "displayName": "Leo",
  "password": "123456"
}
```

字段校验：

| 字段 | 类型 | 必填 | 规则 |
| --- | --- | --- | --- |
| `displayName` | string | 是 | 长度至少 1 |
| `password` | string | 是 | 长度至少 4 |

响应示例：

```json
{
  "user": {
    "id": 1,
    "username": "leo",
    "displayName": "Leo",
    "token": "generated-session-token"
  }
}
```

可能错误：

| 状态码 | 说明 |
| --- | --- |
| `409` | 账户已存在 |
| `422` | 昵称或密码不符合校验规则 |

## 6.3 登录账户

### `POST /api/auth/login`

使用昵称和密码登录，并返回登录 token。

认证：不需要

请求体：

```json
{
  "displayName": "Leo",
  "password": "123456"
}
```

响应示例：

```json
{
  "user": {
    "id": 1,
    "username": "leo",
    "displayName": "Leo",
    "token": "generated-session-token"
  }
}
```

可能错误：

| 状态码 | 说明 |
| --- | --- |
| `401` | 账户不存在或密码错误 |
| `422` | 请求体字段不符合校验规则 |

## 6.4 获取打卡记录

### `GET /api/checkins`

获取当前登录用户的所有打卡记录，按日期升序排列。

认证：需要

请求示例：

```bash
curl http://127.0.0.1:8938/api/checkins \
  -H "Authorization: Bearer generated-session-token"
```

响应示例：

```json
{
  "checkins": [
    {
      "date": "2026-06-05",
      "learnedWords": 10,
      "source": "daily-vocabulary"
    },
    {
      "date": "2026-06-06",
      "learnedWords": 10,
      "source": "daily-vocabulary"
    }
  ]
}
```

## 6.5 提交今日打卡

### `POST /api/checkins/today`

提交当天学习结果。如果当天已打卡，会更新当天记录。

认证：需要

请求体：

```json
{
  "learnedWords": 10,
  "wordIds": [1, 2, 3, 4, 5]
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `learnedWords` | number | 否 | 学习数量，默认值为 `12`，后端最小按 `1` 处理 |
| `wordIds` | number[] | 否 | 本次学习过的单词 ID |

处理逻辑：

- 写入或更新当天 `checkins` 记录。
- 将 `wordIds` 写入 `learned_words`。
- 对每个 `wordId` 写入一次 `good` 复习结果，更新 SRS 状态。

响应示例：

```json
{
  "checkin": {
    "date": "2026-06-06",
    "learnedWords": 10,
    "source": "daily-vocabulary"
  },
  "message": "Daily vocabulary learning completed."
}
```

## 6.6 获取已学单词

### `GET /api/learned-words`

获取当前用户已学习过的单词记录，按最近学习时间倒序排列。

认证：需要

响应示例：

```json
{
  "learnedWords": [
    {
      "wordId": 3,
      "firstLearnedAt": "2026-06-05 10:00:00",
      "lastSeenAt": "2026-06-06 10:00:00",
      "exposures": 2,
      "masteredCount": 2,
      "source": "daily-vocabulary"
    }
  ]
}
```

## 6.7 获取每日学习词

### `GET /api/words/daily`

根据当前用户的 SRS 状态获取每日学习词 ID。

认证：需要

Query 参数：

| 参数 | 类型 | 必填 | 默认值 | 范围 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `count` | number | 否 | `10` | `1-30` | 需要返回的单词数量 |

请求示例：

```bash
curl "http://127.0.0.1:8938/api/words/daily?count=10" \
  -H "Authorization: Bearer generated-session-token"
```

响应示例：

```json
{
  "wordIds": [1, 8, 15, 22, 31, 46, 57, 63, 78, 91],
  "strategy": "srs-daily"
}
```

选词策略：

- 优先选择已经到期的复习词。
- 然后选择错误较多或仍在学习中的薄弱词。
- 最后补充用户未学过的新词。
- 如果数量不足，从完整词库中随机补齐。

## 6.8 获取练习词

### `GET /api/words/practice`

根据当前用户的 SRS 状态获取练习模式使用的单词 ID。

认证：需要

Query 参数：

| 参数 | 类型 | 必填 | 默认值 | 范围 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `count` | number | 否 | `10` | `1-30` | 需要返回的单词数量 |

响应示例：

```json
{
  "wordIds": [2, 6, 17, 29, 36, 44, 55, 69, 70, 88],
  "strategy": "srs-practice"
}
```

## 6.9 提交复习结果

### `POST /api/words/review-result`

提交某个单词的复习结果，并更新用户的 SRS 状态。练习模式下，如果错题连续练对 3 次，会自动从错题本移除。

认证：需要

请求体：

```json
{
  "wordId": 18,
  "grade": "good",
  "source": "practice"
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `wordId` | number | 是 | 单词 ID |
| `grade` | string | 是 | 复习结果，可选 `again`、`hard`、`good`、`easy` |
| `source` | string | 否 | 来源，默认 `practice` |

`grade` 含义：

| 值 | 含义 | 对 SRS 的影响 |
| --- | --- | --- |
| `again` | 答错或需要重学 | 错误次数 +1，连续正确清零，间隔重置为 1 天 |
| `hard` | 答对但困难 | 正确次数 +1，轻微降低难度系数 |
| `good` | 正常答对 | 正确次数 +1，按当前难度系数延长间隔 |
| `easy` | 很容易 | 正确次数 +1，提高难度系数并延长间隔 |

响应示例：

```json
{
  "ok": true,
  "graduatedWrongAnswer": false
}
```

字段说明：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `ok` | boolean | 是否处理成功 |
| `graduatedWrongAnswer` | boolean | 是否因为连续练对而自动移出错题本 |

## 6.10 获取错题本

### `GET /api/wrong-answers`

获取当前用户的错题记录，按错误次数和最近错误时间排序。

认证：需要

响应示例：

```json
{
  "wrongAnswers": [
    {
      "wordId": 18,
      "mistakes": 3,
      "resolvedStreak": 1,
      "lastWrongAt": "2026-06-06T08:40:00.000000+00:00",
      "modes": ["看中文选英文"],
      "lastSelected": "ability"
    }
  ]
}
```

## 6.11 记录错题

### `POST /api/wrong-answers`

记录一次错题。如果同一个用户已经存在同一个 `wordId` 的错题记录，则增加错误次数并更新最近错误信息。

认证：需要

请求体：

```json
{
  "wordId": 18,
  "mode": "看中文选英文",
  "selectedText": "ability"
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `wordId` | number | 是 | 错题单词 ID |
| `mode` | string | 是 | 出错模式，长度至少 1 |
| `selectedText` | string/null | 否 | 用户误选内容 |

响应示例：

```json
{
  "wrongAnswer": {
    "wordId": 18,
    "mistakes": 4,
    "resolvedStreak": 0,
    "lastWrongAt": "2026-06-06T09:00:00.000000+00:00",
    "modes": ["看中文选英文", "挑战模式 难度2"],
    "lastSelected": "ability"
  }
}
```

处理逻辑：

- 新错题：创建记录，`mistakes` 为 `1`。
- 已存在错题：`mistakes + 1`。
- 每次答错都会将 `resolvedStreak` 重置为 `0`。
- `modes` 会合并去重。
- `lastSelected` 会更新为本次误选内容。

## 6.12 删除错题

### `DELETE /api/wrong-answers/{word_id}`

从错题本中删除指定单词。

认证：需要

路径参数：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `word_id` | number | 要删除的单词 ID |

请求示例：

```bash
curl -X DELETE http://127.0.0.1:8938/api/wrong-answers/18 \
  -H "Authorization: Bearer generated-session-token"
```

响应示例：

```json
{
  "ok": true
}
```

说明：

- 即使该错题不存在，接口也会返回 `{ "ok": true }`。

## 7. 前端调用示例

### 登录并保存 token

```ts
const response = await fetch('/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    displayName: 'Leo',
    password: '123456',
  }),
});

const data = await response.json();
window.localStorage.setItem('lumipath-token', data.user.token);
```

### 携带 token 请求接口

```ts
const token = window.localStorage.getItem('lumipath-token');

const response = await fetch('/api/checkins', {
  headers: {
    Authorization: `Bearer ${token}`,
  },
});

const data = await response.json();
```

## 8. 数据库相关说明

后端启动时会自动初始化 SQLite 数据库。默认数据库路径为：

```text
data/lumipath.sqlite
```

也可以通过环境变量自定义：

```bash
LUMIPATH_DB_PATH=your/custom/path.sqlite npm run dev:api
```

主要数据表：

| 表名 | 说明 |
| --- | --- |
| `users` | 用户账户信息 |
| `sessions` | 登录会话 token |
| `checkins` | 每日打卡记录 |
| `learned_words` | 已学习单词记录 |
| `wrong_answers` | 错题记录 |
| `user_word_state` | SRS 学习状态 |

## 9. 联调建议

- 先调用 `/api/health` 确认后端运行。
- 注册或登录后保存 `user.token`。
- 后续请求统一携带 `Authorization: Bearer <token>`。
- 前端词库详情来自 `src/data/vocabulary.json`，后端选词接口只返回 `wordIds`。
- `count` 参数最大为 `30`，超出会触发 FastAPI 参数校验错误。
- 登录 session 默认有效期为 30 天。
