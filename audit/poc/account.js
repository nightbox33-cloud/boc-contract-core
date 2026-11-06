// Precise accounting helper: measures each actor's USD claim in the protocol
const S=require('./setup.js'); const {E,ABI,U,big}=S;
const F=(x,d=18)=>E.ethers.utils.formatUnits(x,d);
async function snap(vm,s){
  const {W}=s;
  const vaultBals={}, bufBals={}, stratBals={};
  for(const [n,t,d] of [['usdt',s.usdt,6],['usdc',s.usdc,6],['dai',s.dai,18]]){
    vaultBals[n]=await big(vm,W.gov.addr,t,ABI.erc20(),'balanceOf',[s.vault]);
    bufBals[n]=await big(vm,W.gov.addr,t,ABI.erc20(),'balanceOf',[s.buf]);
    if(s.strat) stratBals[n]=await big(vm,W.gov.addr,t,ABI.erc20(),'balanceOf',[s.strat]);
  }
  const totalDebt=await big(vm,W.gov.addr,s.vault,ABI.vault(),'totalDebt');
  const tShares=await big(vm,W.gov.addr,s.peg,ABI.peg(),'totalShares');
  const uUPS=await big(vm,W.gov.addr,s.vault,ABI.vault(),'underlyingUnitsPerShare');
  const bufSupply=await big(vm,W.gov.addr,s.buf,ABI.buf(),'totalSupply');
  const pot=await big(vm,W.gov.addr,s.peg,ABI.peg(),'balanceOf',[s.buf]);
  const usdi={}, tusdi={};
  for(const k of Object.keys(W)) {
    usdi[k]=await big(vm,W[k].addr,s.peg,ABI.peg(),'balanceOf',[W[k].hex]);
    tusdi[k]=await big(vm,W[k].addr,s.buf,ABI.buf(),'balanceOf',[W[k].hex]);
  }
  // USD value of vault+debt (oracle 1:1)
  const vUsd = vaultBals.usdt*10n**12n + vaultBals.usdc*10n**12n + vaultBals.dai;
  const bUsd = bufBals.usdt*10n**12n + bufBals.usdc*10n**12n + bufBals.dai;
  const sUsd = (stratBals.usdt||0n)*10n**12n;
  const totalAssets = vUsd + totalDebt;
  return {vaultBals,bufBals,stratBals,totalDebt,tShares,uUPS,bufSupply,pot,usdi,tusdi,vUsd,bUsd,sUsd,totalAssets,
          // claim of a tUSDi holder = pro-rata of (buffer cash + buffer pot)
          bufValue: bUsd + pot};
}
function claim(snap, actor){
  const usdi = snap.usdi[actor]||0n;
  const tusdi = snap.tusdi[actor]||0n;
  const inBuf = snap.bufSupply>0n ? (tusdi*snap.bufValue)/snap.bufSupply : 0n;
  return usdi + inBuf;
}
module.exports={snap,claim,F};
