# Hush

**私密羣組聊天 · 內部檔案分享。** 一個只給受邀成員用的空間：共用聊天室、檔案庫、由單一管理員管理成員與內容。同一套程式碼可部署到 **Cloudflare Pages** 與 **Netlify**（兩者皆可獨立運作，也可同時部署互為備援）。

![Hush 登入畫面](docs/screenshots/login.png)

## 設計重點

| 面向 | 選擇 | 理由 |
| --- | --- | --- |
| 前端 | React 19 + Vite + Tailwind CSS v4 | SPA 同時跑在兩個平台的靜態託管 |
| API | Hono（同源 `/api/*`） | 同一份程式碼掛到 Pages Functions 與 Netlify Functions，不用 CORS |
| 資料庫 | Neon Postgres（HTTP driver） | 兩邊平台都走 HTTPS，沒有 TCP socket 也能連 |
| 物件儲存 | S3 相容（B2 / Supabase Storage / MinIO…） | SigV4 預簽名 URL，瀏覽器直傳直取，**檔案不經過函式** |
| 認證 | 自製 session（PBKDF2-SHA256，100k 迭代） | 邊緣環境相容；單一管理員＋成員由管理員建立，不需要註冊/OAuth |
| 即時 | 2.5s 增量輪詢（`?after=` 游標） | Pages/Netlify 函式不適合長連線，輪詢穩定且足夠即時 |

**刻意不用的東西**：Cloudflare Workers（改用 Pages Functions）、Cloudflare R2（物件儲存走 S3 相容服務）、D1（兩邊共用 Neon，避免雙 schema 維護）。

> Netlify 同步函式有 6 MB 請求上限，所以檔案上傳/下載必須用預簽名 URL 直連物件儲存——這也是選擇 S3 相容服務的主因。沒有設定 S3 時，系統自動退回「Postgres 直存」模式（單檔上限 4 MB，僅建議測試用）。

![聊天室](docs/screenshots/chat.png)

## 畫面

| 檔案庫 | 成員 | 管理 |
| --- | --- | --- |
| ![檔案庫](docs/screenshots/files.png) | ![成員](docs/screenshots/members.png) | ![管理](docs/screenshots/admin.png) |

## 快速開始（本機）

```bash
npm install          # 安裝依賴
npm run dev:api      # 終端 1：API（PGlite 本機 Postgres，自動建 schema）
npm run dev          # 終端 2：Vite（http://127.0.0.1:5173）
```

第一次開啟以 `admin` / `hush-demo-2026` 登入（可用環境變數覆寫，見下表）。

本機不需要 Neon：API 用 in-process 的 PGlite 跑同一份 SQL；資料存在 `.data/pglite/`。要對真實 Neon 跑遷移：

```bash
cp .env.example .env.local   # 填入 DATABASE_URL
npm run db:migrate
```

## 部署

### Cloudflare Pages

1. 建立 Pages 專案，連結 repo，設定：
   - Build command：`npm run build:pages`
   - Build output：`dist`
   - Node 版本：`NODE_VERSION=22`
2. 設定環境變數（見下表，至少要 `DATABASE_URL`、`ADMIN_PASSWORD`）。
3. 部署。`/api/*` 由 `functions/api/[[path]].ts` 處理，其餘路徑由 SPA 接管（`dist/_redirects`）。

### Netlify

1. 連結 repo，Netlify 會讀 `netlify.toml`（build `npm run build`、publish `dist`、functions `netlify/functions`）。
2. 設定同一組環境變數。
3. 部署。`/api/*` 由 `netlify/functions/api.ts`（Functions v2，`config.path`）處理。

### 資料庫

兩邊都連同一個 Neon 資料庫。第一次 API 請求時自動建立 schema（`AUTO_MIGRATE=false` 可關閉，改用手動 `npm run db:migrate`）。

schema v2 新增置頂資料表 `chat_pin`，並嘗試啟用 `pg_trgm` 擴充與訊息內文、檔名的 trigram 索引，讓關鍵字搜尋（含中文）走索引。Neon 支援 `pg_trgm`；若資料庫不允許建立擴充，搜尋照常可用，只是改為循序掃描。從 v1 升級時自動補上，不需手動處理。

### 物件儲存

任選一個 S3 相容服務，建立一個 **私有** bucket，然後：

