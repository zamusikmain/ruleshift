export class AuthFailure extends Error {}

// Only fixed diagnostic labels may be logged; never attach tokens or raw errors.
export class OAuthFailure extends AuthFailure {
 constructor(readonly reason:string,readonly upstreamStatus?:number){super('Authentication failed');}
}
