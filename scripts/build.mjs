import {mkdir,copyFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
await mkdir(new URL('dist/',root),{recursive:true});
for(const name of ['index.html','app.js','style.css'])await copyFile(new URL('public/'+name,root),new URL('dist/'+name,root));
await copyFile(new URL('lib/coverage.mjs',root),new URL('dist/coverage.mjs',root));
console.log('Built Stratify static assets in dist/.');
