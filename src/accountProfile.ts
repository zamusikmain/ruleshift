import {leaderboardApi,ApiError,type Account} from './leaderboardApi';
// Only an explicit disabled service or 401 means guest; connection/database errors
// must not silently turn an authenticated nickname edit into a local-only edit.
export async function currentAccount():Promise<Account|null>{
 const providers=await leaderboardApi.providers();if(!providers.accounts)return null;
 try{return await leaderboardApi.me();}catch(error){if(error instanceof ApiError&&error.status===401)return null;throw error;}
}
export async function saveNickname(name:string):Promise<Account|null>{
 const account=await currentAccount();return account?leaderboardApi.rename(name):null;
}
