const solc = require('solc');
const fs = require('fs');
const path = require('path');
const ROOT = '/home/user/boc-contract-core';
const sources = {};
function addFile(p){
  const rel = path.relative(ROOT, p).split(path.sep).join('/');
  sources[rel] = {content: fs.readFileSync(p,'utf8')};
}
function walk(d){ for(const e of fs.readdirSync(d,{withFileTypes:true})){ const p=path.join(d,e.name); if(e.isDirectory()) walk(p); else if(p.endsWith('.sol') && !p.includes('RevertReasonParser')) addFile(p);} }
walk(path.join(ROOT,'contracts'));

function findImports(imp){
  const cands = [
    path.join(__dirname,'node_modules', imp),
    path.join(ROOT, imp),
    path.join(ROOT, 'contracts', imp),
  ];
  for(const c of cands){ if(fs.existsSync(c)) return {contents: fs.readFileSync(c,'utf8')}; }
  return {error: 'not found '+imp};
}
const input = {
  language:'Solidity',
  sources,
  settings:{
    optimizer:{enabled:true, runs:200, details:{yul:true}},
    outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object','storageLayout']}}
  }
};
const out = JSON.parse(solc.compile(JSON.stringify(input), {import: findImports}));
const errs = (out.errors||[]);
for(const e of errs) console.log(e.severity.toUpperCase(), e.formattedMessage);
fs.writeFileSync(require('path').join(__dirname,'out.json'), JSON.stringify(out));
console.log('contracts compiled:', Object.keys(out.contracts||{}).length);
