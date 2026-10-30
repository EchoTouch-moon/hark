import ts from 'typescript';
import {readFile,writeFile} from 'node:fs/promises';
const directory=new URL('./',import.meta.url);
for(const name of ['flame','flame-renderer','flame-shape']) {
  const input=await readFile(new URL(name+'.ts',directory),'utf8');
  const output=ts.transpileModule(input,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,strict:true}}).outputText;
  const target=new URL(name+'.js',directory);
  if(process.argv.includes('--check')) {
    if(await readFile(target,'utf8')!==output) throw new Error(`${name}.js differs from its TypeScript source; run build-flame.mjs`);
  } else await writeFile(target,output);
}
console.log('Flame browser modules match TypeScript sources.');
