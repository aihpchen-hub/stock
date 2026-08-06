/**
 * 全站免責聲明。
 *
 * 先前整個專案 grep 不到「僅供參考」「不構成」「投資建議」任何一個字，
 * 而畫面直接輸出一顆綠色的「強烈買進」藥丸，加上具體的進場區、停損、停利、
 * 建議張數與投入金額。在台灣，對不特定人公開提供個股買賣時機與價位，
 * 落在《證券投資信託及顧問法》第 4 條「證券投資顧問」的定義爭議區。
 *
 * 放 footer 而不是彈窗：它要一直在，不是被關掉一次就消失。真正的決策點
 * （部位試算盒）另有一句更貼近當下的提醒，見 stock-card.tsx。
 */
export function Disclaimer() {
  return (
    <footer className="mt-auto border-t border-border px-4 py-5">
      <p className="max-w-4xl mx-auto text-xs text-muted-foreground text-center leading-relaxed">
        本站的進場區、停損停利、建議張數與損益試算，皆為依公開資料與
        <strong className="font-medium text-foreground/80">固定規則</strong>
        產生的量化模擬結果，
        <strong className="font-medium text-foreground/80">僅供研究參考，不構成任何證券投資建議或買賣要約</strong>
        。三情境機率與評分權重為經驗設定、未經回測；產業敘述含 AI 生成內容，可能有誤。
        日線資料延遲一個交易日，不適合當日沖銷。投資有風險，盈虧自負。
      </p>
    </footer>
  );
}
