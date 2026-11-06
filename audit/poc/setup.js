const E=require('./evm.js');
const {ethers}=E;
const ABI = {
  acp: ()=>E.art('AccessControlProxy').abi,
  clf: ()=>E.art('ChainlinkPriceFeed').abi,
  vi: ()=>E.art('ValueInterpreter').abi,
  aggr: ()=>E.art('AggregatedDerivativePriceFeed').abi,
  exch: ()=>E.art('ExchangeAggregator').abi,
  adapter: ()=>E.art('TestAdapter').abi,
  peg: ()=>E.art('PegToken').abi,
  buf: ()=>E.art('VaultBuffer').abi,
  vault: ()=>E.art('Vault').abi,
  admin: ()=>E.art('VaultAdmin').abi,
  tre: ()=>E.art('Treasury').abi,
  erc20: ()=>E.art('ERC20Mock').abi,
  agg: ()=>E.art('AggregatorMock').abi,
};
const U = (n,d)=> ethers.utils.parseUnits(n.toString(), d);
async function num(vm, from, to, abi, fn, args, dec){
  const r = await E.call(vm, from, to, abi, fn, args);
  const v = BigInt('0x'+Buffer.from(r).toString('hex'));
  return dec!==undefined? ethers.utils.formatUnits(v, dec) : v;
}
async function big(vm, from, to, abi, fn, args){
  const r = await E.call(vm, from, to, abi, fn, args);
  return BigInt('0x'+Buffer.from(r).toString('hex'));
}
async function build(vm, opts){
  opts = opts || {};
  const W = {
    gov: E.mkWallet(0xa1), delegate: E.mkWallet(0xa2), keeper: E.mkWallet(0xa3),
    u1: E.mkWallet(0xb1), u2: E.mkWallet(0xb2), u3: E.mkWallet(0xb3), att: E.mkWallet(0xc1),
  };
  for(const k of Object.keys(W)) await E.fund(vm, W[k].addr, '100000000000000000000000');
  const s = {W};
  const step=(n)=>console.log('  step',n);

  // tokens: USDT 6, USDC 6, DAI 18
  step('s.usdt ='); s.usdt = await E.deploy(vm,W.gov,'ERC20Mock',['USDT','USDT',6, U('100000000',6).toString()]);
  step('s.usdc ='); s.usdc = await E.deploy(vm,W.gov,'ERC20Mock',['USDC','USDC',6, U('100000000',6).toString()]);
  step('s.dai  ='); s.dai  = await E.deploy(vm,W.gov,'ERC20Mock',['DAI','DAI',18, U('100000000',18).toString()]);
  // give everyone some
  for(const k of ['u1','u2','u3','att']){
    await E.send(vm,W.gov,s.usdt,ABI.erc20(),'transfer',[W[k].hex, U('1000000',6).toString()]);
    await E.send(vm,W.gov,s.usdc,ABI.erc20(),'transfer',[W[k].hex, U('1000000',6).toString()]);
    await E.send(vm,W.gov,s.dai,ABI.erc20(),'transfer',[W[k].hex, U('1000000',18).toString()]);
  }
  // access control
  step('s.acp ='); s.acp = await E.deploy(vm,W.gov,'AccessControlProxy',[]);
  await E.send(vm,W.gov,s.acp,ABI.acp(),'initialize',[W.gov.hex,W.delegate.hex,W.gov.hex,W.keeper.hex]);
  // price feeds
  s.ethUsd = await E.deploy(vm,W.gov,'AggregatorMock',[U('2000',8).toString()]);
  s.pUsdt = await E.deploy(vm,W.gov,'AggregatorMock',[U('1',8).toString()]);
  s.pUsdc = await E.deploy(vm,W.gov,'AggregatorMock',[U('1',8).toString()]);
  s.pDai  = await E.deploy(vm,W.gov,'AggregatorMock',[U('1',8).toString()]);
  const prim=[s.usdt,s.usdc,s.dai];
  const aggs=[s.pUsdt,s.pUsdc,s.pDai];
  const hb=[86400,86400,86400];
  const ra=[1,1,1];
  step('s.clf ='); s.clf = await E.deploy(vm,W.gov,'ChainlinkPriceFeed',[s.ethUsd,3600,prim,aggs,hb,ra,[],[] ,s.acp]);
  step('s.adpf ='); s.adpf = await E.deploy(vm,W.gov,'AggregatedDerivativePriceFeed',[[],[],s.acp]);
  step('s.vi ='); s.vi = await E.deploy(vm,W.gov,'ValueInterpreter',[s.clf,s.adpf,s.acp]);
  step('s.adapter ='); s.adapter = await E.deploy(vm,W.gov,'TestAdapter',[s.vi]);
  step('s.exch ='); s.exch = await E.deploy(vm,W.gov,'ExchangeAggregator',[[s.adapter],s.acp]);
  step('s.tre ='); s.tre = await E.deploy(vm,W.gov,'Treasury',[]);
  await E.send(vm,W.gov,s.tre,ABI.tre(),'initialize',[s.acp]);
  // vault (core) + admin impl
  step('s.vault ='); s.vault = await E.deploy(vm,W.gov,'Vault',[]);
  await E.send(vm,W.gov,s.vault,ABI.vault(),'initialize',[s.acp,s.tre,s.exch,s.vi]);
  step('s.admin ='); s.admin = await E.deploy(vm,W.gov,'VaultAdmin',[]);
  await E.send(vm,W.gov,s.vault,ABI.vault(),'setAdminImpl',[s.admin]);
  // peg token + buffer
  step('s.peg ='); s.peg = await E.deploy(vm,W.gov,'PegToken',[]);
  await E.send(vm,W.gov,s.peg,ABI.peg(),'initialize',['USDi','USDi',18,s.vault,s.acp]);
  step('s.buf ='); s.buf = await E.deploy(vm,W.gov,'VaultBuffer',[]);
  await E.send(vm,W.gov,s.buf,ABI.buf(),'initialize',['tUSDi','tUSDi',s.vault,s.peg,s.acp]);
  // admin wiring
  await E.send(vm,W.gov,s.vault,ABI.admin(),'setVaultBufferAddress',[s.buf]);
  await E.send(vm,W.gov,s.vault,ABI.admin(),'setPegTokenAddress',[s.peg]);
  step('s.dripper ='); s.dripper = await E.deploy(vm,W.gov,'Dripper',[]);
  await E.send(vm,W.gov,s.dripper,E.art('Dripper').abi,'initialize',[s.acp,s.vault,s.usdt]);
  step('s.harvester ='); s.harvester = await E.deploy(vm,W.gov,'Harvester',[]);
  await E.send(vm,W.gov,s.harvester,E.art('Harvester').abi,'initialize',[s.acp,s.dripper,s.usdt,s.vault]);
  return s;
}
async function approve(vm, w, token, spender, amt){
  await E.send(vm,w,token,ABI.erc20(),'approve',[spender, amt]);
}
async function mintDeposit(vm,s,w,assets,amounts){
  for(let i=0;i<assets.length;i++) await approve(vm,w,assets[i],s.vault,amounts[i]);
  await E.send(vm,w,s.vault,ABI.vault(),'mint',[assets, amounts, 0]);
}
async function adjustCycle(vm,s){
  await E.send(vm,s.W.keeper,s.vault,ABI.vault(),'startAdjustPosition',[]);
  await E.send(vm,s.W.keeper,s.vault,ABI.vault(),'endAdjustPosition',[]);
}
async function distribute(vm,s){
  let res = true;
  for(let i=0;i<20 && res;i++){
    const r = await E.send(vm,s.W.keeper,s.buf,ABI.buf(),'distributeWhenDistributing',[]);
    res = BigInt('0x'+Buffer.from(r.ret).toString('hex')) === 1n;
  }
}
module.exports = {E,ABI,U,num,big,build,approve,mintDeposit,adjustCycle,distribute};
