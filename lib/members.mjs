import {invalid} from './queries.mjs';
export const memberRoles=['platform_super_admin','insurer_admin','insurer_claims','insurer_accounts','fleet_admin','fleet_manager','fleet_accounts','driver'];
export function memberRole(value){if(!memberRoles.includes(value))throw invalid('Choose a valid role.');return value;}
export function memberEmail(value){
 const email=String(value??'').trim().toLowerCase();
 if(email.length>254||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))throw invalid('Enter a valid email address.');
 return email;
}
