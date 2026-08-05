# 查詢標的置頂、卡片標題釐清、價位地圖

日期：2026-08-04
範圍：三項使用者回報的畫面問題，全部在前端。不動後端、不改 API 契約、不影響既有快照。

## 問題

| # | 回報 | 根因 |
|---|---|---|
| 1 | 查個股（如 5439）時，該股沒排在第一筆，要往下滑才找得到 | `analysis.tsx` 的 `sortedStocks` 把整份名單依 E(V) 重排，蓋掉後端刻意安排的順序 |
| 2 | 卡片標題的股票代碼與價格標示不明確 | `stock-card.tsx` 把「名稱 代號 價格 收盤 產業」擠在同一行，`6274` 與 `1340` 兩串裸數字相鄰 |
| 3 | 動能視圖左欄整片空白 | 左欄只放 `expected_value`／`verified_rate`／估值三塊，動能視圖這四項全部不顯示，右欄卻是滿的 |

第 1 項不是後端問題：`routes/analyze.ts:302` 的 prompt 已經要求
「stocks 陣列的第一筆必須是查詢的那檔」，`payload.stocks` 也原封不動保留模型順序。
順序是在前端被沖掉的。

## 已確認的決策

1. **只置頂卡片，排名表另作標記。** 排名表就是排名，把某一列拉到第一名等於讓
   「第一列」不再代表期望值最高，那張表就失去意義。改為原地反白並標出名次。
2. **標題拆成兩行。** 名稱、代號、產業一行，價格自成一行。
3. **價位地圖用現有欄位畫，不動後端。** 不新增日收盤序列，不新增請求，
   快照體積不變。
4. **價位地圖套用到新手、動能、波段三個視圖。** 價值與存股不顯示 ——
   那兩個視圖刻意不講停損停利（賣出條件是基本面轉壞或估值過高，不是價格
   觸及某個數字），畫一張以停損停利為主的圖與那個決定直接牴觸。

## 變更一：查詢標的置頂

### 新增純函式 `artifacts/web/src/lib/queriedStock.ts`

```ts
export function queriedCode(
  keyword: string,
  stocks: ReadonlyArray<{ code: string; name: string }>,
): string | null
```

判斷規則，依序：

1. keyword 去頭尾空白。
2. 符合 `/^\d{4,6}$/` 且名單中有相同 `code` → 回該代號。
3. 與某檔 `name` 完全相同 → 回該代號。
4. 其餘 → `null`（查的是產業關鍵字，或該股不在回傳名單裡）。

**只做完全比對。** 部分比對會讓「台」這類字誤中一堆標的，而誤標「你查的」
比不標更糟 —— 它宣稱了一件使用者沒做的事。

代號比對排在名稱之前：純數字的公司名不存在，但先比代號可以少一次全表掃描，
且語意上「輸入數字」就是在查代號。

### `artifacts/web/src/pages/analysis.tsx`

- `pinnedCode = queriedCode(analysis.keyword, analysis.stocks)`。
- **卡片區**改用新的順序：`pinnedCode` 對應的那檔排第一，其餘維持 E(V) 由高到低。
- **排名表**順序完全不動，只在 `pinnedCode` 那一列加：左側色條、背景反白、
  以及一個「你查的 · 第 N/M」標記。
- **名次的分母是實際印出來的列數**，不是 `sortedStocks.length`。表格對
  `d.ev == null` 的列 `return null`，用未過濾的長度會印出「第 3/5」而畫面上
  只有 3 列。改成先過濾出要渲染的列，再在其上取 index。

### 順帶修正：載入狀態對錯標的

現況 `analysis.tsx:306-308`：

```tsx
{sortedStocks.map((stock, i) => {
  const isLoading = !isRestoring && (!queries[i] || queries[i].isPending);
```

`queries` 由 `analysis.stocks.map(...)` 建立，索引對應的是**原始順序**；
`i` 卻來自重排後的 `sortedStocks`。兩者排序不同時，每張卡片讀到的是別檔的
載入狀態。置頂會再疊一層重排，只會更歪。

改為以代號查表：建 `Map<code, index>`，用 `queries[indexOf(stock.code)]`。

## 變更二：卡片標題拆兩行

`artifacts/web/src/components/stock-card.tsx` 的 Header 區塊。

改後結構：

```
台燿 〔6274〕 【銅箔基板】 〔你查的〕          ╰ 強烈買進 ╯
收盤價 1340
高頻高速銅箔基板（CCL）大廠，為 PCB 產業關鍵上游材料供應商。
〔波段 · 約 3 個月〕
⏱ 資料日期  股價 2026-08-04  法人 2026-08-04  營收 2026/06
```

- 代號套上邊框成為 chip，與公司名視覺分離。
- 價格移到第二行，前綴「收盤價」標籤，兩串裸數字不再相鄰。
- `StockCard` 新增 `isQueried?: boolean` prop，為 true 時在第一行末端顯示
  「你查的」徽章。
