const S=require('./setup.js'); const A=require('./account.js');
const {E,ABI,U,big}=S; const F=A.F;
(async()=>{
 // ---- 1) truncation of VaultBuffer._distribute ----
 const vm=await E.newVM(); const s=await S.build(vm); const {W}=s;
 await E.send(vm,W.gov,s.vault,ABI.admin(),'addAsset',[s.usdt]);
 // USDT 6 decimals: deposit 7 units among 3 users so pot/supply has truncation
 await S.mintDeposit(vm,s,W.u1,[s.usdt],[U('1',6).toString()]);
 await S.mintDeposit(vm,s,W.u2,[s.usdt],[U('1',6).toString()]);
 await S.mintDeposit(vm,s,W.u3,[s.usdt],[U('1',6).toString()]);
 await S.adjustCycle(vm,s);
 const pot0 = await big(vm,W.gov.addr,s.peg,ABI.peg(),'balanceOf',[s.buf]);
 const sup0 = await big(vm,W.gov.addr,s.buf,ABI.buf(),'totalSupply');
 console.log('pot', F(pot0), 'supply', F(sup0));
 await S.distribute(vm,s);
 let got=0n;
 for(const k of ['u1','u2','u3']){ const v=await big(vm,W[k].addr,s.peg,ABI.peg(),'balanceOf',[W[k].hex]); got+=v; console.log('  ',k,F(v)); }
 console.log('  distributed', F(got), 'pot was', F(pot0), '-> stranded', F(pot0-got), 'USDi');
 const potLeft = await big(vm,W.gov.addr,s.peg,ABI.peg(),'balanceOf',[s.buf]);
 console.log('  USDi stranded in buffer (claimable by next round):', F(potLeft));

 // ---- 2) Dripper perBlock overflow ----
 const vm2=await E.newVM(); const s2=await S.build(vm2); const W2=s2.W;
 // fund dripper with a huge balance and call setDripDuration(1)
 await E.send(vm2,W2.gov,s2.usdt,ABI.erc20(),'transfer',[s2.dripper, U('2000000000',6).toString()]);
 let err=null;
 try{ await E.send(vm2,W2.gov,s2.dripper,E.art('Dripper').abi,'setDripDuration',[1]); }catch(e){ err=e.message; }
 const pb = await big(vm2,W2.gov.addr,s2.dripper,E.art('Dripper').abi,'drip');
 console.log('\nDripper: setDripDuration(1) with 2e9 USDT balance ->', err? ('REVERT '+err.slice(0,50)) : 'ok');
 const st = await E.call(vm2,W2.gov.addr,s2.dripper,E.art('Dripper').abi,'drip',[]);
 console.log('  drip struct raw:', Buffer.from(st).toString('hex').slice(0,130));
})().catch(e=>console.log('FAIL',e.message));
