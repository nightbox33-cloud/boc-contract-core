const {VM} = require('@ethereumjs/vm');
const {Common, Chain, Hardfork} = require('@ethereumjs/common');
const {Transaction: LegacyTransaction} = require('@ethereumjs/tx');
const {Account, Address, BN, toBuffer} = require('@ethereumjs/util');
const {Block} = require('@ethereumjs/block');
const fs = require('fs');
const out = JSON.parse(fs.readFileSync(require('path').join(__dirname,'out.json')));
const mocksOut = JSON.parse(fs.readFileSync(require('path').join(__dirname,'mocks.json')));
const stratOut = JSON.parse(fs.readFileSync(require('path').join(__dirname,'strat.json')));
const ethers = require('ethers');

function art(name){
  for(const src of [out, mocksOut, stratOut]){ for(const f of Object.keys(src.contracts||{})) for(const c of Object.keys(src.contracts[f])) if(c===name) return src.contracts[f][c]; }
  throw new Error('no artifact '+name);
}
let CTX = null;
let TS = 1700000000n;
function setTS(t){ TS = BigInt(t); }
function getTS(){ return TS; }
function BLK(gas){ return Block.fromBlockData({header:{gasLimit:BigInt(gas), baseFeePerGas: 0n, timestamp: TS}}, {common: CTX.common}); }
async function newVM(){
  const common = new Common({chain: Chain.Mainnet, hardfork: Hardfork.London});
  const vm = await VM.create({common});
  CTX = {vm, common};
  return vm;
}
function mkWallet(id){
  const w = new ethers.Wallet('0x'+id.toString(16).padStart(64,'0'));
  return {addr: new Address(Buffer.from(w.address.slice(2),'hex')), w, hex: w.address};
}
async function fund(vm, addr, wei){
  const a = (await vm.stateManager.getAccount(addr)) || new Account();
  await vm.stateManager.putAccount(addr, a);
  await vm.stateManager.modifyAccountFields(addr, {balance: BigInt(wei)});
}
async function runTx(vm, wallet, to, data, gas, value){
  gas = gas||30000000; value = value||0;
  const acc = await vm.stateManager.getAccount(wallet.addr);
  const nonce = acc ? BigInt(acc.nonce) : 0n;
  const txData = {nonce, gasPrice: 0, gasLimit: gas, to: to||undefined, data, value};
  const tx = LegacyTransaction.fromTxData(txData, {common: CTX.common}).sign(Buffer.from(wallet.w.privateKey.slice(2),'hex'));
  const res = await vm.runTx({tx, skipBalance:true, block: BLK(gas)});
  return res;
}
const addrOf = (x)=>{
  if(x===undefined||x===null) return x;
  if(typeof x==='string') return x;
  if(Array.isArray(x)) return x.map(addrOf);
  if(x.buf) return x.toString();            // ethereumjs Address
  if(typeof x==='object'){ const o={}; for(const k of Object.keys(x)) o[k]=addrOf(x[k]); return o; }
  if(typeof x==='string') return x;
  if(x.hex && typeof x.hex==='string') return x.hex;
  if(typeof x.toString==='function') return x.toString();
  return x;
};
async function deploy(vm, wallet, name, args, gas){
  args = args? (Array.isArray(args)? args.map(addrOf) : [addrOf(args)]) : args;
  const a = art(name);
  const f = new ethers.utils.Interface(a.abi);
  const bytecode = '0x'+a.evm.bytecode.object + (args&&args.length? f.encodeDeploy(args).slice(2):'');
  const res = await runTx(vm, wallet, null, bytecode, gas||30000000, 0);
  if(res.execResult.exceptionError) throw new Error('deploy '+name+' failed: '+res.execResult.exceptionError.error+' '+Buffer.from(res.execResult.returnValue).toString('hex'));
  const _a = res.createdAddress || res.execResult.createdAddress;
  return _a? _a.toString() : undefined;
}
function decodeRevert(rv){
  const hex = Buffer.from(rv).toString('hex');
  try{ return ethers.utils.defaultAbiCoder.decode(['string'], '0x'+hex.slice(8))[0]; }catch(e){ return 'ret=0x'+hex.slice(0,200); }
}
async function send(vm, wallet, to, abi, fn, args, value, gas){
  args = args? (Array.isArray(args)? args.map(addrOf) : [addrOf(args)]) : args;
  const iface = new ethers.utils.Interface(abi);
  const data = iface.encodeFunctionData(fn, args||[]);
  const res = await runTx(vm, wallet, to, data, gas||30000000, value||0);
  if(res.execResult.exceptionError) throw new Error(`${fn} reverted: ${res.execResult.exceptionError.error} :: ${decodeRevert(res.execResult.returnValue)}`);
  return {ret: res.execResult.returnValue, logs: res.execResult.logs, gasUsed: res.totalGasSpent};
}
async function call(vm, from, to, abi, fn, args){
  from = addrOf(from); to = addrOf(to);
  args = args? (Array.isArray(args)? args.map(addrOf) : [addrOf(args)]) : args;
  const iface = new ethers.utils.Interface(abi);
  const data = iface.encodeFunctionData(fn, args||[]);
  const res = await vm.evm.runCall({caller: new Address(Buffer.from(addrOf(from).slice(2),'hex')), to: new Address(Buffer.from(addrOf(to).slice(2),'hex')), data: toBuffer(data), gasLimit: BigInt(30000000), value: 0n, block: BLK(30000000)});
  if(res.execResult.exceptionError) throw new Error(`${fn} view-revert: ${res.execResult.exceptionError.error} :: ${decodeRevert(res.execResult.returnValue)}`);
  return res.execResult.returnValue;
}
async function callRes(vm, from, to, abi, fn, args){
  from=addrOf(from); to=addrOf(to);
  const iface = new ethers.utils.Interface(abi);
  const data = iface.encodeFunctionData(fn, args||[]);
  return vm.evm.runCall({caller: from, to, data: toBuffer(data), gasLimit: BigInt(30000000), value: 0n, block: BLK(30000000)});
}
async function bal(vm, tokenAbi, token, who){
  const r = await call(vm, who, token, tokenAbi, 'balanceOf', [who.hex? who.hex: who.toString()]);
  return BigInt(new BN(r).toString());
}
const hexof = (a)=> a===null||a===undefined? a : (typeof a==='string'? a : a.toString());
module.exports = {addrOf, setTS, getTS, newVM, deploy, send, call, callRes, art, fund, mkWallet, ethers, Address, CTX:()=>CTX, decodeRevert, hexof};