- 訊號徽章、策略標籤、`DataFreshness`、新聞出處連結位置與行為不變。

## 變更三：價位地圖

### 新增 section key

`lib/view-profile/src/index.ts` 的 `SectionKey` 加入 `'price_map'`，
並加進 `newbie`、`momentum`、`swing` 三個視圖的 `show`。

既有測試「波段是超集」要求非估值類的區塊只要有任一視圖看得到、波段就必須有。
三個視圖一起加，符合該約束。

### 新增純函式 `artifacts/web/src/lib/priceMap.ts`

```ts
export interface PriceMapLevel {
  key: 'take_profit' | 'first_target' | 'entry_high' | 'entry_low'
     | 'current' | 'stop_loss' | 'ma20' | 'ma60' | 'swing_high' | 'swing_low';
  label: string;
  value: number;
  /** 0（軸底）到 100（軸頂）的位置 */
  pct: number;
  /** 標籤實際畫的位置，去疊之後可能與 pct 不同 */
  labelPct: number;
  /** 與現價的距離（%）。現價本身與缺現價時為 null */
  fromCurrent: number | null;
}

export function buildPriceMap(input: PriceMapInput): PriceMapLevel[]
```

`PriceMapInput` 收 `currentPrice`、`entryLow`、`entryHigh`、`stopLoss`、
`takeProfit`、`firstTarget`、`ma20`、`ma60`、`swingHigh`、`swingLow`，
以及 `planKind`。

行為：

1. **`planKind === 'none'` 時排除 `entry_low`、`entry_high`、`stop_loss`、
   `take_profit`、`first_target`。** 交易計畫區塊在該狀態已經整塊不印
   （`stock-card.tsx:364`：「目前不提供進場區間與停損停利」），地圖若照畫，
   等於把剛抑制掉的矛盾用圖再講一次。此時只留現價、月線、季線、20 日高低。
2. `null` 值一律略過。
3. 比例尺取納入項目的 min 與 max，上下各留 8% 邊距，因此極端值不會貼在軸的
   邊緣。只剩一個值（或所有值相同）時該值放在 50%。
4. `fromCurrent = (value - currentPrice) / currentPrice * 100`。無現價時全為 null。
5. **標籤去疊**：依 `pct` 由低到高掃過，維持最小間距 7（單位同 pct），
   不足者往上推。推到超過 100 時改由頂端往下回推，確保全部落在 0~100 內。
   去疊只改 `labelPct`，`pct`（刻度線的真實位置）不動 —— 線必須畫在真實比例上，
   否則這張圖就在說謊。

回傳空陣列代表無可畫之物，呼叫端整塊不渲染。

### 新增元件 `artifacts/web/src/components/stock/price-map.tsx`

用絕對定位的 div 畫，不引 recharts —— 這是一根軸，不是折線圖，
一個圖表函式庫在這裡只會多包幾十 KB 而換不到任何東西。

- 固定高度（約 240px），與右欄的內容高度相稱。
- 進場區以色帶（`bg-primary/10`）從 `entry_low` 畫到 `entry_high`。
- 現價最醒目（實線 + 粗體），停損用 `destructive`，停利與第一目標用 `primary`，
  月線、季線、20 日高低用 `muted-foreground` 虛線。
- 標籤在右側，畫在 `labelPct`，內容為「名稱 數值」＋停損／停利／第一目標／
  進場區上下緣額外標 `fromCurrent`。

### 放置位置

`stock-card.tsx` 左欄，接在三情境條之後、估值三塊之前。
估值三塊只有價值／存股看得到，而那兩個視圖沒有 `price_map`，兩者不會同時出現。

## 測試

| 檔案 | 覆蓋 |
|---|---|
| `artifacts/web/src/lib/queriedStock.test.ts`（新增） | 代號命中、名稱命中、產業關鍵字回 null、代號不在名單、前後空白、四位以下數字 |
| `artifacts/web/src/lib/priceMap.test.ts`（新增） | 比例尺映射、`planKind === 'none'` 的排除、null 略過、單一值、標籤去疊、`fromCurrent` 正負號、全空回空陣列 |
| `lib/view-profile/src/index.test.ts`（修改） | `price_map` 在新手／動能／波段為 true，價值／存股為 false |

畫面組裝（`analysis.tsx`、`stock-card.tsx`、`price-map.tsx`）不寫測試 ——
專案現有的測試邊界就在純函式層，元件層沒有測試基礎設施，
為這三項變更引進一套等於另一個專案。判斷邏輯全部推進上表的純函式裡，
元件只負責把回傳值畫出來。

## 第二輪：複查後補上的（2026-08-05）

前三項上線後複查，找到六處資訊不明確，其中兩處是第一輪自己留下的。

