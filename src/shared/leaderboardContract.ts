/** Future backend boundary. No adapter, account service or global ranking exists yet. */
export interface VerifiedAccount { readonly accountId:string }
export interface ServerMatchReceipt {
  readonly globalMatchId:string;
  readonly accountId:string;
  readonly mode:"classic"|"lastOneStanding"|"blitz"|"chaos";
  readonly outcome:"win"|"loss"|"draw";
  readonly score:number;
  readonly survivalSeconds:number;
  readonly events:number;
  readonly forfeited:boolean;
  readonly finishedAtUtc:string;
}
export interface LeaderboardRow { rank:number; publicName:string; score:number }
export interface ServerProgressStore {
  // The authenticated game server supplies receipts. Never accept browser metrics.
  // Atomically deduplicate globalMatchId/accountId and update stats, XP and rewards.
  settle(account:VerifiedAccount,receipt:ServerMatchReceipt):Promise<{applied:boolean;revision:number}>;
  leaderboard(mode:ServerMatchReceipt["mode"],cursor?:string):Promise<{rows:LeaderboardRow[];nextCursor?:string}>;
}