```bash
STORAGE_DRIVER=s3
S3_BUCKET=hush-files
S3_REGION=...                 # 例如 us-west-004
S3_ENDPOINT=https://s3....    # 服務的 S3 endpoint
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

bucket 需開放 CORS 讓瀏覽器能 PUT：

```json
[
  {
    "AllowedOrigins": ["https://你的網域"],
    "AllowedMethods": ["PUT", "GET", "DELETE"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Backblaze B2 使用 `PutBucketCORS`（S3 API）設定；Supabase Storage 在專案設定裡加 allowed origins；MinIO 用 `mc anonymous`/`mc cors` 設定，並加 `S3_FORCE_PATH_STYLE=true`。Neon Object Storage 也需要 `S3_FORCE_PATH_STYLE=true`（它的憑證不涵蓋 `bucket.endpoint` 這種子網域）。

檔案預覽（圖片、音訊、影片、PDF 用 `<img>`/`<audio>`/`<video>`/`<iframe>` 直接載入）不需要 CORS；純文字預覽會先用 `fetch` 讀內容，bucket 沒開 GET 的 CORS 時自動改用 iframe 顯示。預覽網址由後端依白名單決定 inline 與 Content-Type（SVG、HTML 一律以純文字顯示），效期 1 小時；一般下載仍是 attachment、5 分鐘。

訊息裡的網址會變成連結；若網址是圖片、音訊或影片，由後端代抓後直接在聊天室預覽（`/api/media?url=`），成員的瀏覽器只連到 Hush，外部網站只看得到伺服器的 IP。只轉送 4 MB 以內（Netlify 回應上限 6 MB，扣掉 base64 膨脹）、白名單內的媒體類型（SVG、HTML 不轉送），超過就只顯示連結；並擋下 localhost、私有／鏈路本地等內部位址（含 DNS 解析後與每一次轉址）。點開連結本身仍是直接連到對方網站。

上傳檔案時必須填寫描述或備註（每個檔案各一段，最多 1000 字，多個檔案可一鍵套用同一段）；描述會成為聊天室裡那則檔案訊息的內文，也會顯示在檔案庫，並可被搜尋。

## AI 功能（選用）

接任何 OpenAI 相容的 `/chat/completions` 端點，程式碼不寫死供應商，預設用串流（回覆邊產生邊顯示）；`AI_BASE_URL`、`AI_API_KEY`、`AI_MODEL` 三個都要設定，缺一就整個關閉、介面上也不會出現按鈕。

- **聊天摘要**：整理最近 50／100／200 則訊息的重點、決定、待辦與分享的檔案。
- **翻譯訊息**：每則訊息旁的翻譯鈕，翻成繁體中文（已是中文就翻成英文），再按一次收起。
- **AI 潤稿**：輸入框旁的魔杖鈕，修正錯字與語病後換掉草稿，可一鍵復原。
- **AI 助手**：個人問答，只有自己看得到；對話只存在瀏覽器分頁記憶體，伺服器不保存。覺得有用可一鍵分享到聊天室（以自己的名義送出）。

注意：用到的訊息內容會送到你設定的 AI 服務。每次呼叫都寫入稽核紀錄（只記功能與模型，不記內容），並以此限制每人每小時次數。上游的錯誤內容只寫伺服器日誌，不回給前端。

```bash
AI_BASE_URL=https://api.example.com/v1   # 填到 /v1，或直接填完整的 .../chat/completions
AI_API_KEY=...                           # 必填，以 Authorization: Bearer 送出
AI_MODEL=your-model-name
# AI_TIMEOUT_SECONDS=     # 不設就不主動逾時（仍受部署平台的函式執行上限）
# AI_MAX_TOKENS=1024
# AI_HOURLY_LIMIT=30      # 每人每小時次數
# AI_STREAM=false         # 預設串流；端點不支援時設 false 改成一次回整段
```

## 環境變數

| 變數 | 必填 | 說明 |
| --- | --- | --- |
| `DATABASE_URL` | ✓ | Neon 連線字串 |
| `ADMIN_USERNAME` | | 管理員帳號（預設 `admin`） |
| `ADMIN_PASSWORD` / `ADMIN_PASSWORD_HASH` | ✓ 二擇一 | 首次啟動建立管理員用；`npm run db:migrate` 同款指令可產生雜湊：`node scripts/run-ts.mjs scripts/hash-password.ts <密碼>` |
| `STORAGE_DRIVER` | | `s3` 或 `pg`（預設：有完整 S3 設定就用 s3，否則 pg） |
| `S3_BUCKET/REGION/ENDPOINT/ACCESS_KEY_ID/SECRET_ACCESS_KEY` | s3 模式必填 | 物件儲存設定 |
| `S3_FORCE_PATH_STYLE` | | MinIO / Supabase 設 `true` |
| `S3_PREFIX` | | 物件鍵前綴（預設 `hush/`） |
| `MAX_UPLOAD_MB` | | 單檔上限（預設 100；pg 模式固定 4） |
| `SESSION_DAYS` | | 登入有效天數（預設 30） |
| `AUTO_MIGRATE` | | `false` 關閉自動遷移 |
| `APP_NAME` | | 品牌名稱（預設 Hush） |
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | AI 功能必填 | 任何 OpenAI 相容端點、金鑰（以 `Authorization: Bearer` 送出）、模型名稱；三個都有才啟用 |
| `AI_TIMEOUT_SECONDS` | | 主動逾時秒數；不設就不逾時（仍受平台函式執行上限） |
| `AI_MAX_TOKENS` / `AI_HOURLY_LIMIT` | | 回覆長度上限（預設 1024）、每人每小時次數（預設 30） |
| `AI_STREAM` | | 預設串流；設 `false` 改成一次回整段（端點直接回 JSON 時也會自動處理） |

## 安全設計

- 密碼：PBKDF2-SHA256、10 萬次迭代、每帳號獨立鹽值；雜湊只存資料庫。
- Session：httpOnly + SameSite=Lax cookie，伺服器端只存 token 的 SHA-256；改密碼/重設/停用會註銷該使用者所有 session。
- 登入節流（存 DB，邊緣環境也能用）：同一 IP 對同一帳號 15 分鐘內連錯 5 次，鎖該帳號在該 IP 15 分鐘；同一 IP 不論帳號累計錯 20 次，整個 IP 鎖 15 分鐘。IP 取自 Cloudflare `cf-connecting-ip` 或 Netlify `x-nf-client-connection-ip`，不信任可偽造的 `x-forwarded-for`。
- CSRF：所有寫入請求比對 Origin 與 Host。
- 檔案：bucket 私有，下載一律走「需登入的 API 換發 5 分鐘預簽名 URL」；移除檔案時同步刪除物件。
- XSS：React 預設跳脫；檔案下載一律 `Content-Disposition: attachment`＋`nosniff`。
- 上傳上限、帳號白名單格式、訊息長度上限都在伺服器端驗證。
- `_headers` 內含 CSP、`X-Frame-Options: DENY` 等安全標頭。

## 權限模型

- **管理員（唯一）**：由 `ADMIN_*` 環境變數首次建立。可移除任何訊息（保留「已移除」墓碑）、置頂一則訊息（新的取代舊的）、移除檔案、新增/停用/移除成員、重設成員密碼、看稽核紀錄。
- **成員**：由管理員建立帳號；可聊天、搜尋訊息與檔名、使用 AI 功能（有設定時）、上傳檔案（須附描述）、下載檔案、改自己的密碼。不能刪訊息、不能刪檔案、不能管理成員。
- 沒有註冊頁、沒有邀請連結、沒有第三方登入。

所有管理動作都會寫入 `audit_log`，管理頁可檢視。

## 測試

```bash
npm run check   # typecheck + 全部測試 + production build
```

- `tests/sigv4.test.ts`：對上 AWS 官方文件的簽章範例，並檢查查詢參數排序。
- `tests/password.test.ts`：PBKDF2 雜湊/驗證/錯誤格式。
- `tests/config.test.ts`：環境變數解析（儲存模式、上傳上限、SESSION_DAYS 預設值）。
- `tests/preview.test.ts`：可預覽類型判斷（圖片、音訊、影片、PDF、文字；SVG/HTML 只以純文字顯示），以及 S3 預覽網址（inline、覆寫 Content-Type、效期 1 小時）。
- `tests/api.test.ts`：以 PGlite 跑 26 項端到端情境——登入建立管理員、成員權限、訊息分頁與參數驗證、置頂（權限、取代、輪詢同步、刪除時取消）、搜尋（中英文、檔名、篩選、萬用字元跳脫）與前後文、訊息刪除墓碑、檔案上傳下載與大小檢查、上傳必須附描述（空白、過長都拒絕，描述進檔案庫與訊息內文）、檔案預覽（inline 白名單、HTML 不以 text/html 回傳）、CSRF、登入鎖定（帳號＋IP、整個 IP、偽造 x-forwarded-for）、停用成員、修改密碼、登出。
- `tests/media.test.ts`：外鏈媒體代理（含 4 MB 上限檢查）——內部位址判斷（IPv4／IPv6／內嵌 IPv4）、網址格式、內文網址切割，以及端到端：未登入 401、圖片轉送與快取標頭、info 回報大小（超過 4 MB 不可預覽、HEAD 不支援時改用 GET）、413／415、DNS 指向私有位址與轉址到內部都擋下、公開轉址會跟隨。
- `tests/ai.test.ts`：AI 功能 13 項（假的 OpenAI 相容端點與 SSE 串流）——端點、金鑰、模型缺一就關閉，逾時不預設，預設串流（503、aiEnabled=false）、端點網址組合、未登入 401、問答送出的網址／金鑰／模型與 stream、去除被切開的思考標籤、拒絕 system 角色與格式錯誤、摘要、翻譯（指定語言；無效或不存在的訊息編號被拒）、潤稿（超過長度截斷）、AI_STREAM=false 與端點直接回 JSON、上游錯誤不外洩內容（500／429／空回覆／串流中途出錯／逾時）、每人每小時次數上限與稽核不記內容。

共 61 項。

## 結構

```
hush/
├── functions/api/[[path]].ts    # Cloudflare Pages Functions 入口
├── netlify/functions/api.ts     # Netlify Functions v2 入口
├── src/server/                  # 共用 API 核心（兩邊平台同一份）
│   ├── app.ts                   # Hono app：掛載路由、錯誤處理
│   ├── config.ts                # 環境變數 → Config
│   ├── schema.ts                # SQL schema（唯一真源）
│   ├── db.ts                    # Neon HTTP driver + 遷移
│   ├── auth.ts                  # session、CSRF、登入節流
│   ├── crypto.ts                # PBKDF2、token
│   ├── sigv4.ts                 # AWS SigV4 預簽名（Web Crypto）
│   ├── bootstrap.ts             # 首次建立管理員
│   ├── audit.ts                 # 稽核紀錄
│   ├── ai.ts                    # OpenAI 相容 /chat/completions 呼叫
│   ├── outbound.ts              # 外鏈媒體代抓（SSRF 防護）
│   ├── storage/                 # s3（預簽名）／pg（直存）兩種驅動
│   └── routes/                  # auth / messages / files / members / media / ai / admin
├── web/                         # React SPA（Vite + Tailwind v4）
├── tests/                       # vitest：SigV4、密碼、端到端 API
├── scripts/                     # dev-server（PGlite）、migrate、hash-password
├── netlify.toml                 # Netlify 部署設定
├── wrangler.toml                # Cloudflare Pages 設定
└── .env.example                 # 環境變數範例
```

## 常見問題

**兩邊部署要分開建 DB 嗎？**
不用。兩邊都連同一個 Neon DB，訊息與檔案目錄一致；兩邊是同一個應用的兩個入口。

**可以用 D1 嗎？**
可以但沒必要：Neon 的 HTTP driver 在 Pages Functions 也能跑。若堅持要 D1，把 `Sql` 介面換成 D1 binding 即可（`src/server/db.ts` 只有一個函式要改），但會失去兩邊共用的單一資料庫。

**為什麼不用 Neon Auth / Better Auth？**
需求是「單一管理員＋管理員建立成員＋無公開註冊」，自製 session 更貼合且零外部依賴。要換的話只需改寫 `src/server/auth.ts` 與 `routes/auth.ts`，其餘路由不受影響。

**檔案太大傳不上？**
pg 模式上限 4 MB（Netlify 函式限制）。正式環境請設 S3 模式，瀏覽器直傳，上限由 `MAX_UPLOAD_MB` 控制。

## License

MIT