| # | 問題 | 處置 |
|---|---|---|
| 1 | 查個股時分析頁標題只印使用者輸入的字串（「5439」），沒有公司名與產業 | 新增 `queriedIdentity()`，標題改印官方簡稱＋代號 chip＋官方產業別，並加一句說明下方名單是「該檔與同族群競爭者」 |
| 2 | `planKind === 'conditional'` 時價位地圖照畫進場帶，是卡片上唯一沒說「尚未成立」的地方 | 新增 `priceMapNote()`；面板標「計畫尚未成立」，進場帶改虛線暖色，底下加注記 |
| 3 | 新手視圖的地圖寫「月線／季線」，與同卡片刻意翻成白話的「近月平均」打架 | `buildPriceMap` 收 `glossary`，新手視圖顯示「近月均價／近季均價」。停損停利與 20 日高低兩套視圖同名 —— 卡片其他區塊本來就這樣寫，跟著改反而製造第二套詞 |
| 4 | 首頁完全沒提可以查個股，整套後端邏輯沒有入口 | placeholder 改「產業關鍵字或股票代號」，搜尋框下加一行說明 |
| 5 | 查詢紀錄印「5439」＋「領先標的: 台燿」，看不出那次查的是誰 | `HistoryMeta` 新增 `queriedCode` / `queriedName`（選用欄位，舊紀錄讀回為 undefined），群組標題並列公司名 |
| 6 | 排名表的「第 4/4」沒說是什麼的名次 | 改為「期望值第 4/4」 |

`queriedIdentity` 的名稱來源順序：官方簡稱 → 模型給的名稱 → 代號本身。
官方簡稱優先是因為它是回傳裡唯一可查核的來源；退回模型名稱是為了讓明細
還在載入時標題不空一塊。

## 第三輪：視覺階層與降噪（2026-08-05）

診斷的量測結果：一張卡片有 59 個 14px 以下的字級實例、5 個 18px 以上；
波段視圖手機端單張卡片約 17 個垂直區塊。核心問題是**沒有階層**，不是太擠。

### 第一批（階層）

- **操作建議移到卡片頂端**，自成一層，標題 `text-lg`。先前它排在整個雙欄格線之後，
  手機端要滑過十來個區塊才看得到唯一能直接執行的結論。
- **「最壞會賠多少」與它同層**。新手視圖的註解說那是「唯一該記住的數字」，
  但它躲在部位試算盒第三行。
- **E(V) 由 `text-3xl font-black` 降到 `text-xl font-bold`**。新手視圖砍掉它的理由是
  「那張機率表未經回測」—— 不夠可靠到能給新手看的東西，不該在其他視圖當全卡最大的字。
- **`DEFAULT_PROFILE` 由 `swing` 改為 `newbie`**。波段是所有視圖的超集（15 個區塊），
  於是沒選過受眾的人拿到密度最高、且由未回測機率表領銜的那一版。

### 第二批（降噪）

| 動作 | 理由 |
|---|---|
| 刪除交易計畫的三欄價位 | 同一組價位在卡片上出現三次（三欄格線、地圖標籤、1R 灰籤）。地圖是唯一能同時回答「多少錢」與「相對月線在哪」的那一份 |
| 刪除 1R／移動停損灰籤，兩者改畫進地圖 | 同上。`trailing_stop` 這個 section key 現在控制的是地圖上的兩條線 |
| 地圖分主次：計畫價位 `text-sm`，均線與 20 日高低留 `[11px]` | 地圖成為唯一價位陳述後，使用者要從這裡抄數字，11px 抄不動 |
| 三情境條收合 | E(V) 就是這三條的加權摘要，並排等於同一個宣稱講兩次 |
| 停損依據、相對強弱算法、籌碼動向判定三段方法論收進 `<details>` | 誠實不等於要一直印在臉上 |
| 資料日期三個日期收合 | 股價日期已經印在操作建議橫幅裡（「以 X 收盤價判斷」），那才是它該出現的地方 |
| 「這份計畫何時失效」提級（左側紅條、標題 `text-sm` 加粗） | 註解說「那才是真正會虧錢的那一半」，而它先前是全卡最小最灰的一塊 |
| 分析頁標題壓成兩行 | 第二輪加的兩個 chip 讓標題列變成五個並排元素，手機上斷三行 |
| 手機端隱藏期望值排名表 | 五個欄位在下方卡片全部重複，而它唯一的附加價值「橫向比較」在窄螢幕不成立 |

**一項與診斷不同的決定**：診斷建議把 MarketPanel 的大盤警示改為中性色以「讓 amber 專用」，
實作時只改了 ProfileSwitcher 的 caveat。大盤跌破雙均線提高的是**這批交易的實際風險**，
正是暖色該代表的東西；而「日線延遲一天」是產品定位的限制，永遠成立，
用同一個顏色會稀釋前者。另外，診斷引用的「amber 19 處」是原始碼出現次數，
同時渲染的通常只有 1～3 個 —— 這一點當時講得比實際嚴重。

## 不做的事

- 不新增日收盤序列或任何後端欄位。
- 不改排名表的排序規則。
- 不讓價值／存股視圖出現任何停損停利相關的圖。
- 不對公司名做部分比對。
