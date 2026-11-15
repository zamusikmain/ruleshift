/** Candidate formula, not connected to live rooms. Inputs are server receipts only. */
export interface RatedParticipant { accountId: string; rating: number; placement: number; forfeited: boolean }
export const RATING_FORMULA_VERSION = 1;
export function ratingDeltas(players: readonly RatedParticipant[], previousPairMatches: (low: string, high: string) => number): Map<string, number> {
  if (players.length < 2 || players.length > 8 || new Set(players.map(p=>p.accountId)).size !== players.length || players.some(p=>!p.accountId || !Number.isFinite(p.rating) || !Number.isInteger(p.placement) || p.placement<1 || p.placement>8 || typeof p.forfeited !== "boolean")) throw new Error("Invalid authoritative participants");
  const result = new Map(players.map(p=>[p.accountId,0]));
  const sizeWeight = .5 + (players.length-2)/12;
  for (let i=0;i<players.length;i++) for (let j=i+1;j<players.length;j++) {
    const a=players[i],b=players[j],ids=[a.accountId,b.accountId].sort();
    const count=previousPairMatches(ids[0],ids[1]);
    if (!Number.isInteger(count) || count<0) throw new Error("Invalid pair history");
    const weight=count===0?1:count===1?.5:count===2?.25:0;
    const actual=a.forfeited!==b.forfeited?(a.forfeited?0:1):a.forfeited?.5:a.placement===b.placement?.5:a.placement<b.placement?1:0;
    const expected=1/(1+10**((b.rating-a.rating)/400));
    const delta=24/(players.length-1)*sizeWeight*weight*(actual-expected);
    result.set(a.accountId,result.get(a.accountId)!+delta);
    result.set(b.accountId,result.get(b.accountId)!-delta);
  }
  return result;
}
