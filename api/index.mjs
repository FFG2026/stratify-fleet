import {handleRequest} from '../server.mjs';
// Vercel passes parsed bodies to Node handlers. The shared handler also supports
// raw IncomingMessage streams for local development.
export default async function handler(req,res){
 const url=new URL(req.url,'https://stratify.invalid');
 const route=req.query?.__route??url.searchParams.get('__route');
 if(route!==null&&route!==undefined){
  if(typeof route!=='string'||!/^[-a-zA-Z0-9/]*$/.test(route)){
   res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Invalid API route.'}));return;
  }
  url.pathname='/api/'+route;
  url.searchParams.delete('__route');
  req.url=url.pathname+url.search;
 }
 return handleRequest(req,res);
}
