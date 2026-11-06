const S=require('./setup.js'); const {E,ABI,U,big}=S;
(async()=>{
 const vm=await E.newVM(); const s=await S.build(vm); const {W}=s;
 await E.send(vm,W.gov,s.vault,ABI.admin(),'addAsset',[s.usdt]);
 await S.mintDeposit(vm,s,W.u1,[s.usdt],[U('1000',6).toString()]);
 await S.adjustCycle(vm,s); await S.distribute(vm,s);
 // start a round; a victim deposits so buffer holds cash while adjustPositionPeriod == true
 await E.send(vm,W.keeper,s.vault,ABI.vault(),'startAdjustPosition',[]);
 await S.mintDeposit(vm,s,W.u2,[s.usdt],[U('5000',6).toString()]);
 console.log('mid-round: buffer cash =', E.ethers.utils.formatUnits(await big(vm,W.gov.addr,s.usdt,ABI.erc20(),'balanceOf',[s.buf]),6));
 const u1usdi = await big(vm,W.u1.addr,s.peg,ABI.peg(),'balanceOf',[W.u1.hex]);
 for(const fn of ['burn','mint']){
   try{
     if(fn==='burn') await E.send(vm,W.u1,s.vault,ABI.vault(),'burn',[u1usdi.toString(),0]);
     else await S.mintDeposit(vm,s,W.u1,[s.usdt],[U('1',6).toString()]);
     console.log('  mid-round', fn, '=> ALLOWED (unexpected)');
   }catch(e){ console.log('  mid-round', fn, '=> blocked:', e.message.slice(0,55)); }
 }
 // and out-of-band distribute mid-round?
 try{ await E.send(vm,W.keeper,s.buf,ABI.buf(),'distributeWhenDistributing',[]); console.log('  mid-round distribute => ALLOWED (unexpected)'); }
 catch(e){ console.log('  mid-round distribute => blocked:', e.message.slice(0,60)); }
})();
