import {t,type TextKey} from './locales';
import {ONLINE_MODES} from './shared/modes';
import {modeTitle} from './uiModel';
import {leaderboardApi,ApiError,onRankingsChanged,type RankRow,type RankTable,type Account,type Season} from './leaderboardApi';
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function rankRow(row:RankRow):string{return '<tr>'+[row.place,escape(row.name),row.points.toFixed(1),row.games,row.wins,row.losses,row.draws,row.winPercent+'%',row.streak].map(value=>'<td>'+value+'</td>').join('')+'</tr>';}
export function showRankings(root:HTMLElement,mount:(html:string,rerender:()=>void)=>void,back:()=>void,_name:string,onAccount?:(account:Account)=>void,_callbackFailed=false,openProfile:()=>void=back){
 let sessionChecked=false;
 let mode='overall',period='lifetime',selected='',current='',seasons:Season[]=[],account:Account|null=null,table:RankTable|undefined,status:TextKey='rankLoading',busy=false,sequence=0,closed=false;
 const btn=(id:string,key:TextKey,disabled=false)=>`<button id="${id}" ${disabled?'disabled':''}>${t(key)}</button>`;
 const render=()=>{
  if(closed)return;
  const headers=['rankPlace','name','rankPoints','games','wins','losses','draws','winRate','winStreak'] as TextKey[];
  const archive=seasons.filter(s=>s.id!==current);
  const options=period==='archive'?`<label>${t('seasonArchive')}<select id="archive-season">${archive.map(s=>`<option value="${s.id}" ${s.id===selected?'selected':''}>${s.id}</option>`).join('')}</select></label>`:'';
  const body=table?table.top.length?`<div class="rank-scroll"><table><thead><tr>${headers.map(k=>'<th scope="col">'+t(k)+'</th>').join('')}</tr></thead><tbody>${table.top.map(rankRow).join('')}</tbody>${table.me?'<tfoot>'+rankRow(table.me)+'</tfoot>':''}</table></div>`:`<p>${t('rankEmpty')}</p>`:'';
  mount(`<p class="hint">${t('rankingScope')}</p>${sessionChecked&&!account?`<p>${t('rankGuestHint')}</p>${btn('rank-profile','profile')}`:''}<div class="filter-bar">${['overall',...ONLINE_MODES].map(m=>`<button id="rank-${m}" aria-pressed="${mode===m}">${t(m==='overall'?'overallRating':modeTitle(m))}</button>`).join('')}</div><div class="filter-bar">${['lifetime','season','archive'].map(p=>`<button id="period-${p}" aria-pressed="${period===p}">${t(p==='lifetime'?'lifetimeRating':p==='season'?'monthlySeason':'seasonArchive')}</button>`).join('')}</div>${options}<p>${t('monthlySeason')}: ${escape(current)}</p><p role="status" aria-live="polite">${status?t(status):''}</p>${table?.me?`<h3>${t('findMyRank')}: ${table.me.place} · ${table.me.points.toFixed(1)} ${t('rankPoints')}</h3>`:sessionChecked&&account&&table?`<p>${t('rankUnplaced')}</p>`:''}${body}${btn('rank-refresh','rankRefresh',busy)}${btn('back','back',busy)}`,render);
  const bind=(id:string,fn:()=>void)=>{const el=root.querySelector<HTMLElement>('#'+id);if(el)el.onclick=()=>{if(busy)return;fn();};};
  for(const m of ['overall',...ONLINE_MODES])bind('rank-'+m,()=>{mode=m;void load();});
  for(const p of ['lifetime','season','archive'])bind('period-'+p,()=>{period=p;void load();});
  root.querySelector<HTMLSelectElement>('#archive-season')?.addEventListener('change',event=>{selected=(event.target as HTMLSelectElement).value;void load();});
  bind('rank-refresh',()=>{void load();});bind('back',()=>{if(busy)return;closed=true;sequence++;unsubscribe();if(poll!==undefined)clearInterval(poll);back();});
  bind('rank-profile',()=>{closed=true;sequence++;unsubscribe();if(poll!==undefined)clearInterval(poll);openProfile();});
 };
 const load=async()=>{
  const ticket=++sequence;status='rankLoading';table=undefined;render();
  try{
   const [history,me]=await Promise.all([leaderboardApi.seasons(),leaderboardApi.me().catch(e=>{if(e instanceof ApiError&&e.status===401)return null;throw e;})]);
   if(closed||ticket!==sequence)return;
   current=history.current;seasons=history.seasons;account=me;sessionChecked=true;if(account){onAccount?.(account);}
   if(period==='archive'&&!seasons.some(s=>s.id===selected&&s.id!==current))selected=seasons.find(s=>s.id!==current)?.id??'';
   if(period==='archive'&&!selected){status='noSeasonArchive';render();return;}
   const result=await leaderboardApi.table(mode,period==='lifetime'?'lifetime':period==='season'?current:selected);
   if(closed||ticket!==sequence)return;
   table=result;status=account?'rankReady':'rankGuestHint';render();
  }catch(error){if(closed||ticket!==sequence)return;status=error instanceof ApiError&&error.status===503?'rankingUnavailable':'rankLoadFailed';render();}
 };
 const unsubscribe=onRankingsChanged(()=>{if(!busy)void load();});
 // Fetch only the table during polling: avoids repeating profile/seasons queries
 // and picks up delayed outbox delivery while this screen remains open.
 const poll=typeof setInterval==='function'?setInterval(async()=>{
  if(closed||busy||!table||period==='archive'&&!selected)return;
  if(typeof document!=='undefined'&&root.contains(document.activeElement))return;
  const ticket=sequence;
  try{const updated=await leaderboardApi.table(mode,table.season);if(!closed&&!busy&&ticket===sequence){table=updated;status=account?'rankReady':'rankGuestHint';render();}}catch(error){if(!closed&&!busy&&ticket===sequence){status=error instanceof ApiError&&error.status===503?'rankingUnavailable':'rankLoadFailed';render();}}
 },10000):undefined;
 
 void load();
}

