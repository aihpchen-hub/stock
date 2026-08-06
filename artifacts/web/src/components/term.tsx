import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';

/**
 * 專有名詞的隨手註解。
 *
 * 新手視圖切都不用切就是預設，但一張卡片上仍要讀完「達標率／計畫成立率／
 * 已結案／規則 v4／相對強弱／第 2/5 強／均量 1.85×／風報比（扣費後）0.96」。
 * 其中「風報比」是決定一筆交易值不值得做的核心概念，而畫面上唯一解釋它的
 * 地方是它**跌破 1 時才出現**的紅框 —— 賠率有利時反而沒有任何說明，
 * 使用者看到「1.85」不知道那是好是壞、也不知道是 1.85 個什麼。
 *
 * 用 hover-card 而不是原生 title：後者在觸控裝置上完全不會出現，
 * 而這個工具的主要使用情境就是手機。
 */
const GLOSSARY: Record<string, string> = {
  '風報比':
    '賺的時候能賺多少，除以賠的時候會賠多少。大於 1 才代表看對時的獲利大於看錯時的虧損；小於 1 表示即使方向猜對，賠率仍然不利。這裡的數字已經扣掉兩趟手續費與證交稅。',
  '達標率':
    '過去存下來的計畫裡，已經分出勝負的那些當中，先摸到停利的比例。分母不含「仍持有」與「從未進場」的計畫 —— 那兩種還沒有結果。',
  '計畫成立率':
    '過去存下來的計畫裡，價格真的走進過建議進場區的比例。沒成立的計畫連買都沒買到，所以它與達標率的分母不同，兩者不能相乘。',
  '相對強弱':
    '這一檔近期的漲幅，減掉大盤同期的漲幅，單位是百分點。個股漲 8% 而大盤漲 10% 時這裡是 −2 —— 絕對值為正、相對大盤卻是輸的。',
  '期望值':
    '把多頭、基準、空頭三種情境的報酬，用各自的機率加權平均。**那組機率是經驗設定、未經回測**，所以這個數字用來排序比用來預測可靠。',
  '均量':
    '最近 20 個交易日的平均成交量。旁邊的倍數是今天的量相當於它的幾倍 —— 小型股的流動性決定掛不掛得進去。',
  'ATR':
    '近 14 日的平均真實振幅，也就是這一檔平常一天大概會震盪幾塊錢。停損距離由它推得，因此波動大的股票停損自然放得比較遠。',
};

export function Term({ children }: { children: string }) {
  const text = GLOSSARY[children];
  if (!text) return <>{children}</>;

  return (
    <HoverCard openDelay={100}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          className="underline decoration-dotted decoration-muted-foreground/60 underline-offset-2 cursor-help"
        >
          {children}
        </button>
      </HoverCardTrigger>
      <HoverCardContent className="w-72 text-xs leading-relaxed">{text}</HoverCardContent>
    </HoverCard>
  );
}
