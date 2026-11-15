import {ratingDeltas,RATING_FORMULA_VERSION} from '../src/shared/rating';
export type RankedMode='classic'|'lastOneStanding'|'blitz'|'chaos';
export interface MatchReceipt {id:string;mode:RankedMode;startedAt:number;finishedAt:number;players:{accountId:string;placement:number;outcome:'win'|'loss'|'draw'|'forfeit'}[]}
export function utcSeason(seconds:number) {const d=new Date(seconds*1000),year=d.getUTCFullYear(),month=d.getUTCMonth();return {id:`${year}-${String(month+1).padStart(2,'0')}`,start:Date.UTC(year,month,1)/1000,end:Date.UTC(year,month+1,1)/1000};}
export class Rankings {
 constructor(private db:D1Database,private clock:()=>number=()=>Math.floor(Date.now()/1000)){}
 async settle(receipt:MatchReceipt):Promise<void> {
  const ids=receipt.players.map(p=>p.accountId);
  if(!/^[a-f0-9-]{36}$/.test(receipt.id)||!['classic','lastOneStanding','blitz','chaos'].includes(receipt.mode)||ids.length<2||ids.length>8||new Set(ids).size!==ids.length||ids.some(id=>! /^[a-f0-9-]{36}$/.test(id))||!Number.isInteger(receipt.startedAt)||!Number.isInteger(receipt.finishedAt)||receipt.finishedAt<receipt.startedAt||receipt.players.some(p=>!Number.isInteger(p.placement)||p.placement<1||p.placement>ids.length||!['win','loss','draw','forfeit'].includes(p.outcome)))throw new Error('invalid receipt');
  const canonical=JSON.stringify({...receipt,players:[...receipt.players].sort((a,b)=>a.accountId.localeCompare(b.accountId))});
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical))),v=>v.toString(16).padStart(2,'0')).join('');
  const season=utcSeason(receipt.startedAt),placeholders=ids.map(()=>'?').join(',');
  for(let attempt=0;attempt<8;attempt++) {
   const existing=await this.db.prepare('SELECT receipt_hash FROM matches WHERE id=?').bind(receipt.id).first<{receipt_hash:string}>();
   if(existing){if(existing.receipt_hash!==hash)throw new Error('receipt conflict');return;}
   const revision=await this.db.prepare('SELECT revision FROM settlement_revision WHERE id=1').first<{revision:number}>();
   const active=await this.db.prepare(`SELECT id FROM accounts WHERE status='active' AND id IN (${placeholders})`).bind(...ids).all<{id:string}>();
   // Deleted accounts invalidate the entire pending match, never resurrect personal rows.
   const eligible=active.results.length===ids.length;
   const statements:D1PreparedStatement[]=[this.db.prepare('UPDATE settlement_revision SET revision=revision+1 WHERE id=1 AND revision=?').bind(revision!.revision),this.db.prepare('INSERT INTO settlement_guard VALUES(?,changes())').bind(receipt.id),this.db.prepare("INSERT OR IGNORE INTO seasons VALUES(?,?,?,'open')").bind(season.id,season.start,season.end),this.db.prepare('INSERT INTO matches VALUES(?,?,?,?,?,?,?,?)').bind(receipt.id,receipt.mode,season.id,receipt.startedAt,receipt.finishedAt,RATING_FORMULA_VERSION,hash,eligible?'settled':'void')];
   if(eligible){
    // Delivery order must not bypass the cap: use trusted settlement time,
    // not an older receipt's finish time which excludes already delivered matches.
    const settledAt=this.clock();
    const pairs=await this.db.prepare(`SELECT account_low,account_high,COUNT(*) AS count FROM pair_history WHERE account_low IN (${placeholders}) AND account_high IN (${placeholders}) AND played_at BETWEEN ? AND ? GROUP BY account_low,account_high`).bind(...ids,...ids,settledAt-86400,settledAt).all<{account_low:string;account_high:string;count:number}>();
    const counts=new Map(pairs.results.map(p=>[p.account_low+':'+p.account_high,p.count]));
    for(const period of ['lifetime',season.id])for(const mode of ['overall',receipt.mode]){
     const rows=await this.db.prepare(`SELECT account_id,value FROM ratings WHERE mode=? AND season_id=? AND account_id IN (${placeholders})`).bind(mode,period,...ids).all<{account_id:string;value:number}>();
     const ratings=new Map(rows.results.map(r=>[r.account_id,r.value]));
     const deltas=ratingDeltas(receipt.players.map(p=>({accountId:p.accountId,rating:ratings.get(p.accountId)??1000,placement:p.placement,forfeited:p.outcome==='forfeit'})),(a,b)=>counts.get(a+':'+b)??0);
     for(const p of receipt.players){const win=p.outcome==='win'?1:0,draw=p.outcome==='draw'?1:0,loss=1-win-draw;
      statements.push(this.db.prepare('INSERT INTO ratings(account_id,mode,season_id,value,games,wins,losses,draws,streak,revision) VALUES(?,?,?,1000+?,1,?,?,?, ?,1) ON CONFLICT(account_id,mode,season_id) DO UPDATE SET value=value+?,games=games+1,wins=wins+?,losses=losses+?,draws=draws+?,streak=CASE WHEN ?=1 THEN streak+1 ELSE 0 END,revision=revision+1').bind(p.accountId,mode,period,deltas.get(p.accountId)!,win,loss,draw,win,deltas.get(p.accountId)!,win,loss,draw,win),this.db.prepare('INSERT INTO settlement_ledger VALUES(?,?,?,?,?)').bind(receipt.id,p.accountId,mode,period,deltas.get(p.accountId)!));
     }
    }
    for(const p of receipt.players)statements.push(this.db.prepare('INSERT INTO participants VALUES(?,?,?,?)').bind(receipt.id,p.accountId,p.outcome,p.placement));
    for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++){const [a,b]=[ids[i],ids[j]].sort();statements.push(this.db.prepare('INSERT INTO pair_history VALUES(?,?,?,?)').bind(a,b,receipt.id,settledAt));}
    statements.push(this.db.prepare(`INSERT INTO settlement_guard SELECT ?,CASE WHEN COUNT(*)=? THEN 1 ELSE 0 END FROM accounts WHERE status='active' AND id IN (${placeholders})`).bind(receipt.id+':accounts',ids.length,...ids),this.db.prepare('DELETE FROM settlement_guard WHERE id=?').bind(receipt.id+':accounts'));
   }
   statements.push(this.db.prepare('DELETE FROM settlement_guard WHERE id=?').bind(receipt.id));
   try{await this.db.batch(statements);return;}catch(error){if(attempt===7)throw error;}
  }
 }
 async table(mode:string,season:string,accountId?:string){
  if(!['overall','classic','lastOneStanding','blitz','chaos'].includes(mode)||!(season==='lifetime'||/^\d{4}-(0[1-9]|1[0-2])$/.test(season)))throw new Error('invalid filter');
  const query=`WITH ranked AS (SELECT a.id AS accountId,a.display_name AS name,r.value AS points,r.games,r.wins,r.losses,r.draws,r.streak,ROUND(100.0*r.wins/r.games,2) AS winPercent,RANK() OVER(ORDER BY r.value DESC) AS place FROM ratings r JOIN accounts a ON a.id=r.account_id WHERE r.mode=? AND r.season_id=? AND a.status='active') SELECT * FROM ranked`;
  const top=await this.db.prepare(query+' ORDER BY points DESC,games DESC,accountId LIMIT 100').bind(mode,season).all();
  const me=accountId?await this.db.prepare(query+' WHERE accountId=?').bind(mode,season,accountId).first():null;
  return {mode,season,top:top.results,me};
 }
 async seasons(){return (await this.db.prepare("SELECT id,starts_at,closes_at,CASE WHEN closes_at<=? THEN 'archived' ELSE 'open' END AS status FROM seasons ORDER BY starts_at DESC").bind(Math.floor(Date.now()/1000)).all()).results;}
}
