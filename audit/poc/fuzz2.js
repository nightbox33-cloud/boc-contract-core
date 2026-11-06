const S=require('./setup.js'); const A=require('./account.js');
const {E,ABI,U,big}=S; const F=A.F;
const seed = parseInt(process.argv[2]||'1');
const STEPS = parseInt(process.argv[3]||'120');
let rs = seed>>>0;
function rnd(){ rs = (rs*1664525 + 1013904223) >>> 0; return rs/4294967296; }
function pick(a){ return a[Math.floor(rnd()*a.length)]; }
function ri(n){ return Math.floor(rnd()*n); }
const TOK=[['usdt',6],['usdc',6],['dai',18]];

(async()=>{
 const vm=await E.newVM();
 const s=await S.build(vm);
 const {W}=s;
 for(const t of [s.usdt,s.usdc,s.dai]) await E.send(vm,W.gov,s.vault,ABI.admin(),'addAsset',[t]);
 s.strat = await E.deploy(vm,W.gov,'StrategyMock',[]);
 await E.send(vm,W.gov,s.strat,E.art('StrategyMock').abi,'initialize',[s.vault,[s.usdt]]);
 await E.send(vm,W.gov,s.vault,ABI.admin(),'addStrategy',[[{strategy:s.strat,profitLimitRatio:10000,lossLimitRatio:10000}]]);
 await E.send(vm,W.gov,s.vault,ABI.admin(),'setWithdrawalQueue',[[s.strat]]);
 const actors=['u1','u2','u3','att'];
 const bal = async (who,t)=> big(vm,W[who].addr,s[t],ABI.erc20(),'balanceOf',[W[who].hex]);
 const m={}; for(const a of actors) m[a]={put:0n,got:0n};
 const errs={};
 for(let step=0; step<STEPS; step++){
   const op=rnd(), who=pick(actors);
   try{
     if(op<0.40){
       const [nm,d]=pick(TOK); const amt=U((1+ri(5000)).toString(),d);
       if(await bal(who,nm) < BigInt(amt)) continue;
       await S.mintDeposit(vm,s,W[who],[s[nm]],[amt]);
       m[who].put += BigInt(amt)*10n**BigInt(18-d);
     } else if(op<0.70){
       const usdi=await big(vm,W[who].addr,s.peg,ABI.peg(),'balanceOf',[W[who].hex]);
       if(usdi===0n) continue;
       const amt = rnd()<0.5 ? usdi : (usdi*BigInt(1+ri(99)))/100n;
       if(amt===0n) continue;
       const pre={}; for(const [nm] of TOK) pre[nm]=await bal(who,nm);
       await E.send(vm,W[who],s.vault,ABI.vault(),'burn',[amt.toString(),0]);
       for(const [nm,d] of TOK){ const post=await bal(who,nm); m[who].got += (post-pre[nm])*10n**BigInt(18-d); }
     } else if(op<0.80){ await S.adjustCycle(vm,s); }
     else if(op<0.87){ await S.distribute(vm,s); }
     else if(op<0.93){ await E.send(vm,W[who],s.vault,ABI.vault(),'rebase',[]); }
     else {
       const vbal=await big(vm,W.gov.addr,s.usdt,ABI.erc20(),'balanceOf',[s.vault]);
       if(vbal>U('100',6)) await E.send(vm,W.keeper,s.vault,ABI.vault(),'lend',[s.strat,[s.usdt],[(vbal/3n).toString()],0]);
     }
   }catch(e){ const k=e.message.slice(0,70); errs[k]=(errs[k]||0)+1; }
 }
 const sn=await A.snap(vm,s);
 // final claims: also realize everything by burning? no - value the claims
 const rows=[];
 for(const a of actors){
   const claimv=A.claim(sn,a);
   const pnl = claimv + m[a].got - m[a].put;
   rows.push({a, put:F(m[a].put), got:F(m[a].got), claim:F(claimv), pnl:F(pnl), pnlv:pnl});
 }
 console.log(`seed=${seed} totalAssets=${F(sn.totalAssets)} vaultCash=${F(sn.vUsd)} bufCash=${F(sn.bUsd)} pot=${F(sn.pot)} bufSupply=${F(sn.bufSupply)} totalDebt=${F(sn.totalDebt)}`);
 for(const r of rows) console.log(`  ${r.a.padEnd(4)} put=${r.put.padStart(18)} got=${r.got.padStart(18)} claim=${r.claim.padStart(20)} PnL=${r.pnl}`);
 console.log('  errors:', JSON.stringify(errs));
 const tot = rows.reduce((x,r)=>x+r.pnlv,0n);
 console.log('  sum PnL (should be <= yield, and no actor should be >> others):', F(tot));
})();
