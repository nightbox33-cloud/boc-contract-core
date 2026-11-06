// Compara la dispersion de PnL entre usuarios con y sin la precondicion isDistributing.
// mode = 'unguarded' (bytecode actual) | 'guarded' (solo distribuye si isDistributing==true)
const S=require('./setup.js'); const A=require('./account.js');
const {E,ABI,U,big}=S; const F=A.F;
const seed=parseInt(process.argv[2]||'1'), STEPS=parseInt(process.argv[3]||'150'), mode=process.argv[4]||'unguarded';
let rs=seed>>>0;
const rnd=()=>{rs=(rs*1664525+1013904223)>>>0; return rs/4294967296;};
const pick=a=>a[Math.floor(rnd()*a.length)];
const ri=n=>Math.floor(rnd()*n);
const TOK=[['usdt',6],['usdc',6],['dai',18]];
(async()=>{
 const vm=await E.newVM(); const s=await S.build(vm); const {W}=s;
 for(const t of [s.usdt,s.usdc,s.dai]) await E.send(vm,W.gov,s.vault,ABI.admin(),'addAsset',[t]);
 s.strat=await E.deploy(vm,W.gov,'StrategyMock',[]);
 await E.send(vm,W.gov,s.strat,E.art('StrategyMock').abi,'initialize',[s.vault,[s.usdt]]);
 await E.send(vm,W.gov,s.vault,ABI.admin(),'addStrategy',[[{strategy:s.strat,profitLimitRatio:10000,lossLimitRatio:10000}]]);
 await E.send(vm,W.gov,s.vault,ABI.admin(),'setWithdrawalQueue',[[s.strat]]);
 const actors=['u1','u2','u3','att'];
 const bal=async(who,t)=>big(vm,W[who].addr,s[t],ABI.erc20(),'balanceOf',[W[who].hex]);
 const m={}; for(const a of actors) m[a]={put:0n,got:0n};
 const distribute=async()=>{
   const isD = (await big(vm,W.gov.addr,s.buf,ABI.buf(),'isDistributing'))===1n;
   if(mode==='guarded' && !isD) return;
   await S.distribute(vm,s);
 };
 for(let i=0;i<STEPS;i++){
  const op=rnd(), who=pick(actors);
  try{
   if(op<0.42){ const [nm,d]=pick(TOK); const amt=U((1+ri(5000)).toString(),d);
     if(await bal(who,nm)<BigInt(amt)) continue;
     await S.mintDeposit(vm,s,W[who],[s[nm]],[amt]); m[who].put+=BigInt(amt)*10n**BigInt(18-d);
   } else if(op<0.72){ const u=await big(vm,W[who].addr,s.peg,ABI.peg(),'balanceOf',[W[who].hex]);
     if(u===0n) continue; const amt=rnd()<0.5?u:(u*BigInt(1+ri(99)))/100n; if(!amt) continue;
     const pre={}; for(const [nm] of TOK) pre[nm]=await bal(who,nm);
     await E.send(vm,W[who],s.vault,ABI.vault(),'burn',[amt.toString(),0]);
     for(const [nm,d] of TOK){ const p=await bal(who,nm); m[who].got+=(p-pre[nm])*10n**BigInt(18-d); }
   } else if(op<0.82){ await S.adjustCycle(vm,s); }
   else if(op<0.89){ await distribute(); }
   else if(op<0.95){ await E.send(vm,W[who],s.vault,ABI.vault(),'rebase',[]); }
   else { const v=await big(vm,W.gov.addr,s.usdt,ABI.erc20(),'balanceOf',[s.vault]);
     if(v>U('100',6)) await E.send(vm,W.keeper,s.vault,ABI.vault(),'lend',[s.strat,[s.usdt],[(v/3n).toString()],0]); }
  }catch(e){}
 }
 const sn=await A.snap(vm,s);
 const pnl={}, rows=[];
 for(const a of actors){ const p=A.claim(sn,a)+m[a].got-m[a].put; pnl[a]=p; rows.push(`${a}=${F(p)}`); }
 const vals=Object.values(pnl);
 const min=vals.reduce((a,b)=>a<b?a:b), max=vals.reduce((a,b)=>a>b?a:b);
 console.log(`${mode.padEnd(10)} seed=${String(seed).padStart(2)}  PnL: ${rows.join('  ')}   |  dispersion(max-min)=${F(max-min)} USD`);
})().catch(e=>console.log('FAIL',e.message));
