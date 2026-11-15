import {currentAccount} from './accountProfile';
const KEY='ruleshift.entry-choice';
let checked=false;
export function chooseGuest():void {try{localStorage.setItem(KEY,'guest');}catch{}checked=true;}
export function resetEntry():void {checked=false;try{localStorage.removeItem(KEY);}catch{}}
export async function checkEntry():Promise<boolean>{
 if(checked)return true;
 const account=await currentAccount();
 let guest=false;try{guest=localStorage.getItem(KEY)==='guest';}catch{}
 checked=!!account||guest;return checked;
}
